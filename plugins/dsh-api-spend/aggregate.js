/**
 * Pure accounting for the API-spend panel: fold provider-reported token usage
 * out of one Session log, price it with the provider's published rates
 * (peak/off-peak aware), and merge sessions into projects.
 *
 * This module deliberately imports nothing from the Harness so plain Node can
 * exercise it against synthetic logs.
 *
 * Token buckets follow the token-meter projection: uncached prompt input
 * (`input`), cache-read input (`cacheRead`), cache-write input (`cacheWrite`),
 * and completion output (`output`). `cacheWrite` is billed as a cache miss.
 */

/** Model key used when a usage report cannot be attributed to a model route. */
export const UNKNOWN_MODEL = 'unknown';

/** Token bucket shape. */
export function emptyBuckets() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Last usage chunk embedded in a durable Assistant stream.
 * @param stream - compact `AssistantStreamRecord[]` from one settlement.
 * @returns the reported usage object, or undefined.
 */
export function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record === null || typeof record !== 'object') continue;
    if (record.type !== 'chunk') continue;
    const chunk = record.chunk;
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage') return chunk.usage;
  }
  return undefined;
}

/**
 * Normalize one provider usage report into token buckets.
 * @param usage - `TokenUsage`-shaped data or anything else; invalid reports are ignored.
 * @returns buckets, or undefined when a required count is missing or malformed.
 */
export function bucketsFrom(usage) {
  if (usage === null || typeof usage !== 'object') return undefined;
  if (!isCount(usage.inputTokens) || !isCount(usage.outputTokens)) return undefined;
  const cacheRead = usage.cacheReadTokens === undefined ? 0 : usage.cacheReadTokens;
  const cacheWrite = usage.cacheWriteTokens === undefined ? 0 : usage.cacheWriteTokens;
  if (!isCount(cacheRead) || !isCount(cacheWrite)) return undefined;
  return { input: usage.inputTokens, output: usage.outputTokens, cacheRead, cacheWrite };
}

const addBuckets = (left, right) => ({
  input: left.input + right.input,
  output: left.output + right.output,
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWrite: left.cacheWrite + right.cacheWrite,
});

const subtractBuckets = (left, right) => ({
  input: left.input - right.input,
  output: left.output - right.output,
  cacheRead: left.cacheRead - right.cacheRead,
  cacheWrite: left.cacheWrite - right.cacheWrite,
});

const emptyWindows = () => ({ peak: emptyBuckets(), offPeak: emptyBuckets() });

/** Window pair holding one bucket set in the named price window. */
const windowsOf = (window, buckets) =>
  window === 'peak'
    ? { peak: buckets, offPeak: emptyBuckets() }
    : { peak: emptyBuckets(), offPeak: buckets };

const addWindows = (left, right) => ({
  peak: addBuckets(left.peak, right.peak),
  offPeak: addBuckets(left.offPeak, right.offPeak),
});

const subtractWindows = (left, right) => ({
  peak: subtractBuckets(left.peak, right.peak),
  offPeak: subtractBuckets(left.offPeak, right.offPeak),
});

const windowsEmpty = (windows) => {
  for (const buckets of [windows.peak, windows.offPeak]) {
    if (buckets.input !== 0 || buckets.output !== 0 || buckets.cacheRead !== 0 || buckets.cacheWrite !== 0) return false;
  }
  return true;
};

/**
 * Local calendar day key (`YYYY-MM-DD`) for one event timestamp.
 *
 * Pure arithmetic instead of locale formatting: `toLocaleDateString` depends on
 * ICU locale data (a trimmed runtime could return `10/27/2026`), and these keys
 * are compared and sorted as strings.
 * @param ms - epoch milliseconds.
 * @returns the day in the host's time zone.
 */
export function localDayKey(ms) {
  const time = typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
  const offsetMs = new Date(time).getTimezoneOffset() * 60000;
  return new Date(time - offsetMs).toISOString().slice(0, 10);
}

/**
 * Beijing-time day key used by the provider's Chinese-holiday rule.
 * @param ms - epoch milliseconds.
 * @returns `YYYY-MM-DD` in UTC+8.
 */
export function beijingDayKey(ms) {
  const shifted = new Date((typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now()) + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Whether one event time falls in the provider's peak-price window.
 * Peak is the configured UTC hour ranges on the configured weekdays, excluding
 * configured Chinese public holidays (compared in Beijing time).
 * @param ms - epoch milliseconds.
 * @param schedule - `{ windows: [{start,end}], weekdays: number[], holidays: string[] }`.
 * @returns true for peak rates.
 */
export function isPeakTime(ms, schedule) {
  const time = typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
  const weekdays = Array.isArray(schedule?.weekdays) ? schedule.weekdays : [1, 2, 3, 4, 5];
  const windows = Array.isArray(schedule?.windows) ? schedule.windows : [];
  const holidays = Array.isArray(schedule?.holidays) ? schedule.holidays : [];
  if (holidays.includes(beijingDayKey(time))) return false;
  const date = new Date(time);
  if (!weekdays.includes(date.getUTCDay())) return false;
  const hour = date.getUTCHours();
  return windows.some((window) => hour >= window.start && hour < window.end);
}

/**
 * Model key reported by an assembled Assistant message.
 * @param message - `AssistantMessage` whose source carries provider and model.
 * @returns the model id, the provider id, or {@link UNKNOWN_MODEL}.
 */
export function routeOf(message) {
  const source = message === null || typeof message !== 'object' ? undefined : message.source;
  if (source === null || typeof source !== 'object') return UNKNOWN_MODEL;
  if (typeof source.model === 'string' && source.model !== '') return source.model;
  if (typeof source.provider === 'string' && source.provider !== '') return source.provider;
  return UNKNOWN_MODEL;
}

/**
 * Fold one Session log into per-day, per-model, peak/off-peak token buckets.
 *
 * Settlement rules follow the token-meter projection: only
 * `assistant/message` and `assistant/attempt` carry usage samples, one sample
 * per (turn, step) is the step's truth, a later sample replaces the earlier
 * one, and `llm/retry-started` closes the slot so the retried attempt counts on
 * its own. Each surviving sample is attributed to the wall-clock day and price
 * window of the event that reported it.
 *
 * @param events - the Session's durable events in ascending seq order.
 * @param schedule - peak-price schedule; see {@link isPeakTime}.
 * @returns a Map from `"<local day>\u0000<model>"` to `{ peak, offPeak }` buckets.
 */
export function foldSessionUsage(events, schedule) {
  /** stepKey -> { model, day, window, buckets } */
  const steps = new Map();
  const totals = new Map();

  const adjust = (key, windows, sign) => {
    const previous = totals.get(key) ?? emptyWindows();
    const next = sign > 0 ? addWindows(previous, windows) : subtractWindows(previous, windows);
    if (windowsEmpty(next)) totals.delete(key);
    else totals.set(key, next);
  };

  const setStep = (stepKey, entry) => {
    const previous = steps.get(stepKey);
    if (previous !== undefined) {
      adjust(`${previous.day}\u0000${previous.model}`, windowsOf(previous.window, previous.buckets), -1);
    }
    if (entry === undefined) {
      steps.delete(stepKey);
      return;
    }
    steps.set(stepKey, entry);
    adjust(`${entry.day}\u0000${entry.model}`, windowsOf(entry.window, entry.buckets), 1);
  };

  if (!Array.isArray(events)) return totals;

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    const data = event.data;
    if (data === null || typeof data !== 'object') continue;

    if (event.type === 'llm/retry-started') {
      setStep(`${data.turn}:${data.step}`, undefined);
      continue;
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;

    const usage = data.usage !== undefined ? data.usage : lastStreamUsage(data.stream);
    const buckets = bucketsFrom(usage);
    if (buckets === undefined) continue;

    const stepKey = `${data.turn}:${data.step}`;
    const previous = steps.get(stepKey);
    const model =
      event.type === 'assistant/message'
        ? routeOf(data.message)
        : previous !== undefined
          ? previous.model
          : UNKNOWN_MODEL;
    const time = typeof event.time === 'number' ? event.time : Date.now();
    const day = localDayKey(time);
    const window = isPeakTime(time, schedule) ? 'peak' : 'offPeak';
    setStep(stepKey, { model, day, window, buckets });
  }
  return totals;
}

/** Normalize one rate entry; omitted fields fall back to the fallback rate. */
export function normalizeRate(rate, fallback) {
  const base = fallback ?? { cacheHit: 0, cacheMiss: 0, output: 0 };
  const pick = (field) => {
    const value = rate === null || typeof rate !== 'object' ? undefined : rate[field];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : base[field] ?? 0;
  };
  return { cacheHit: pick('cacheHit'), cacheMiss: pick('cacheMiss'), output: pick('output') };
}

/**
 * Resolve the peak/off-peak rate for one model id.
 * @param model - model id reported by the provider.
 * @param pricing - `{ models, defaultModel, offPeakFactor }`.
 * @returns `{ peak: rate, offPeak: rate }` in currency units per `unit` tokens.
 */
export function ratesOf(model, pricing) {
  const models = pricing !== null && typeof pricing === 'object' && pricing.models !== null && typeof pricing.models === 'object'
    ? pricing.models
    : {};
  const fallbackModel = typeof pricing?.defaultModel === 'string' ? pricing.defaultModel : 'deepseek-flash';
  const chosen = Object.hasOwn(models, model) ? models[model] : models[fallbackModel];
  const peak = normalizeRate(chosen, { cacheHit: 0, cacheMiss: 0, output: 0 });
  const factor =
    typeof pricing?.offPeakFactor === 'number' && Number.isFinite(pricing.offPeakFactor) && pricing.offPeakFactor >= 0 && pricing.offPeakFactor <= 1
      ? pricing.offPeakFactor
      : 0.5;
  return {
    peak,
    offPeak: {
      cacheHit: peak.cacheHit * factor,
      cacheMiss: peak.cacheMiss * factor,
      output: peak.output * factor,
    },
  };
}

/**
 * Money for one window's buckets at one rate.
 * @param buckets - token buckets.
 * @param rate - `{ cacheHit, cacheMiss, output }` per `unit` tokens.
 * @param unit - token count the rate is quoted for.
 * @returns cost in the configured currency.
 */
export function costOfBuckets(buckets, rate, unit) {
  const divisor = typeof unit === 'number' && Number.isFinite(unit) && unit > 0 ? unit : 1_000_000;
  const total =
    (buckets.input + buckets.cacheWrite) * rate.cacheMiss +
    buckets.cacheRead * rate.cacheHit +
    buckets.output * rate.output;
  return total / divisor;
}

/**
 * Money for one day/model entry.
 * @param windows - `{ peak, offPeak }` buckets.
 * @param rates - `{ peak, offPeak }` rates from {@link ratesOf}.
 * @param unit - token count the rates are quoted for.
 * @returns cost in the configured currency.
 */
export function costOfWindows(windows, rates, unit) {
  return costOfBuckets(windows.peak, rates.peak, unit) + costOfBuckets(windows.offPeak, rates.offPeak, unit);
}

/** Sum every bucket of a window pair. */
export function totalBuckets(windows) {
  return addBuckets(windows.peak, windows.offPeak);
}

/**
 * Serialize token buckets for the wire with a total.
 * @param buckets - token buckets.
 * @returns JSON-safe token counts.
 */
export function bucketsToJson(buckets) {
  return {
    input: buckets.input,
    cacheRead: buckets.cacheRead,
    cacheWrite: buckets.cacheWrite,
    output: buckets.output,
    total: buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output,
  };
}

/** A fresh project accumulator keyed by workspace id or canonical directory. */
export function emptyProject(id, title, path) {
  return {
    id,
    title,
    path,
    sessionCount: 0,
    /** model -> Map(day -> { peak, offPeak }) */
    models: new Map(),
  };
}

/**
 * Add one session's folded buckets to a project accumulator.
 * @param project - accumulator from {@link emptyProject}.
 * @param fold - Map from `foldSessionUsage`.
 */
export function addSessionFold(project, fold) {
  project.sessionCount += 1;
  for (const [key, windows] of fold) {
    const separator = key.indexOf('\u0000');
    const day = key.slice(0, separator);
    const model = key.slice(separator + 1);
    let days = project.models.get(model);
    if (days === undefined) {
      days = new Map();
      project.models.set(model, days);
    }
    days.set(day, addWindows(days.get(day) ?? emptyWindows(), windows));
  }
}

/**
 * Price a project for one period.
 * @param project - accumulator from {@link emptyProject}.
 * @param pricing - price configuration; see {@link ratesOf}.
 * @param unit - token count the rates are quoted for.
 * @param fromDay - inclusive `YYYY-MM-DD` lower bound, or undefined for all days.
 * @returns `{ id, title, path, sessionCount, cost, tokens:{...}, models:[...] }`.
 */
export function projectForPeriod(project, pricing, unit, fromDay) {
  const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let cost = 0;
  const models = [];
  for (const [model, days] of project.models) {
    const rates = ratesOf(model, pricing);
    const modelTokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    let modelCost = 0;
    for (const [day, windows] of days) {
      if (fromDay !== undefined && day < fromDay) continue;
      modelCost += costOfWindows(windows, rates, unit);
      const buckets = totalBuckets(windows);
      modelTokens.input += buckets.input;
      modelTokens.cacheRead += buckets.cacheRead;
      modelTokens.cacheWrite += buckets.cacheWrite;
      modelTokens.output += buckets.output;
    }
    if (modelTokens.input + modelTokens.cacheRead + modelTokens.cacheWrite + modelTokens.output === 0) continue;
    tokens.input += modelTokens.input;
    tokens.cacheRead += modelTokens.cacheRead;
    tokens.cacheWrite += modelTokens.cacheWrite;
    tokens.output += modelTokens.output;
    cost += modelCost;
    models.push({ model, cost: modelCost, tokens: bucketsToJson(modelTokens) });
  }
  models.sort((left, right) => right.cost - left.cost);
  return {
    id: project.id,
    title: project.title,
    path: project.path,
    sessionCount: project.sessionCount,
    cost,
    tokens: bucketsToJson(tokens),
    models,
  };
}

/**
 * Canonical directory spelling used to match a Session cwd to a Workspace path.
 * Trailing separators of either platform are dropped; the body keeps the
 * spelling it was given so Windows drive paths survive unchanged.
 * @param value - raw path or undefined.
 * @returns the normalized path, or undefined.
 */
export function normalizePath(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  const trimmed = value.replace(/[\\/]+$/, '');
  if (trimmed !== '') return trimmed;
  // A root path keeps its one separator ("/" or "\\") instead of collapsing to "".
  return /^[\\/]/.test(value) ? value.slice(0, 1) : value;
}
