/**
 * dsh-project-portability — client half (Web UI), minimal working skeleton.
 *
 * Loaded by the DSH web shell through `window.__ModuleLoader__.load({ id, factory })`.
 * `id` must be the npm package name that declares `dsh.client` in package.json
 * (the same id the host composes from `exports["./client"]`).
 *
 * What it does:
 *   - registers locale dictionaries (ru + en) in namespace `project-portability`;
 *   - registers the sidebar row (`sidebar.panellist`, id `project-portability`);
 *   - registers the page (`main`, key `project-portability`);
 *   - talks to host routes via same-origin `fetch`:
 *       GET  /api/portability/projects
 *       POST /api/portability/export   { project }
 *       POST /api/portability/import   { archive, targetDir? }
 *
 * Contract notes (see client-pattern.md for file:line references):
 *   - only `react` is required: it is part of the shell's static module table;
 *   - the factory returns a Cordis plugin object `{ name, inject, apply }`;
 *   - registrations go through `ctx.slots.inject(slot, () => ctx.slots.register(options, Component))`;
 *   - host copy is never hardcoded: `t = locale.bind(NS)` plus a ru fallback.
 */
window.__ModuleLoader__.load({
  id: 'dsh-project-portability',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this client half. */
    const NS = 'project-portability';
    /** Panel key: the sidebar row id and the `main` keyed-slot key must match. */
    const PANEL_ID = 'project-portability';
    /** Host routes registered by index.js through `ctx.connection.fetch.register`. */
    const PROJECTS_URL = '/api/portability/projects';
    const EXPORT_URL = '/api/portability/export';
    const IMPORT_URL = '/api/portability/import';

    const CODE_FONT = 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';
    const FOCUS_RING = 'var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))';
    const TRANSITION = 'var(--ds-transition-duration-fast, 120ms)';

    const ru = {
      'panel': 'Перенос проектов',
      'page.title': 'Перенос проектов',
      'page.subtitle': 'Экспортируйте проект в архив и импортируйте его на другой машине: файлы, рабочая область и история чата.',
      'page.refresh': 'Обновить',
      'page.refreshBusy': 'Обновление…',
      'state.loading': 'Читаю список проектов…',
      'state.loadError': 'Не удалось прочитать список проектов',
      'state.retry': 'Повторить',
      'state.empty': 'Проектов пока нет',
      'state.emptyHint': 'Создайте рабочую область в DSH — проект появится здесь.',
      'project.sessions': 'Чатов: {count}',
      'project.paths': 'Путь: {path}',
      'project.noPaths': 'Путь не записан',
      'project.export': 'Экспортировать',
      'project.exporting': 'Экспорт…',
      'import.title': 'Импорт архива',
      'import.hint': 'Путь к архиву .dshpack на этой машине (например, с внешнего диска). Пустое поле — последний архив из папки экспорта.',
      'import.placeholder': 'D:\\backup\\project-2026-10-30.dshpack',
      'import.action': 'Импортировать архив',
      'import.running': 'Импорт…',
      'import.archives': 'Архивы в папке экспорта:',
      'action.running': 'Выполняю…',
      'error.title': 'Не получилось',
      'error.network': 'Нет связи с DSH',
      'error.badResponse': 'Сервер вернул неожиданный ответ',
      'error.noWorkspace': 'Сервис рабочих областей недоступен, чат не открыть',
      'error.noArchive': 'Укажите путь к архиву или экспортируйте проект сначала',
      'result.title': 'Готово',
      'result.exported': 'Экспорт завершён',
      'result.imported': 'Импорт завершён',
      'result.archive': 'Архив',
      'result.target': 'Папка проекта',
      'result.workspace': 'Рабочая область',
      'result.files': 'Файлов',
      'result.bytes': 'Размер',
      'result.sessions': 'Чатов',
      'result.attachments': 'Вложений',
      'result.messages': 'Сообщений',
      'result.warnings': 'Предупреждения',
      'result.open': 'Открыть чат',
      'result.dismiss': 'Закрыть',
    };

    const en = {
      'panel': 'Project portability',
      'page.title': 'Project portability',
      'page.subtitle': 'Export a project into an archive and import it on another machine: files, workspace and chat history.',
      'page.refresh': 'Refresh',
      'page.refreshBusy': 'Refreshing…',
      'state.loading': 'Reading the project list…',
      'state.loadError': 'Could not read the project list',
      'state.retry': 'Try again',
      'state.empty': 'No projects yet',
      'state.emptyHint': 'Create a workspace in DSH and the project shows up here.',
      'project.sessions': 'Chats: {count}',
      'project.paths': 'Path: {path}',
      'project.noPaths': 'No path recorded',
      'project.export': 'Export',
      'project.exporting': 'Exporting…',
      'import.title': 'Import an archive',
      'import.hint': 'Path to a .dshpack archive on this machine (for example on an external drive). Leave it empty to use the newest archive in the export folder.',
      'import.placeholder': 'D:\\backup\\project-2026-10-30.dshpack',
      'import.action': 'Import archive',
      'import.running': 'Importing…',
      'import.archives': 'Archives in the export folder:',
      'action.running': 'Working…',
      'error.title': 'Something went wrong',
      'error.network': 'No connection to DSH',
      'error.badResponse': 'The server returned an unexpected response',
      'error.noWorkspace': 'The workspace service is unavailable, so the chat cannot be opened',
      'error.noArchive': 'Provide an archive path or export a project first',
      'result.title': 'Done',
      'result.exported': 'Export complete',
      'result.imported': 'Import complete',
      'result.archive': 'Archive',
      'result.target': 'Project folder',
      'result.workspace': 'Workspace',
      'result.files': 'Files',
      'result.bytes': 'Size',
      'result.sessions': 'Chats',
      'result.attachments': 'Attachments',
      'result.messages': 'Messages',
      'result.warnings': 'Warnings',
      'result.open': 'Open chat',
      'result.dismiss': 'Dismiss',
    };

    /** `{name}` interpolation used only when the locale service is unavailable. */
    function interpolate(template, params) {
      if (params === undefined || params === null) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    /**
     * Build the page translator. With a live locale service the bound function
     * follows language switches; otherwise the ru dictionary keeps the UI readable.
     */
    function makeTranslate(locale) {
      const bound = locale !== undefined && locale !== null && typeof locale.bind === 'function' ? locale.bind(NS) : null;
      return function t(key, params) {
        let value = null;
        if (bound !== null) {
          try {
            value = bound(key, params);
          } catch (error) {
            value = null;
          }
        }
        if (typeof value !== 'string' || value === key) {
          const template = ru[key] !== undefined ? ru[key] : key;
          value = interpolate(template, params);
        }
        return value;
      };
    }

    /** Only --dsw-alias-* colors and layout tokens: the theme owns the palette. */
    const T = {
      text: 'var(--dsw-alias-label-primary)',
      textSecondary: 'var(--dsw-alias-label-secondary)',
      textMuted: 'var(--dsw-alias-label-tertiary)',
      bg: 'var(--dsw-alias-bg-base)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l3)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      primaryFill: 'var(--dsw-alias-button-primary-fill)',
      primaryFillHover: 'var(--dsw-alias-button-primary-hover)',
      primaryText: 'var(--dsw-alias-label-primary-foreground)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    };

    const BUTTON_BASE = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      border: 'none',
      borderRadius: 'var(--dsw-radius-md)',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: '22px',
      height: 36,
      padding: '0 14px',
      color: T.text,
      background: 'transparent',
      transition: 'background-color ' + TRANSITION + ' ease',
    };

    function buttonStyle(variant, hover, focus, disabled) {
      const style = Object.assign({}, BUTTON_BASE);
      if (variant === 'primary') {
        style.background = hover && !disabled ? T.primaryFillHover : T.primaryFill;
        style.color = T.primaryText;
      } else if (variant === 'outline') {
        style.border = '0.5px solid ' + T.borderStrong;
        style.background = hover && !disabled ? T.hover : 'transparent';
      } else if (variant === 'ghost') {
        style.color = T.textSecondary;
        style.background = hover && !disabled ? T.hover : 'transparent';
      }
      if (focus) {
        style.outline = '2px solid ' + FOCUS_RING;
        style.outlineOffset = '-2px';
      }
      if (disabled) {
        style.cursor = 'not-allowed';
        style.opacity = 0.45;
      }
      return style;
    }

    const S = {
      page: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        background: T.bg,
        color: T.text,
        fontSize: 14,
        lineHeight: '22px',
      },
      scroll: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' },
      content: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        padding: '28px clamp(20px, 4vw, 44px) 48px',
      },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      headText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 320px' },
      h1: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 500, color: T.text },
      subtitle: { margin: 0, fontSize: 13, lineHeight: '20px', color: T.textMuted, maxWidth: 640 },
      importCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 16px',
        border: '0.5px solid ' + T.border,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      importTitle: { fontSize: 14, lineHeight: '22px', fontWeight: 500, color: T.text },
      importHint: { fontSize: 12, lineHeight: '18px', color: T.textMuted },
      importRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
      input: {
        boxSizing: 'border-box',
        flex: '1 1 320px',
        minWidth: 0,
        height: 36,
        padding: '0 12px',
        border: '0.5px solid ' + T.borderStrong,
        borderRadius: 'var(--dsw-radius-md)',
        background: T.surfaceAlt,
        color: T.text,
        fontFamily: CODE_FONT,
        fontSize: 12,
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 16px',
        border: '0.5px solid ' + T.border,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      cardBody: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 260px' },
      cardTitle: { fontSize: 14, lineHeight: '22px', fontWeight: 500, color: T.text, overflowWrap: 'anywhere' },
      mono: { fontFamily: CODE_FONT, color: T.textMuted, overflowWrap: 'anywhere', fontSize: 12, lineHeight: '18px' },
      badgeRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
      badge: {
        fontSize: 11,
        lineHeight: '16px',
        padding: '1px 7px',
        borderRadius: 999,
        background: T.surfaceAlt,
        color: T.success,
      },
      stateRow: { padding: '8px 0', color: T.textMuted, fontSize: 13 },
      emptyCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '24px 16px',
        border: '0.5px dashed ' + T.borderStrong,
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'transparent',
      },
      emptyTitle: { fontSize: 14, fontWeight: 500, color: T.text },
      emptyHint: { fontSize: 12, lineHeight: '18px', color: T.textMuted },
      progress: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        border: '0.5px solid ' + T.border,
        borderLeft: '3px solid ' + T.primaryFill,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
        color: T.textSecondary,
        fontSize: 13,
      },
      error: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        padding: '12px 14px',
        border: '0.5px solid ' + T.border,
        borderLeft: '3px solid ' + T.error,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      errorTitle: { fontSize: 13, fontWeight: 500, color: T.text },
      errorText: { fontSize: 12, lineHeight: '18px', color: T.error, overflowWrap: 'anywhere' },
      result: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        border: '0.5px solid ' + T.border,
        borderLeft: '3px solid ' + T.success,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      resultHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      resultTitle: { fontSize: 13, fontWeight: 500, color: T.text },
      resultRow: { display: 'flex', gap: 6, minWidth: 0, flexWrap: 'wrap', fontSize: 12, lineHeight: '18px' },
      resultKey: { color: T.textSecondary, flex: '0 0 auto' },
      resultActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
    };

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function textOf(value) {
      return typeof value === 'string' ? value : '';
    }

    function countOf(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    }

    /** Render 1536 as "1.5 KB" (binary units, matching the host's byte counts). */
    function formatBytes(value) {
      const bytes = countOf(value);
      if (bytes <= 0) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    /** Sidebar glyph: receives `{ size: 16 | 18, active: boolean }` from ui-sidebar. */
    function PortabilityGlyph({ size, active }) {
      const edge = typeof size === 'number' && size > 0 ? size : 18;
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { opacity: active === true ? 1 : 0.92 },
        },
        h('path', { d: 'M4 8h12' }),
        h('path', { d: 'm13 5 3 3-3 3' }),
        h('path', { d: 'M20 16H8' }),
        h('path', { d: 'm11 13-3 3 3 3' })
      );
    }

    /** Themed button with hover/focus feedback inline (no stylesheet, no color literals). */
    function Button({ variant, onClick, disabled, children }) {
      const [hover, setHover] = React.useState(false);
      const [focus, setFocus] = React.useState(false);
      const isDisabled = disabled === true;
      return h(
        'button',
        {
          type: 'button',
          style: buttonStyle(variant, hover, focus, isDisabled),
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onFocus: () => setFocus(true),
          onBlur: () => setFocus(false),
        },
        children
      );
    }

    /**
     * Build the page once per activation: `t`, the HTTP helper and every
     * component share the closed-over `ctx`.
     */
    function createPanelComponent(ctx, t) {
      /** Same-origin JSON helper: host routes live under /api on this origin. */
      async function requestJson(url, options) {
        const init = Object.assign({ method: 'GET', credentials: 'same-origin' }, options || {});
        init.headers = Object.assign({ accept: 'application/json' }, options && options.headers ? options.headers : {});
        let response;
        try {
          response = await fetch(url, init);
        } catch (networkError) {
          throw new Error(t('error.network') + ': ' + messageOf(networkError));
        }
        let payload = null;
        try {
          payload = await response.json();
        } catch (parseError) {
          payload = null;
        }
        if (!response.ok) {
          const detail = isRecord(payload) && textOf(payload.error) !== '' ? payload.error : 'HTTP ' + response.status;
          throw new Error(detail);
        }
        if (!isRecord(payload)) throw new Error(t('error.badResponse'));
        if (payload.ok === false) {
          throw new Error(textOf(payload.error) !== '' ? payload.error : t('error.badResponse'));
        }
        return payload;
      }

      function ErrorBanner({ text }) {
        return h(
          'div',
          { style: S.error, role: 'alert' },
          h('div', { style: S.errorTitle }, t('error.title')),
          h('div', { style: S.errorText }, text)
        );
      }

      function ResultCard({ result, onOpen, onDismiss }) {
        const rows = [];
        const push = (label, value) => {
          if (value === '') return;
          rows.push(h('div', { key: label, style: S.resultRow }, h('span', { style: S.resultKey }, label), h('span', { style: S.mono }, value)));
        };
        const imported = result.action === 'import';
        const sessions = Array.isArray(result.sessions) ? result.sessions.filter(isRecord) : [];
        const sessionCount = Array.isArray(result.sessions) ? result.sessions.length : countOf(result.sessions);
        const warnings = Array.isArray(result.warnings) ? result.warnings.filter((line) => textOf(line) !== '') : [];
        const errors = Array.isArray(result.errors) ? result.errors.filter((line) => textOf(line) !== '') : [];
        push(t('result.archive'), textOf(result.archivePath));
        push(t('result.target'), textOf(result.targetDir));
        push(t('result.workspace'), textOf(result.workspaceId));
        push(t('result.files'), countOf(result.files) > 0 ? String(countOf(result.files)) : '');
        push(t('result.bytes'), countOf(result.bytes) > 0 ? formatBytes(result.bytes) : '');
        push(t('result.sessions'), sessionCount > 0 ? String(sessionCount) : '');
        push(t('result.attachments'), countOf(result.attachments) > 0 ? String(countOf(result.attachments)) : '');
        const firstSession = sessions.length > 0 ? textOf(sessions[0].sessionId) : '';
        return h(
          'div',
          { style: S.result, role: 'status', 'aria-live': 'polite' },
          h('div', { style: S.resultHead }, h('span', { style: S.resultTitle }, imported ? t('result.imported') : t('result.exported'))),
          rows.length === 0 ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, rows),
          errors.length === 0
            ? null
            : h(
                'div',
                { style: S.error, role: 'alert' },
                h('div', { style: S.errorTitle }, t('result.title')),
                h('div', { style: S.errorText }, errors.join('\n'))
              ),
          warnings.length === 0 ? null : h('div', { style: S.mono }, t('result.warnings') + ': ' + warnings.join('; ')),
          h(
            'div',
            { style: S.resultActions },
            firstSession === '' ? null : h(Button, { variant: 'primary', onClick: () => onOpen(firstSession) }, t('result.open')),
            h(Button, { variant: 'ghost', onClick: onDismiss }, t('result.dismiss'))
          )
        );
      }

      function ProjectCard({ project, pending, onExport }) {
        const name = textOf(project.title) !== '' ? project.title : textOf(project.id);
        const path = textOf(project.path);
        const sessionCount = countOf(project.sessionCount);
        const running = pending === 'export:' + textOf(project.id);
        return h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.cardHead },
            h(
              'div',
              { style: S.cardBody },
              h('div', { style: S.cardTitle, title: name }, name),
              path === '' ? h('div', { style: S.mono }, t('project.noPaths')) : h('div', { style: S.mono }, t('project.paths', { path }))
            ),
            h(
              Button,
              { variant: 'outline', disabled: pending !== '', onClick: () => onExport(project) },
              running ? t('project.exporting') : t('project.export')
            )
          ),
          sessionCount > 0 ? h('div', { style: S.badgeRow }, h('span', { style: S.badge }, t('project.sessions', { count: sessionCount }))) : null
        );
      }

      return function ProjectPortabilityPage() {
        const [status, setStatus] = React.useState('loading');
        const [catalog, setCatalog] = React.useState(null);
        const [loadError, setLoadError] = React.useState('');
        const [pending, setPending] = React.useState('');
        const [actionError, setActionError] = React.useState('');
        const [result, setResult] = React.useState(null);
        const [archivePath, setArchivePath] = React.useState('');
        const alive = React.useRef(true);

        function readProjects(showSpinner) {
          if (showSpinner) setStatus('loading');
          requestJson(PROJECTS_URL).then(
            (payload) => {
              if (!alive.current) return;
              setCatalog(payload);
              setLoadError('');
              setStatus('ready');
            },
            (error) => {
              if (!alive.current) return;
              setLoadError(messageOf(error));
              setStatus('error');
            }
          );
        }

        React.useEffect(() => {
          alive.current = true;
          readProjects(true);
          return () => {
            alive.current = false;
          };
        }, []);

        function runExport(project) {
          if (pending !== '') return;
          setPending('export:' + textOf(project.id));
          setActionError('');
          setResult(null);
          requestJson(EXPORT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ project: project.id }),
          }).then(
            (payload) => {
              if (!alive.current) return;
              setPending('');
              setResult(Object.assign({ action: 'export' }, payload));
              readProjects(false);
            },
            (error) => {
              if (!alive.current) return;
              setPending('');
              setActionError(messageOf(error));
            }
          );
        }

        function runImport() {
          if (pending !== '') return;
          const typed = archivePath.trim();
          const newest = catalog !== null && Array.isArray(catalog.archives) && catalog.archives.length > 0 ? textOf(catalog.archives[0].path) : '';
          const archive = typed !== '' ? typed : newest;
          if (archive === '') {
            setActionError(t('error.noArchive'));
            return;
          }
          if (typed === '') setArchivePath(newest);
          setPending('import');
          setActionError('');
          setResult(null);
          requestJson(IMPORT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ archive }),
          }).then(
            (payload) => {
              if (!alive.current) return;
              setPending('');
              setResult(Object.assign({ action: 'import' }, payload));
              readProjects(false);
            },
            (error) => {
              if (!alive.current) return;
              setPending('');
              setActionError(messageOf(error));
            }
          );
        }

        function openSession(sessionId) {
          setActionError('');
          // `uiWorkspace.openSession` returns void and may throw synchronously,
          // so the async wrapper turns that into a rejection we can report.
          const open = async () => {
            const workspace = ctx.get('uiWorkspace');
            if (workspace === undefined || workspace === null || typeof workspace.openSession !== 'function') {
              throw new Error(t('error.noWorkspace'));
            }
            workspace.openSession(sessionId);
          };
          open().catch((error) => {
            if (!alive.current) return;
            setActionError(messageOf(error));
          });
        }

        const projects = catalog !== null && Array.isArray(catalog.projects) ? catalog.projects.filter(isRecord) : [];
        const archives = catalog !== null && Array.isArray(catalog.archives) ? catalog.archives.filter(isRecord) : [];
        const busy = pending !== '';
        const refreshDisabled = busy || status === 'loading';

        return h(
          'div',
          { style: S.page },
          h(
            'div',
            { style: S.scroll },
            h(
              'div',
              { style: S.content },
              h(
                'div',
                { style: S.header },
                h(
                  'div',
                  { style: S.headText },
                  h('h1', { style: S.h1 }, t('page.title')),
                  h('p', { style: S.subtitle }, t('page.subtitle'))
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h(Button, { variant: 'outline', disabled: refreshDisabled, onClick: () => readProjects(true) }, status === 'loading' ? t('page.refreshBusy') : t('page.refresh'))
                )
              ),
              h(
                'div',
                { style: S.importCard },
                h('div', { style: S.importTitle }, t('import.title')),
                h('div', { style: S.importHint }, t('import.hint')),
                h(
                  'div',
                  { style: S.importRow },
                  h('input', {
                    type: 'text',
                    style: S.input,
                    value: archivePath,
                    placeholder: t('import.placeholder'),
                    disabled: busy,
                    onChange: (event) => setArchivePath(event.target.value),
                  }),
                  h(Button, { variant: 'primary', disabled: busy, onClick: () => { void runImport(); } }, pending === 'import' ? t('import.running') : t('import.action'))
                ),
                archives.length === 0
                  ? null
                  : h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                      h('div', { style: S.importHint }, t('import.archives')),
                      h(
                        'div',
                        { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                        archives.slice(0, 8).map((archive) =>
                          h(
                            Button,
                            {
                              key: textOf(archive.path),
                              variant: 'ghost',
                              disabled: busy,
                              onClick: () => setArchivePath(textOf(archive.path)),
                            },
                            textOf(archive.name)
                          )
                        )
                      )
                    )
              ),
              busy && pending !== 'import' ? h('div', { style: S.progress, role: 'status', 'aria-live': 'polite' }, t('action.running')) : null,
              textOf(actionError) === '' ? null : h(ErrorBanner, { text: actionError }),
              result === null ? null : h(ResultCard, { result, onOpen: openSession, onDismiss: () => setResult(null) }),
              status === 'error'
                ? h(
                    'div',
                    { style: S.error, role: 'alert' },
                    h('div', { style: S.errorTitle }, t('state.loadError')),
                    h('div', { style: S.errorText }, loadError),
                    h(Button, { variant: 'ghost', onClick: () => readProjects(true) }, t('state.retry'))
                  )
                : null,
              status === 'loading' && catalog === null ? h('div', { style: S.stateRow }, t('state.loading')) : null,
              catalog !== null && projects.length === 0
                ? h(
                    'div',
                    { style: S.emptyCard },
                    h('div', { style: S.emptyTitle }, t('state.empty')),
                    h('div', { style: S.emptyHint }, t('state.emptyHint'))
                  )
                : null,
              projects.map((project, index) =>
                h(ProjectCard, {
                  key: textOf(project.id) !== '' ? project.id : 'project-' + index,
                  project,
                  pending,
                  onExport: runExport,
                })
              )
            )
          )
        );
      };
    }

    return {
      name: PANEL_ID,
      /** Services this client half needs; Cordis waits until they exist. */
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        const locale = ctx.get('locale');
        ctx.effect(() => {
          if (locale === undefined || locale === null || typeof locale.register !== 'function') return undefined;
          const releaseRu = locale.register(NS, 'ru', ru);
          const releaseEn = locale.register(NS, 'en', en);
          return () => {
            if (typeof releaseRu === 'function') releaseRu();
            if (typeof releaseEn === 'function') releaseEn();
          };
        }, 'project-portability: dictionaries');

        const t = makeTranslate(locale);
        const Page = createPanelComponent(ctx, t);

        // Page: root-scoped keyed `main` slot; the key is what `ctx.layout.selectPanel(id)` selects.
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            Page
          )
        );

        // Sidebar row: list entry whose id equals the `main` key; selecting it opens the page.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              locale: NS,
              label: () => t('panel'),
            },
            PortabilityGlyph
          )
        );
      },
    };
  },
});
