/**
 * Host half of the API-spend panel.
 *
 * It prices the provider-reported token usage of every stored Session with the
 * provider's published rates (peak/off-peak aware), groups the result per
 * Workspace ("project"), and serves one JSON report to the composer-dock
 * panel. The same report carries the account's official platform totals, so
 * the panel can be compared with the provider's usage page.
 */
import { basename } from 'node:path';
import {
  addSessionFold,
  emptyProject,
  foldSessionUsage,
  localDayKey,
  normalizePath,
  projectForPeriod,
} from './aggregate.js';

export const name = 'api-spend';

/** The route carrier, the browser-authentication fence, and the read models. */
export const inject = ['webServer', 'connection', 'sessionQuery', 'workspaceRegistry'];

/** Host route serving the report; the Client half fetches it browser-relative. */
const REPORT_PATH = '/api-spend/report';

/** Period keys reported to the Client half, newest first. */
const PERIODS = ['today', '7d', 'all'];

/** Provider rates: peak prices per million tokens; off-peak is a fraction of them. */
const DEFAULT_MODELS = {
  'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
};

/** Peak windows as UTC hour ranges on weekdays; off-peak is everything else. */
const DEFAULT_PEAK_WINDOWS = [
  { start: 1, end: 4 },
  { start: 6, end: 10 },
];

/** Non-negative finite number, or the fallback. */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** One rate entry, completed from the fallback rate. */
function rateOr(value, fallback) {
  const source = value !== null && typeof value === 'object' ? value : {};
  return {
    cacheHit: numberOr(source.cacheHit, fallback.cacheHit),
    cacheMiss: numberOr(source.cacheMiss, fallback.cacheMiss),
    output: numberOr(source.output, fallback.output),
  };
}

/** UTC hour windows as `[{start, end}]`, keeping only whole hours in 0..24. */
function windowsOf(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const windows = [];
  for (const entry of value) {
    const start = Math.trunc(numberOr(entry?.start, -1));
    const end = Math.trunc(numberOr(entry?.end, -1));
    if (start < 0 || end > 24 || start >= end) continue;
    windows.push({ start, end });
  }
  return windows.length === 0 ? fallback : windows;
}

/** Weekday numbers (0 = Sunday) accepted from config. */
function weekdaysOf(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const days = [...new Set(value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  return days.length === 0 ? fallback : days;
}

/**
 * Normalize the row's raw `config` (the Loader passes it unvalidated because
 * this package ships no Config schema) into the facts the report needs.
 * @param config - raw Loader row config, or undefined.
 * @returns validated currency, unit, price table, schedule, and Session cap.
 */
function settingsOf(config) {
  const source = config !== null && typeof config === 'object' ? config : {};
  const models = {};
  const rawModels =
    source.models !== null && typeof source.models === 'object' ? source.models : DEFAULT_MODELS;
  for (const [model, rate] of Object.entries(rawModels)) {
    if (model === '') continue;
    models[model] = rateOr(rate, { cacheHit: 0, cacheMiss: 0, output: 0 });
  }
  const offPeakFactor =
    typeof source.offPeakFactor === 'number' &&
    Number.isFinite(source.offPeakFactor) &&
    source.offPeakFactor >= 0 &&
    source.offPeakFactor <= 1
      ? source.offPeakFactor
      : 0.5;
  return {
    currency: typeof source.currency === 'string' && source.currency !== '' ? source.currency : 'USD',
    symbol: typeof source.symbol === 'string' && source.symbol !== '' ? source.symbol : '$',
    unit: numberOr(source.priceUnit, 1000000) || 1000000,
    offPeakFactor,
    models,
    defaultModel: typeof source.defaultModel === 'string' && source.defaultModel !== '' ? source.defaultModel : 'deepseek-flash',
    schedule: {
      windows: windowsOf(source.peakWindows, DEFAULT_PEAK_WINDOWS),
      weekdays: weekdaysOf(source.peakWeekdays, [1, 2, 3, 4, 5]),
      holidays: Array.isArray(source.holidays) ? source.holidays.filter((day) => typeof day === 'string') : [],
    },
    maxSessions:
      typeof source.maxSessions === 'number' && Number.isSafeInteger(source.maxSessions) && source.maxSessions > 0
        ? source.maxSessions
        : 400,
    platformRefreshMs: numberOr(source.platformRefreshMs, 120000),
  };
}

/** JSON response without caching: spend changes as Sessions run. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Run `worker` over `items` with a fixed number of in-flight tasks. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(undefined).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Local midnight at the start of the current day, in epoch milliseconds. */
function localDayStartMs() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Seconds east of UTC for the host time zone (Moscow: 10800). */
function localOffsetSeconds() {
  return -new Date().getTimezoneOffset() * 60;
}

/**
 * Map key for a directory path: separators trimmed, and lower-cased on Windows
 * where the filesystem is case-insensitive.
 * @param value - raw path or undefined.
 * @returns the comparison key, or undefined.
 */
function pathKey(value) {
  const normalized = normalizePath(value);
  if (normalized === undefined) return undefined;
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function apply(ctx, config) {
  const settings = settingsOf(config);
  const pricing = {
    models: settings.models,
    defaultModel: settings.defaultModel,
    offPeakFactor: settings.offPeakFactor,
  };
  const unit = settings.unit;
  const maxSessions = settings.maxSessions;

  /** Per-Session fold cache: a Session log only changes when its revision does. */
  const sessionCache = new Map();
  /** One shared build at a time; concurrent requests reuse its result. */
  let building;
  /** Cached platform account snapshot (official totals). */
  let platformCache;

  const persistence = () => ctx.get('sessionPersistence');

  /** The selected day keys for every reported period. */
  const periodBounds = () => {
    const todayStart = localDayStartMs();
    return {
      today: localDayKey(todayStart),
      '7d': localDayKey(todayStart - 6 * 86400000),
      all: undefined,
    };
  };

  /**
   * Fold one Session, reusing the cached fold while its persistence revision
   * and liveness are unchanged. Live Sessions are re-folded after a short
   * delay so a running turn shows up; when no persistence service is mounted,
   * anything but a live Session is folded once and reused.
   * @param record - `SessionRecord` from `sessionQuery.listSessions()`.
   * @returns per-day/model/price-window buckets, or undefined when unreadable.
   */
  const foldFor = async (record) => {
    const id = record.header.id;
    const cached = sessionCache.get(id);
    const now = Date.now();
    if (cached !== undefined) {
      if (cached.live === false && record.live === false && cached.revision !== undefined) {
        return cached.fold;
      }
      // A live log grows with every step, and re-reading one replays it whole:
      // preview its spend at most once per half-minute.
      if (record.live && now - cached.readAt < 30000) return cached.fold;
    }
    let revision;
    const service = persistence();
    if (service !== undefined) {
      try {
        revision = (await service.stat(id))?.revision;
      } catch {
        revision = undefined;
      }
    }
    if (
      cached !== undefined &&
      revision !== undefined &&
      cached.revision === revision &&
      cached.live === record.live
    ) {
      cached.readAt = now;
      return cached.fold;
    }
    let fold;
    try {
      const snapshot = await ctx.sessionQuery.readSession(id);
      fold = foldSessionUsage(snapshot.events, settings.schedule);
    } catch {
      sessionCache.set(id, { revision, live: record.live, readAt: now, fold: new Map() });
      return undefined;
    }
    sessionCache.set(id, { revision, live: record.live, readAt: now, fold });
    return fold;
  };

  /**
   * Read the account's official totals from the provider's platform API. Only
   * available when the account provider (not a raw API key) is mounted; every
   * figure here is what the provider's own usage page shows, including usage
   * this Harness did not make.
   * @returns `{ balance, totalCosts, todayCost, fetchedAt }`, or null.
   */
  const platformSnapshot = async () => {
    const now = Date.now();
    if (platformCache !== undefined && now - platformCache.at < settings.platformRefreshMs) {
      return platformCache.value;
    }
    const account = ctx.get('deepseekAccount');
    if (account === undefined || typeof account.getPlatformSession !== 'function') {
      platformCache = { at: now, value: null };
      return null;
    }
    try {
      const session = await account.getPlatformSession();
      if (session === null || session === undefined || typeof session.token !== 'string') {
        platformCache = { at: now, value: null };
        return null;
      }
      const headers = {
        accept: 'application/json',
        ...(session.requestHeaders ?? {}),
        'x-dsh-auth-token': session.token,
      };
      const signal = AbortSignal.timeout(8000);
      const origin = String(session.origin);
      const todayStart = Math.floor(localDayStartMs() / 1000);
      const query = `start=${todayStart}&end=${todayStart + 86400}&tz=${localOffsetSeconds()}`;
      const [summaryResponse, usageResponse] = await Promise.all([
        fetch(`${origin}/api/v0/users/get_user_summary`, { headers, signal }),
        fetch(`${origin}/api/v0/usage/by_api_key/cost?${query}`, { headers, signal }),
      ]);
      const summary = summaryResponse.ok ? await summaryResponse.json() : undefined;
      const usage = usageResponse.ok ? await usageResponse.json() : undefined;
      const summaryData = summary?.data?.biz_data;
      const usageData = usage?.data?.biz_data;

      const todayCost = {};
      if (Array.isArray(usageData?.data)) {
        for (const block of usageData.data) {
          const currency = typeof block.currency === 'string' ? block.currency : 'USD';
          let total = 0;
          if (Array.isArray(block.series)) {
            for (const series of block.series) {
              if (!Array.isArray(series.buckets)) continue;
              for (const bucket of series.buckets) total += Number(bucket.cost) || 0;
            }
          }
          todayCost[currency] = (todayCost[currency] ?? 0) + total;
        }
      }

      const value = {
        source: 'platform',
        fetchedAt: now,
        balance: Array.isArray(summaryData?.normal_wallets)
          ? summaryData.normal_wallets.map((wallet) => ({ currency: wallet.currency, balance: wallet.balance }))
          : [],
        totalCosts: Array.isArray(summaryData?.total_costs)
          ? summaryData.total_costs.map((row) => ({ currency: row.currency, amount: row.amount }))
          : [],
        todayCost:
          Object.keys(todayCost).length === 0 && usageData === undefined
            ? undefined
            : Object.entries(todayCost)
                .filter(([, amount]) => Math.abs(amount) > 0)
                .map(([currency, amount]) => ({ currency, amount })),
      };
      platformCache = { at: now, value };
      return value;
    } catch {
      platformCache = { at: now, value: null };
      return null;
    }
  };

  /**
   * Build the whole report: priced projects for every period, plus the current
   * Session's project and the provider's official totals.
   * @param currentSessionId - Session the requesting page has open, if any.
   */
  const buildReport = async (currentSessionId) => {
    const [records, workspaces, official] = await Promise.all([
      ctx.sessionQuery.listSessions(),
      ctx.workspaceRegistry.list(),
      platformSnapshot(),
    ]);

    const workspaceByPath = new Map();
    const workspaceBySession = new Map();
    for (const workspace of workspaces) {
      const key = pathKey(workspace.path);
      if (key !== undefined) workspaceByPath.set(key, workspace);
      for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace);
    }

    const ordered = [...records].sort((left, right) => right.header.createdAt - left.header.createdAt);
    const picked = ordered.slice(0, maxSessions);

    const projects = new Map();
    /** Resolve the group (project) a Session belongs to without creating it. */
    const groupOf = (record) => {
      const cwd = normalizePath(record.header.cwd);
      const key = pathKey(record.header.cwd);
      const workspace =
        (key === undefined ? undefined : workspaceByPath.get(key)) ?? workspaceBySession.get(record.header.id);
      if (workspace !== undefined) {
        return { id: `workspace:${workspace.id}`, title: workspace.title, path: workspace.path };
      }
      if (cwd === undefined || key === undefined) return { id: 'unknown', title: '—', path: '' };
      return { id: `cwd:${key}`, title: basename(cwd) || cwd, path: cwd };
    };
    const projectFor = (record) => {
      const group = groupOf(record);
      const existing = projects.get(group.id);
      if (existing !== undefined) return existing;
      const created = emptyProject(group.id, group.title, group.path);
      projects.set(group.id, created);
      return created;
    };

    await mapLimit(picked, 4, async (record) => {
      const fold = await foldFor(record);
      if (fold === undefined || fold.size === 0) return;
      addSessionFold(projectFor(record), fold);
    });

    const bounds = periodBounds();
    const periods = {};
    for (const period of PERIODS) {
      const rows = [...projects.values()]
        .map((project) => projectForPeriod(project, pricing, unit, bounds[period]))
        .filter((row) => row.tokens.total > 0)
        .sort((left, right) => right.cost - left.cost);
      const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
      const totalTokens = rows.reduce((sum, row) => sum + row.tokens.total, 0);
      periods[period] = { fromDay: bounds[period] ?? null, projects: rows, totalCost, totalTokens };
    }

    let currentProjectId = null;
    if (typeof currentSessionId === 'string' && currentSessionId !== '') {
      const record = records.find((entry) => entry.header.id === currentSessionId);
      if (record !== undefined) {
        const group = groupOf(record);
        if (projects.has(group.id)) currentProjectId = group.id;
      }
    }

    return {
      generatedAt: Date.now(),
      currency: settings.currency,
      symbol: settings.symbol,
      unit,
      estimated: false,
      priced: 'official-rates',
      currentProjectId,
      periods,
      rates: {
        unit,
        offPeakFactor: settings.offPeakFactor,
        models: settings.models,
        defaultModel: settings.defaultModel,
        peakWindows: settings.schedule.windows,
        peakWeekdays: settings.schedule.weekdays,
        holidays: settings.schedule.holidays,
      },
      official,
    };
  };

  /** Share one in-flight build; a report is cheap after the fold cache warms. */
  const report = (currentSessionId) => {
    if (building !== undefined) return building;
    building = buildReport(currentSessionId).finally(() => {
      building = undefined;
    });
    return building;
  };

  /** Answer an untrusted or unauthenticated request; true when it was rejected. */
  const rejected = (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: REPORT_PATH,
        handler: async (req, res) => {
          if (rejected(req, res)) return;
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET');
            res.end();
            return;
          }
          let currentSessionId;
          try {
            currentSessionId = new URL(String(req.url), 'http://localhost').searchParams.get('sessionId') ?? undefined;
          } catch {
            currentSessionId = undefined;
          }
          try {
            sendJson(res, 200, await report(currentSessionId));
          } catch (error) {
            sendJson(res, 500, { error: 'report-failed', message: String(error) });
          }
        },
      }),
    `api-spend: GET ${REPORT_PATH}`,
  );
}
