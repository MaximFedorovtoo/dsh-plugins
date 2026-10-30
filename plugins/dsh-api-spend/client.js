/**
 * Client half of the API-spend panel.
 *
 * Renders one ambient pill in `conversation.composer.dock` — the row below the
 * composer that already carries the token statistics — showing what this
 * project spent on API calls for the selected period, priced with the
 * provider's official rates. Clicking it opens the per-project breakdown with
 * the provider's own totals for comparison.
 */
window.__ModuleLoader__.load({
  id: 'dsh-api-spend',
  factory: (require) => {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const NS = 'api-spend';
    const SLOT = 'conversation.composer.dock';
    const REPORT_ROUTE = 'api-spend/report';
    const ORDER = 2;
    const SLOW_REFRESH_MS = 60000;
    const PERIODS = ['today', '7d', 'all'];

    const EN = {
      'pill.aria': 'API spend of this project: {amount}. Open the per-project breakdown.',
      'pill.loading': 'API spend…',
      'pill.title': 'API spend of this project at the provider rates',
      'dialog.title': 'API spend',
      'dialog.loading': 'Reading token usage…',
      'dialog.empty': 'No API usage in this period.',
      'dialog.tokens': '{count} tok',
      'dialog.period.today': 'Today',
      'dialog.period.7d': '7 days',
      'dialog.period.all': 'All time',
      'dialog.official': 'Provider platform:',
      'dialog.officialToday': '{amount} today',
      'dialog.officialTotal': '{amount} all time',
      'dialog.balance': 'balance {amount}',
      'dialog.officialNote':
        'Provider totals include every client of this API key; the project rows cover this Harness only.',
      'dialog.coverage':
        'Showing the {considered} most recent sessions of {total} — raise maxSessions in the plugin config to cover every session.',
      'dialog.rates': '{model}: {hit} cache hit · {miss} cache miss · {out} output, per {unit} tokens. Off-peak ×{factor}.',
      'dialog.peak': 'Peak: weekdays {windows} UTC.',
    };

    const RU = {
      'pill.aria': 'Расходы на API в этом проекте: {amount}. Открыть разбивку по проектам.',
      'pill.loading': 'Расходы на API…',
      'pill.title': 'Расходы на API в этом проекте по официальным тарифам',
      'dialog.title': 'Расходы на API',
      'dialog.loading': 'Читаю расход токенов…',
      'dialog.empty': 'За этот период расходов на API нет.',
      'dialog.tokens': '{count} ток',
      'dialog.period.today': 'Сегодня',
      'dialog.period.7d': '7 дней',
      'dialog.period.all': 'Всё время',
      'dialog.official': 'На платформе:',
      'dialog.officialToday': 'сегодня {amount}',
      'dialog.officialTotal': 'всего {amount}',
      'dialog.balance': 'баланс {amount}',
      'dialog.officialNote':
        'Итоги платформы включают все клиенты этого API-ключа; строки проектов — только сессии этого Harness.',
      'dialog.coverage':
        'Учтены {considered} последних сессий из {total} — увеличьте maxSessions в настройках плагина, чтобы охватить все.',
      'dialog.rates': '{model}: кэш-хит {hit} · промах {miss} · вывод {out} за {unit} токенов. Вне пика ×{factor}.',
      'dialog.peak': 'Пик: по будням {windows} UTC.',
    };

    /** Style sheet rendered beside the pill, so unmounting the entry removes it. */
    const CSS = `
.dshApiSpendAnchor{position:relative;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}
.dshApiSpendPill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
.dshApiSpendPill svg{flex:none;width:14px;height:14px}
.dshApiSpendPill:hover,.dshApiSpendPill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshApiSpendPill:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshApiSpendLabel{text-overflow:ellipsis;min-width:0;overflow:hidden}
.dshApiSpendPanel{z-index:1200;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);cursor:default;padding:14px 16px;font-size:12px;line-height:18px}
.dshApiSpendHeader{align-items:center;justify-content:space-between;gap:16px;color:var(--dsw-alias-label-primary);font-weight:500;margin-bottom:8px;display:flex}
.dshApiSpendHeaderValue{font-variant-numeric:tabular-nums;flex:none}
.dshApiSpendTabs{gap:4px;margin-bottom:8px;display:flex}
.dshApiSpendTab{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:2px 8px;font:inherit}
.dshApiSpendTab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshApiSpendTab[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshApiSpendRule{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 0 8px}
.dshApiSpendRows{flex-direction:column;gap:6px;max-height:min(240px,40vh);margin:0;padding:0;display:flex;overflow-y:auto}
.dshApiSpendRow{align-items:baseline;gap:12px;min-width:0;display:flex}
.dshApiSpendName{min-width:0;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);overflow:hidden}
.dshApiSpendRow[data-current] .dshApiSpendName{color:var(--dsw-alias-state-business-primary);font-weight:500}
.dshApiSpendMeta{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dshApiSpendCost{flex:none;min-width:76px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dshApiSpendEmpty{color:var(--dsw-alias-label-tertiary);padding:2px 0}
.dshApiSpendOfficial{color:var(--dsw-alias-label-secondary);border-top:.5px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:8px}
.dshApiSpendOfficialLine{display:flex;justify-content:space-between;gap:12px}
.dshApiSpendNote{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px}
`;

    /** Compact token count: 987, 12.3k, 1.23M. */
    function compactCount(value) {
      const count = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
      if (count >= 999500) return `${(count / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
      if (count >= 950) return `${(count / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
      return String(Math.round(count));
    }

    /** Money with enough decimals to stay meaningful below one unit. */
    function formatMoney(value, symbol) {
      const currency = typeof symbol === 'string' && symbol !== '' ? symbol : '$';
      const amount = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
      if (amount >= 1) return `${currency}${amount.toFixed(2)}`;
      if (amount >= 0.01) return `${currency}${amount.toFixed(3)}`;
      if (amount === 0) return `${currency}0`;
      return `${currency}${amount.toFixed(4)}`;
    }

    /** Rate figures: keep significant digits, drop trailing zeros. */
    function formatRate(value) {
      const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      if (amount === 0) return '0';
      const digits = amount >= 100 ? 0 : amount >= 1 ? 2 : amount >= 0.01 ? 3 : 4;
      return amount.toFixed(digits).replace(/\.?0+$/, '');
    }

    /** Symbol for a currency code reported by the platform. */
    function currencySymbol(currency) {
      return currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `;
    }

    /** Translate with a fallback, so a missing dictionary never shows a raw key. */
    function translateWith(t, key, params, fallback) {
      const value = typeof t === 'function' ? t(key, params) : key;
      return value === key || typeof value !== 'string' ? fallback : value;
    }

    /** Coin glyph, drawn in the theme's text color so it follows light and dark. */
    function CoinIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none' },
        h('circle', { cx: 8, cy: 8, r: 6.25, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M8 4.4v7.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', {
          d: 'M10.1 6.1c-.4-.55-1.05-.85-1.9-.85-1.2 0-2 .62-2 1.42 0 .92.9 1.2 2.02 1.47 1.12.27 2.03.55 2.03 1.5 0 .9-.9 1.5-2.1 1.5-.9 0-1.65-.3-2.1-.9',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * Read the report from the Host half.
     * @param sessionId - the open Session, used to mark its project.
     * @param refreshKey - changes when a turn settles or the slow timer fires.
     * @returns `{ status, data }`.
     */
    function useSpendReport(sessionId, refreshKey) {
      const [state, setState] = React.useState({ status: 'loading', data: null });
      React.useEffect(() => {
        let alive = true;
        const controller = new AbortController();
        setState((previous) => (previous.data === null ? { status: 'loading', data: null } : previous));
        const query =
          typeof sessionId === 'string' && sessionId !== ''
            ? `?sessionId=${encodeURIComponent(sessionId)}`
            : '';
        fetch(`${REPORT_ROUTE}${query}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((data) => {
            if (alive) setState({ status: 'ready', data });
          })
          .catch((error) => {
            if (!alive) return;
            // Leave one trace for the browser console; the pill stays hidden on failure.
            try {
              if (error?.name !== 'AbortError') console.warn('[api-spend] spend report unavailable', error);
            } catch {
              // Console access is not worth a render failure.
            }
            setState((previous) => (previous.data === null ? { status: 'error', data: null } : previous));
          });
        return () => {
          alive = false;
          controller.abort();
        };
      }, [sessionId, refreshKey]);
      return state;
    }

    /** One pill plus its anchored breakdown dialog. */
    function ApiSpendPill(props) {
      const sessionId = props.sessionId;
      const t = props.t;
      const usage = typeof props.useProjection === 'function' ? props.useProjection('tokenUsage') : undefined;

      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        const timer = window.setInterval(() => setTick((value) => value + 1), SLOW_REFRESH_MS);
        return () => window.clearInterval(timer);
      }, []);

      const [open, setOpen] = React.useState(false);
      const [period, setPeriod] = React.useState('today');
      const [position, setPosition] = React.useState(null);
      const anchorRef = React.useRef(null);
      const panelRef = React.useRef(null);

      const tokenSum =
        usage === undefined
          ? 0
          : (usage.uncachedInputTokens ?? 0) +
            (usage.outputTokens ?? 0) +
            (usage.cacheReadTokens ?? 0) +
            (usage.cacheWriteTokens ?? 0);
      const state = useSpendReport(sessionId, `${tokenSum}:${tick}:${open ? 1 : 0}`);

      const data = state.status === 'ready' ? state.data : null;
      const periods = data !== null && data.periods !== undefined && data.periods !== null ? data.periods : {};
      const selected = periods[period] ?? periods.today ?? null;
      const projects = Array.isArray(selected?.projects) ? selected.projects : [];
      const symbol = data !== null && typeof data.symbol === 'string' ? data.symbol : '$';
      const currentRow =
        data === null || data.currentProjectId === null || data.currentProjectId === undefined
          ? undefined
          : projects.find((row) => row.id === data.currentProjectId);
      const amount = currentRow === undefined ? 0 : currentRow.cost;

      const place = React.useCallback(() => {
        const node = anchorRef.current;
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        const width = Math.min(420, Math.max(260, window.innerWidth - 24));
        const left = Math.min(
          Math.max(12, rect.left + rect.width / 2 - width / 2),
          window.innerWidth - width - 12,
        );
        setPosition({ left, width, bottom: Math.max(12, window.innerHeight - rect.top + 8) });
      }, []);

      const toggle = React.useCallback(() => {
        if (!open) place();
        setOpen(!open);
      }, [open, place]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (panelRef.current !== null && panelRef.current.contains(target)) return;
          if (anchorRef.current !== null && anchorRef.current.contains(target)) return;
          setOpen(false);
        };
        const onLayout = () => place();
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('resize', onLayout);
        window.addEventListener('scroll', onLayout, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
          window.removeEventListener('resize', onLayout);
          window.removeEventListener('scroll', onLayout, true);
        };
      }, [open, place]);

      if (state.status === 'error') return null;
      const truncated =
        data !== null && data.sessions !== undefined && data.sessions !== null && data.sessions.truncated === true;
      // A truncated session window must never silently hide the pill: the real
      // spend may live outside the covered sessions.
      if (data !== null && projects.length === 0 && period === 'today' && !truncated) return null;

      const label =
        state.status === 'ready'
          ? formatMoney(amount, symbol)
          : translateWith(t, 'pill.loading', undefined, 'API spend…');
      const ariaLabel = translateWith(t, 'pill.aria', { amount: label }, `API spend: ${label}`);

      const rows =
        state.status !== 'ready'
          ? [
              h(
                'div',
                { key: 'loading', className: 'dshApiSpendEmpty' },
                translateWith(t, 'dialog.loading', undefined, 'Reading token usage…'),
              ),
            ]
          : projects.length === 0
            ? [
                h(
                  'div',
                  { key: 'empty', className: 'dshApiSpendEmpty' },
                  translateWith(t, 'dialog.empty', undefined, 'No API usage in this period.'),
                ),
              ]
            : projects.map((row) =>
                h(
                  'div',
                  {
                    key: row.id,
                    className: 'dshApiSpendRow',
                    'data-current': row.id === data?.currentProjectId ? '' : undefined,
                    title: typeof row.path === 'string' && row.path !== '' ? row.path : row.title,
                  },
                  h('span', { className: 'dshApiSpendName' }, row.title),
                  h(
                    'span',
                    { className: 'dshApiSpendMeta' },
                    translateWith(
                      t,
                      'dialog.tokens',
                      { count: compactCount(row.tokens === undefined ? 0 : row.tokens.total) },
                      `${compactCount(row.tokens === undefined ? 0 : row.tokens.total)} tok`,
                    ),
                  ),
                  h('span', { className: 'dshApiSpendCost' }, formatMoney(row.cost, symbol)),
                ),
              );

      const official = data !== null && data.official !== null && typeof data.official === 'object' ? data.official : null;
      const officialLines = [];
      if (official !== null) {
        const formatAmounts = (rowsOfAmounts) =>
          Array.isArray(rowsOfAmounts) && rowsOfAmounts.length > 0
            ? rowsOfAmounts
                .map((row) => `${currencySymbol(row.currency)}${formatRate(Number(row.amount))}`)
                .join(' · ')
            : '';
        if (period === 'today') {
          const text = formatAmounts(official.todayCost);
          if (text !== '') {
            officialLines.push(
              translateWith(t, 'dialog.officialToday', { amount: text }, `${text} today`),
            );
          }
        } else if (period === 'all') {
          const text = formatAmounts(
            (official.totalCosts ?? []).map((row) => ({ currency: row.currency, amount: row.amount })),
          );
          if (text !== '') {
            officialLines.push(translateWith(t, 'dialog.officialTotal', { amount: text }, `${text} all time`));
          }
        }
        if (Array.isArray(official.balance) && official.balance.length > 0) {
          const text = official.balance
            .map((wallet) => `${currencySymbol(wallet.currency)}${formatRate(Number(wallet.balance))}`)
            .join(' · ');
          officialLines.push(translateWith(t, 'dialog.balance', { amount: text }, `balance ${text}`));
        }
      }

      const rates = data !== null && data.rates !== undefined && data.rates !== null ? data.rates : null;
      const rateLines = [];
      if (rates !== null && rates.models !== null && typeof rates.models === 'object') {
        const models = Object.entries(rates.models).map(([model, rate]) => ({
          model,
          hit: rate?.cacheHit,
          miss: rate?.cacheMiss,
          out: rate?.output,
        }));
        for (const rate of models) {
          const hit = `${symbol}${formatRate(rate.hit)}`;
          const miss = `${symbol}${formatRate(rate.miss)}`;
          const out = `${symbol}${formatRate(rate.out)}`;
          rateLines.push(
            translateWith(
              t,
              'dialog.rates',
              { model: rate.model, hit, miss, out, unit: compactCount(rates.unit), factor: formatRate(rates.offPeakFactor) },
              `${rate.model}: ${hit} / ${miss} / ${out}`,
            ),
          );
        }
      }

      const panel =
        open && position !== null
          ? ReactDOM.createPortal(
              h(
                'div',
                {
                  ref: panelRef,
                  className: 'dshApiSpendPanel',
                  role: 'dialog',
                  'aria-label': translateWith(t, 'dialog.title', undefined, 'API spend'),
                  style: {
                    position: 'fixed',
                    left: `${position.left}px`,
                    width: `${position.width}px`,
                    bottom: `${position.bottom}px`,
                  },
                },
                h(
                  'div',
                  { className: 'dshApiSpendHeader' },
                  h('span', null, translateWith(t, 'dialog.title', undefined, 'API spend')),
                  h(
                    'span',
                    { className: 'dshApiSpendHeaderValue' },
                    selected === null ? '' : formatMoney(selected.totalCost, symbol),
                  ),
                ),
                h(
                  'div',
                  { className: 'dshApiSpendTabs', role: 'group' },
                  PERIODS.map((key) =>
                    h(
                      'button',
                      {
                        key,
                        type: 'button',
                        className: 'dshApiSpendTab',
                        'aria-pressed': period === key,
                        onClick: () => setPeriod(key),
                      },
                      translateWith(t, `dialog.period.${key}`, undefined, key),
                    ),
                  ),
                ),
                h('div', { className: 'dshApiSpendRule', 'aria-hidden': true }),
                h('div', { className: 'dshApiSpendRows' }, rows),
                truncated
                  ? h(
                      'div',
                      { className: 'dshApiSpendNote' },
                      translateWith(
                        t,
                        'dialog.coverage',
                        { considered: data.sessions.considered, total: data.sessions.total },
                        `Showing the ${data.sessions.considered} most recent sessions of ${data.sessions.total}.`,
                      ),
                    )
                  : null,
                official !== null && officialLines.length > 0
                  ? h(
                      'div',
                      { className: 'dshApiSpendOfficial' },
                      h(
                        'div',
                        { className: 'dshApiSpendOfficialLine' },
                        h('span', null, translateWith(t, 'dialog.official', undefined, 'Provider platform:')),
                        h('span', null, officialLines.join(' · ')),
                      ),
                      h(
                        'div',
                        { className: 'dshApiSpendNote' },
                        translateWith(
                          t,
                          'dialog.officialNote',
                          undefined,
                          'Provider totals include every client of this API key.',
                        ),
                      ),
                    )
                  : null,
                rateLines.length > 0
                  ? h(
                      'div',
                      { className: 'dshApiSpendNote' },
                      rateLines.join(' '),
                      rates.peakWindows !== undefined
                        ? ` ${translateWith(
                            t,
                            'dialog.peak',
                            {
                              windows: rates.peakWindows
                                .map((window) => `${String(window.start).padStart(2, '0')}–${String(window.end).padStart(2, '0')}`)
                                .join(', '),
                            },
                            '',
                          )}`
                        : '',
                    )
                  : null,
              ),
              document.body,
            )
          : null;

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'span',
          { key: 'anchor', className: 'dshApiSpendAnchor', ref: anchorRef },
          h(
            'button',
            {
              type: 'button',
              className: 'dshApiSpendPill',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': ariaLabel,
              title: translateWith(t, 'pill.title', undefined, 'API spend'),
              onClick: toggle,
            },
            h(CoinIcon, null),
            h('span', { className: 'dshApiSpendLabel' }, label),
          ),
          panel,
        ),
      );
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, ru: RU }), 'api-spend: locale dictionaries');
        ctx.effect(
          () =>
            ctx.slots.inject(SLOT, () =>
              ctx.slots.register({ name: SLOT, id: 'api-spend', order: ORDER, locale: NS }, ApiSpendPill),
            ),
          'api-spend: composer dock pill',
        );
      },
    };
  },
});
