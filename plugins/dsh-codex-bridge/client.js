window.__ModuleLoader__.load({
  id: 'dsh-codex-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this browser half (display metadata lives in locale/*.json). */
    const NS = 'codex-import';
    /** Host routes registered by index.js; they share this page's origin. */
    const CATALOG_URL = '/api/codex-import/catalog';
    const IMPORT_URL = '/api/codex-import/import';
    const VERSION_URL = '/api/codex-import/version';
    /** Main-page key; the sidebar row uses the same value as its id. */
    const PANEL_ID = 'codex-import';

    const CODE_FONT = 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';
    const FOCUS_RING = 'var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))';
    const TRANSITION = 'var(--ds-transition-duration-fast, 120ms)';

    const ru = {
      'panel': 'Codex',
      'page.title': 'Импорт из Codex',
      'page.subtitle':
        'Перенесите проект и переписку из OpenAI Codex в эту рабочую область: плагин скопирует файлы проекта и создаст чат с историей.',
      'page.refresh': 'Обновить',
      'page.refreshBusy': 'Обновление…',
      'source.codex': 'Codex:',
      'source.target': 'Рабочая область:',
      'state.loading': 'Читаю каталог Codex…',
      'state.retry': 'Повторить',
      'state.loadError': 'Не удалось прочитать каталог Codex',
      'state.empty': 'В Codex пока нет проектов',
      'state.emptyHint': 'Запустите Codex хотя бы один раз: плагин читает проекты из папки ~/.codex.',
      'project.unknown': 'Проект без имени',
      'project.noPaths': 'Пути проекта не записаны',
      'project.threads': 'Тредов: {count}',
      'project.missing': 'Папка проекта не найдена',
      'project.import': 'Импортировать проект',
      'project.importAll': 'Все чаты',
      'page.importAll': 'Импортировать всё',
      'import.allHint': 'Импортирую все проекты и все их чаты. Это может занять время.',
      'import.allProgress': 'Проект {current} из {total}: {name}',
      'import.allChatsHint': 'Импортирую все чаты проекта, для каждого создаётся отдельный чат…',
      'import.chatProgress': 'Чат {current} из {total}: {name}',      'project.update': 'Обновить проект',
      'project.imported': 'Уже импортирован',
      'project.showThreads': 'Треды ({count})',
      'project.hideThreads': 'Скрыть треды ({count})',
      'thread.noTitle': 'Тред без названия',
      'thread.messages': 'Сообщений: {count}',
      'thread.updated': 'Обновлён: {date}',
      'thread.import': 'Импорт',
      'thread.update': 'Обновить',
      'import.running': 'Импорт…',
      'import.progressTitle': 'Импорт из Codex',
      'import.progressHint': 'Копирую файлы проекта и создаю чат…',
      'error.title': 'Не получилось',
      'error.network': 'Нет связи с DSH',
      'error.badResponse': 'Сервер вернул неожиданный ответ',
      'error.noWorkspace': 'Сервис рабочей области недоступен, чат не открыть',
      'result.title': 'Импорт завершён',
      'result.updated': 'Импорт обновлён',
      'result.appendedLabel': 'Добавлено сообщений',
      'result.projectLabel': 'Проект',
      'result.folderLabel': 'Папка',
      'result.sessionLabel': 'Сессия',
      'result.messagesLabel': 'Сообщений',
      'result.filesLabel': 'Файлов',
      'result.bulkTitle': 'Массовый импорт завершён',
      'result.projectsLabel': 'Проектов',
      'result.threadsLabel': 'Чатов',
      'result.createdLabel': 'Новых чатов',
      'result.errorsLabel': 'Ошибок',      'result.open': 'Открыть чат',
      'result.openHint': 'Чат не открылся. Обновите список сессий в боковой панели и попробуйте снова.',
      'result.dismiss': 'Закрыть',
    };

    const en = {
      'panel': 'Codex',
      'page.title': 'Import from Codex',
      'page.subtitle':
        'Move a project and its conversation from OpenAI Codex into this workspace: the plugin copies the project files and creates a chat with the history.',
      'page.refresh': 'Refresh',
      'page.refreshBusy': 'Refreshing…',
      'source.codex': 'Codex:',
      'source.target': 'Workspace:',
      'state.loading': 'Reading the Codex catalog…',
      'state.retry': 'Try again',
      'state.loadError': 'Could not read the Codex catalog',
      'state.empty': 'No Codex projects yet',
      'state.emptyHint': 'Run Codex at least once: the plugin reads projects from the ~/.codex folder.',
      'project.unknown': 'Unnamed project',
      'project.noPaths': 'No project paths recorded',
      'project.threads': 'Threads: {count}',
      'project.missing': 'Project folder not found',
      'project.import': 'Import project',
      'project.importAll': 'All chats',
      'page.importAll': 'Import everything',
      'import.allHint': 'Importing every project and all of its chats. This can take a while.',
      'import.allProgress': 'Project {current} of {total}: {name}',
      'import.allChatsHint': 'Importing every chat of the project and creating a separate chat for each…',
      'import.chatProgress': 'Chat {current} of {total}: {name}',      'project.update': 'Update project',
      'project.imported': 'Already imported',
      'project.showThreads': 'Threads ({count})',
      'project.hideThreads': 'Hide threads ({count})',
      'thread.noTitle': 'Untitled thread',
      'thread.messages': 'Messages: {count}',
      'thread.updated': 'Updated: {date}',
      'thread.import': 'Import',
      'thread.update': 'Update',
      'import.running': 'Importing…',
      'import.progressTitle': 'Import from Codex',
      'import.progressHint': 'Copying the project files and creating the chat…',
      'error.title': 'Something went wrong',
      'error.network': 'No connection to DSH',
      'error.badResponse': 'The server returned an unexpected response',
      'error.noWorkspace': 'The workspace service is unavailable, so the chat cannot be opened',
      'result.title': 'Import complete',
      'result.updated': 'Import updated',
      'result.appendedLabel': 'Messages added',
      'result.projectLabel': 'Project',
      'result.folderLabel': 'Folder',
      'result.sessionLabel': 'Session',
      'result.messagesLabel': 'Messages',
      'result.filesLabel': 'Files',
      'result.bulkTitle': 'Bulk import complete',
      'result.projectsLabel': 'Projects',
      'result.threadsLabel': 'Chats',
      'result.createdLabel': 'New chats',
      'result.errorsLabel': 'Errors',      'result.open': 'Open chat',
      'result.openHint': 'The chat did not open. Refresh the session list in the sidebar and try again.',
      'result.dismiss': 'Dismiss',
    };

    /** Theme tokens used by the inline styles; only --dsw-alias-* colors and layout tokens. */
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
      warn: 'var(--dsw-alias-state-warn-primary)',
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
      sources: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 0',
        borderTop: '0.5px solid ' + T.border,
        borderBottom: '0.5px solid ' + T.border,
        fontSize: 12,
        lineHeight: '18px',
      },
      sourceRow: { display: 'flex', gap: 6, minWidth: 0, flexWrap: 'wrap' },
      sourceKey: { color: T.textSecondary, flex: '0 0 auto' },
      mono: { fontFamily: CODE_FONT, color: T.textMuted, overflowWrap: 'anywhere' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '14px 16px',
        border: '0.5px solid ' + T.border,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      cardBody: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 260px' },
      cardTitle: { fontSize: 14, lineHeight: '22px', fontWeight: 500, color: T.text, overflowWrap: 'anywhere' },
      pathLine: { display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, lineHeight: '18px' },
      badgeRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
      badge: {
        fontSize: 11,
        lineHeight: '16px',
        padding: '1px 7px',
        borderRadius: 999,
        background: T.surfaceAlt,
        color: T.textSecondary,
      },
      badgeWarn: {
        fontSize: 11,
        lineHeight: '16px',
        padding: '1px 7px',
        borderRadius: 999,
        background: T.surfaceAlt,
        color: T.warn,
      },
      actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      threadList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '0.5px solid ' + T.border },
      threadRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 10px',
        borderRadius: 'var(--dsw-radius-md)',
        background: T.surfaceAlt,
      },
      threadBody: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' },
      threadTitle: { fontSize: 13, lineHeight: '20px', color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      threadMeta: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, lineHeight: '16px', color: T.textMuted, flexWrap: 'wrap' },
      progress: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        border: '0.5px solid ' + T.border,
        borderLeft: '3px solid ' + T.primaryFill,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      progressHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      progressTitle: { fontSize: 13, fontWeight: 500, color: T.text },
      progressValue: { fontSize: 12, color: T.textMuted, fontVariantNumeric: 'tabular-nums' },
      progressTrack: { height: 6, borderRadius: 999, background: T.surfaceAlt, overflow: 'hidden' },
      progressFill: { height: '100%', borderRadius: 999, background: T.primaryFill, transition: 'width ' + TRANSITION + ' linear' },
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
      stateRow: { padding: '8px 0', color: T.textMuted, fontSize: 13 },
      emptyCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '20px 18px',
        border: '0.5px dashed ' + T.borderStrong,
        borderRadius: 'var(--dsw-radius-lg)',
        color: T.textMuted,
      },
      emptyTitle: { fontSize: 14, color: T.text },
      emptyHint: { fontSize: 12, lineHeight: '18px', color: T.textMuted },
      hint: { fontSize: 12, lineHeight: '18px', color: T.textMuted },
      inlineError: { fontSize: 12, lineHeight: '18px', color: T.error, overflowWrap: 'anywhere' },
      result: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        border: '0.5px solid ' + T.border,
        borderLeft: '3px solid ' + T.success,
        borderRadius: 'var(--dsw-radius-lg)',
        background: T.surface,
      },
      resultHead: { display: 'flex', alignItems: 'center', gap: 8 },
      resultIcon: { display: 'inline-flex', color: T.success, flex: '0 0 auto' },
      resultTitle: { fontSize: 14, fontWeight: 500, color: T.text },
      resultGrid: { display: 'flex', flexDirection: 'column', gap: 4 },
      resultRow: { display: 'flex', gap: 8, minWidth: 0, flexWrap: 'wrap', fontSize: 12, lineHeight: '18px' },
      resultKey: { color: T.textMuted, flex: '0 0 auto', minWidth: 72 },
      resultValue: { color: T.text, overflowWrap: 'anywhere' },
      monoValue: { fontFamily: CODE_FONT, color: T.textSecondary, overflowWrap: 'anywhere' },
    };

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function textOf(value) {
      return typeof value === 'string' ? value : '';
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function countOf(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      try {
        return date.toLocaleString();
      } catch (error) {
        return value;
      }
    }

    /** Import glyph: an arrow dropping into an open tray, drawn at the sidebar's requested edge. */
    function CodexGlyph({ size, style }) {
      const edge = typeof size === 'number' && size > 0 ? size : 18;
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: style,
        },
        h('path', { d: 'M12 3.5v9.5' }),
        h('path', { d: 'M8.2 9.7 12 13.5l3.8-3.8' }),
        h('path', { d: 'M4.7 14.4v3.35a2.75 2.75 0 0 0 2.75 2.75h9.1a2.75 2.75 0 0 0 2.75-2.75V14.4' })
      );
    }

    function CheckGlyph() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M4.5 12.6 9.4 17.5 19.5 6.5' })
      );
    }

    function ChevronGlyph({ expanded }) {
      return h(
        'svg',
        {
          width: 12,
          height: 12,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: {
            transform: expanded === true ? 'rotate(180deg)' : 'none',
            transition: 'transform ' + TRANSITION + ' ease',
          },
        },
        h('path', { d: 'M6 9.5 12 15.5l6-6' })
      );
    }

    /** Themed button with hover/focus feedback expressed inline (no stylesheet, no literals). */
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

    /** Build the panel once per activation: `t`, the HTTP helpers and the components share one closure. */
    function createPanelComponent(ctx, t) {
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

      function ProgressBanner({ title, hint }) {
        const [value, setValue] = React.useState(6);
        React.useEffect(() => {
          setValue(6);
          const timer = setInterval(() => {
            setValue((current) => (current >= 90 ? 90 : current + Math.max(2, Math.round((90 - current) / 8))));
          }, 260);
          return () => {
            clearInterval(timer);
          };
        }, []);
        return h(
          'div',
          { style: S.progress, role: 'status', 'aria-live': 'polite' },
          h('div', { style: S.progressHead }, h('span', { style: S.progressTitle }, title), h('span', { style: S.progressValue }, value + '%')),
          h('div', { style: S.progressTrack }, h('div', { style: Object.assign({}, S.progressFill, { width: value + '%' }) })),
          textOf(hint) === '' ? null : h('div', { style: S.hint }, hint)
        );
      }

      function ErrorBanner({ title, text, onRetry, retryLabel }) {
        return h(
          'div',
          { style: S.error, role: 'alert' },
          h('div', { style: S.errorTitle }, title),
          textOf(text) === '' ? null : h('div', { style: S.errorText }, text),
          typeof onRetry === 'function' ? h(Button, { variant: 'ghost', onClick: onRetry }, retryLabel) : null
        );
      }

      function ThreadRow({ project, thread, pendingKey, onImport }) {
        const running = pendingKey === 'thread:' + textOf(thread.id);
        const imported = textOf(thread.importedSessionId) !== '';
        const title = textOf(thread.title) !== '' ? thread.title : t('thread.noTitle');
        const updated = formatDate(thread.updatedAt);
        return h(
          'div',
          { style: S.threadRow },
          h(
            'div',
            { style: S.threadBody },
            h('div', { style: S.threadTitle, title: title }, title),
            h(
              'div',
              { style: S.threadMeta },
              updated === '' ? null : h('span', null, t('thread.updated', { date: updated })),
              updated === '' ? null : h('span', { 'aria-hidden': 'true' }, '·'),
              h('span', null, t('thread.messages', { count: countOf(thread.messageCount) }))
            )
          ),
          h(
            Button,
            { variant: 'outline', disabled: pendingKey !== '', onClick: () => onImport(project, thread) },
            running ? t('import.running') : imported ? t('thread.update') : t('thread.import')
          )
        );
      }

      function ProjectCard({ project, pendingKey, onImportProject, onImportThread }) {
        const [expanded, setExpanded] = React.useState(false);
        const threads = Array.isArray(project.threads) ? project.threads.filter(isRecord) : [];
        const paths = Array.isArray(project.rootPaths)
          ? project.rootPaths.filter((entry) => typeof entry === 'string' && entry !== '')
          : [];
        const name = textOf(project.name) !== '' ? project.name : t('project.unknown');
        const running = pendingKey === 'project:' + textOf(project.id);
        const runningAll = pendingKey === 'project:' + textOf(project.id) + ':all';
        const imported = project.imported === true;
        return h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.cardHead },
            h(
              'div',
              { style: S.cardBody },
              h('div', { style: S.cardTitle }, name),
              h(
                'div',
                { style: S.pathLine },
                paths.length === 0
                  ? h('div', { style: { color: T.textMuted } }, t('project.noPaths'))
                  : paths.map((path, index) => h('div', { key: 'path-' + index, style: S.mono }, path))
              ),
              h(
                'div',
                { style: S.badgeRow },
                h('span', { style: S.badge }, t('project.threads', { count: threads.length })),
                imported ? h('span', { style: S.badge }, t('project.imported')) : null,
                project.exists === false ? h('span', { style: S.badgeWarn }, t('project.missing')) : null
              )
            ),
            h(
              'div',
              { style: S.actions },
              h(
                Button,
                { variant: 'primary', disabled: pendingKey !== '', onClick: () => onImportProject(project) },
                running ? t('import.running') : imported ? t('project.update') : t('project.import')
              ),
              threads.length === 0
                ? null
                : h(
                    Button,
                    {
                      variant: 'outline',
                      disabled: pendingKey !== '',
                      onClick: () => onImportProject(project, { allThreads: true }),
                    },
                    runningAll ? t('import.running') : t('project.importAll')
                  ),
              threads.length === 0
                ? null
                : h(
                    Button,
                    {
                      variant: 'ghost',
                      onClick: () => setExpanded((value) => !value),
                    },
                    h(ChevronGlyph, { expanded: expanded }),
                    expanded
                      ? t('project.hideThreads', { count: threads.length })
                      : t('project.showThreads', { count: threads.length })
                  )
            )
          ),
          expanded && threads.length > 0
            ? h(
                'div',
                { style: S.threadList },
                threads.map((thread, index) =>
                  h(ThreadRow, {
                    key: textOf(thread.id) !== '' ? thread.id : 'thread-' + index,
                    project: project,
                    thread: thread,
                    pendingKey: pendingKey,
                    onImport: onImportThread,
                  })
                )
              )
            : null
        );
      }

      function ResultCard({ result, openError, onOpen, onDismiss }) {
        if (result.bulk === true) {
          const totals = isRecord(result.totals) ? result.totals : {};
          const firstSessionId = textOf(result.firstSessionId);
          function totalRow(label, value) {
            return h(
              'div',
              { style: S.resultRow },
              h('span', { style: S.resultKey }, label),
              h('span', { style: S.resultValue }, String(countOf(value)))
            );
          }
          return h(
            'div',
            { style: S.result, 'aria-live': 'polite' },
            h(
              'div',
              { style: S.resultHead },
              h('span', { style: S.resultIcon }, h(CheckGlyph)),
              h('span', { style: S.resultTitle }, t('result.bulkTitle'))
            ),
            h(
              'div',
              { style: S.resultGrid },
              totalRow(t('result.projectsLabel'), totals.projects ?? totals.projectsOk),
              totalRow(t('result.threadsLabel'), totals.threads),
              totalRow(t('result.createdLabel'), totals.created),
              totalRow(t('result.appendedLabel'), totals.appended),
              totalRow(t('result.errorsLabel'), totals.errors)
            ),
            textOf(result.error) === '' ? null : h('div', { style: S.inlineError }, textOf(result.error)),
            textOf(openError) === '' ? null : h('div', { style: S.inlineError }, openError),
            textOf(openError) === '' ? null : h('div', { style: S.hint }, t('result.openHint')),
            h(
              'div',
              { style: S.actions },
              firstSessionId === '' ? null : h(Button, { variant: 'primary', onClick: () => onOpen(firstSessionId) }, t('result.open')),
              h(Button, { variant: 'ghost', onClick: onDismiss }, t('result.dismiss'))
            )
          );
        }
        const sessionId = textOf(result.sessionId);
        const sessionTitle = textOf(result.sessionTitle);
        function resultRow(label, value, mono) {
          if (textOf(value) === '') return null;
          return h(
            'div',
            { style: S.resultRow },
            h('span', { style: S.resultKey }, label),
            h('span', { style: mono ? S.monoValue : S.resultValue }, value)
          );
        }
        return h(
          'div',
          { style: S.result, 'aria-live': 'polite' },
          h('div', { style: S.resultHead }, h('span', { style: S.resultIcon }, h(CheckGlyph)), h('span', { style: S.resultTitle }, result.updated === true ? t('result.updated') : t('result.title'))),
          h(
            'div',
            { style: S.resultGrid },
            resultRow(t('result.projectLabel'), textOf(result.projectName), false),
            resultRow(t('result.folderLabel'), textOf(result.targetDir), true),
            resultRow(t('result.sessionLabel'), sessionTitle === '' ? sessionId : sessionTitle + ' · ' + sessionId, true),
            resultRow(t('result.messagesLabel'), String(countOf(result.messages)), false),
            result.updated === true ? resultRow(t('result.appendedLabel'), String(countOf(result.appended)), false) : null,
            resultRow(t('result.filesLabel'), String(countOf(result.copiedFiles)), false)
          ),
          textOf(openError) === '' ? null : h('div', { style: S.inlineError }, openError),
          textOf(openError) === '' ? null : h('div', { style: S.hint }, t('result.openHint')),
          h(
            'div',
            { style: S.actions },
            sessionId === '' ? null : h(Button, { variant: 'primary', onClick: () => onOpen(sessionId) }, t('result.open')),
            h(Button, { variant: 'ghost', onClick: onDismiss }, t('result.dismiss'))
          )
        );
      }

      /**
       * Ask the Host for a fresh Session baseline. The importer writes the chat
       * Session straight through Host session persistence, so it never passes the
       * Client mutation path that normally teaches `sessions.retain` about a new
       * id; refreshing the list first makes the freshly imported Session openable.
       */
      async function refreshSessionList() {
        const sessions = ctx.get('sessions');
        if (sessions === undefined || sessions === null || typeof sessions.refresh !== 'function') return;
        try {
          await sessions.refresh();
        } catch (error) {
          console.warn('codex-import: session list refresh failed', error);
        }
      }

      return function CodexImportPage() {
        const [status, setStatus] = React.useState('loading');
        const [catalog, setCatalog] = React.useState(null);
        const [loadError, setLoadError] = React.useState('');
        const [pendingKey, setPendingKey] = React.useState('');
        const [importError, setImportError] = React.useState('');
        const [result, setResult] = React.useState(null);
        const [openError, setOpenError] = React.useState('');
        const [bulk, setBulk] = React.useState(null);
        const [bulkApi, setBulkApi] = React.useState(false);
        const alive = React.useRef(true);

        function readCatalog(showSpinner) {
          if (showSpinner) setStatus('loading');
          requestJson(CATALOG_URL).then(
            (payload) => {
              if (!alive.current) return;
              setCatalog(payload);
              setLoadError('');
              setStatus('ready');
              requestJson(VERSION_URL).then(
                (capability) => {
                  if (!alive.current) return;
                  setBulkApi(capability.features !== undefined && capability.features !== null && capability.features.allThreads === true);
                },
                () => {
                  if (!alive.current) return;
                  setBulkApi(false);
                }
              );
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
          readCatalog(true);
          return () => {
            alive.current = false;
          };
        }, []);

        /** Fold one import response into the counters the summary card shows. */
        function summarizeImport(payload) {
          const bulk = payload.bulk === true;
          const totals = isRecord(payload.totals) ? payload.totals : {};
          return {
            threads: bulk ? countOf(totals.threads) : 1,
            created: bulk ? countOf(totals.created) : payload.sessionCreated === true ? 1 : 0,
            updated: bulk ? countOf(totals.updated) : payload.updated === true ? 1 : 0,
            appended: bulk ? countOf(totals.appended) : countOf(payload.appended),
            messages: bulk ? countOf(totals.messages) : countOf(payload.messages),
            errors: countOf(totals.errors),
            sessionId: textOf(bulk ? payload.firstSessionId : payload.sessionId),
          };
        }

        /**
         * Import every chat of one project. When the Host half supports bulk
         * mode one request does the whole project; otherwise (an older Host is
         * still running) the panel imports thread by thread, which every
         * version understands.
         */
        async function importAllChatsOfProject(project) {
          const threads = Array.isArray(project.threads) ? project.threads.filter(isRecord) : [];
          if (threads.length === 0 || bulkApi) {
            const payload = await requestJson(IMPORT_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ projectId: project.id, allThreads: true }),
            });
            const summary = summarizeImport(payload);
            const failed = payload.ok === false;
            return {
              ok: !failed,
              firstSessionId: summary.sessionId,
              totals: {
                threads: summary.threads,
                created: summary.created,
                updated: summary.updated,
                appended: summary.appended,
                messages: summary.messages,
                errors: summary.errors + (failed ? 1 : 0),
              },
              error: failed ? textOf(payload.error) : '',
            };
          }
          const totals = { threads: 0, created: 0, updated: 0, appended: 0, messages: 0, errors: 0 };
          const failures = [];
          let firstSessionId = '';
          for (let index = 0; index < threads.length; index += 1) {
            const thread = threads[index];
            if (!alive.current) return { ok: false, firstSessionId, totals, error: '' };
            const threadName = textOf(thread.title) !== '' ? textOf(thread.title) : textOf(thread.id);
            setBulk({ kind: 'chat', done: index, total: threads.length, name: threadName });
            try {
              const payload = await requestJson(IMPORT_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, threadId: thread.id }),
              });
              totals.threads += 1;
              totals.created += payload.sessionCreated === true ? 1 : 0;
              totals.updated += payload.updated === true ? 1 : 0;
              totals.appended += countOf(payload.appended);
              totals.messages += countOf(payload.messages);
              if (firstSessionId === '' && textOf(payload.sessionId) !== '') firstSessionId = payload.sessionId;
            } catch (error) {
              totals.errors += 1;
              failures.push(threadName + ': ' + messageOf(error));
            }
          }
          return { ok: failures.length === 0, firstSessionId, totals, error: failures.join('; ') };
        }

        /** "All chats" for one project. */
        function runImportAllChats(project) {
          if (pendingKey !== '') return;
          setPendingKey('project:' + textOf(project.id) + ':all');
          setImportError('');
          setOpenError('');
          setResult(null);
          importAllChatsOfProject(project).then(
            (summary) => {
              if (!alive.current) return;
              setBulk(null);
              setPendingKey('');
              setResult({
                ok: summary.ok,
                bulk: true,
                projectName: textOf(project.name),
                firstSessionId: summary.firstSessionId,
                totals: summary.totals,
                ...(textOf(summary.error) !== '' ? { error: summary.error } : {}),
              });
              readCatalog(false);
              void refreshSessionList();
            },
            (error) => {
              if (!alive.current) return;
              setBulk(null);
              setPendingKey('');
              setImportError(messageOf(error));
            }
          );
        }

        /** "Import everything": every project, every chat, with visible progress. */
        async function runImportEverything() {
          if (pendingKey !== '') return;
          const list = projects.filter((project) => project.exists !== false);
          if (list.length === 0) return;
          setPendingKey('all');
          setImportError('');
          setOpenError('');
          setResult(null);
          const totals = { projects: 0, projectsOk: 0, threads: 0, created: 0, updated: 0, appended: 0, messages: 0, errors: 0 };
          const failures = [];
          let firstSessionId = '';
          for (let index = 0; index < list.length; index += 1) {
            const project = list[index];
            if (!alive.current) return;
            setBulk({ kind: 'project', done: index, total: list.length, name: textOf(project.name) });
            try {
              const summary = await importAllChatsOfProject(project);
              totals.projects += 1;
              if (summary.ok) totals.projectsOk += 1;
              totals.threads += summary.totals.threads;
              totals.created += summary.totals.created;
              totals.updated += summary.totals.updated;
              totals.appended += summary.totals.appended;
              totals.messages += summary.totals.messages;
              totals.errors += summary.totals.errors;
              if (textOf(summary.error) !== '') failures.push(textOf(project.name) + ': ' + summary.error);
              if (firstSessionId === '' && textOf(summary.firstSessionId) !== '') firstSessionId = summary.firstSessionId;
            } catch (error) {
              totals.projects += 1;
              totals.errors += 1;
              failures.push(textOf(project.name) + ': ' + messageOf(error));
            }
          }
          if (!alive.current) return;
          setBulk(null);
          setPendingKey('');
          setResult({
            ok: totals.errors === 0,
            bulk: true,
            scope: 'all',
            firstSessionId,
            totals,
            ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
          });
          readCatalog(false);
          void refreshSessionList();
        }

        /** Import one thread (or, with no thread, the project's most recent chat). */
        function runImport(project, thread) {
          if (pendingKey !== '') return;
          const key = thread === null ? 'project:' + textOf(project.id) : 'thread:' + textOf(thread.id);
          setPendingKey(key);
          setImportError('');
          setOpenError('');
          setResult(null);
          const body = thread === null ? { projectId: project.id } : { projectId: project.id, threadId: thread.id };
          requestJson(IMPORT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }).then(
            (payload) => {
              if (!alive.current) return;
              setPendingKey('');
              setResult(payload);
              readCatalog(false);
              void refreshSessionList();
            },
            (error) => {
              if (!alive.current) return;
              setPendingKey('');
              setImportError(messageOf(error));
            }
          );
        }
        function openChat(sessionId) {
          setOpenError('');
          const open = async () => {
            await refreshSessionList();
            const uiWorkspace = ctx.get('uiWorkspace');
            if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') {
              throw new Error(t('error.noWorkspace'));
            }
            uiWorkspace.openSession(sessionId);
          };
          open().catch((error) => {
            if (!alive.current) return;
            setOpenError(messageOf(error));
          });
        }

        function catalogRow(label, value) {
          if (textOf(value) === '') return null;
          return h(
            'div',
            { style: S.sourceRow },
            h('span', { style: S.sourceKey }, label),
            h('span', { style: S.mono }, value)
          );
        }

        const projects = catalog !== null && Array.isArray(catalog.projects) ? catalog.projects.filter(isRecord) : [];
        const busy = pendingKey !== '';
        const refreshDisabled = busy || status === 'loading';
        const refreshLabel = status === 'loading' ? t('page.refreshBusy') : t('page.refresh');

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
                  { style: S.actions },
                  h(Button, { variant: 'outline', disabled: refreshDisabled, onClick: () => readCatalog(true) }, refreshLabel),
                  h(
                    Button,
                    {
                      variant: 'primary',
                      disabled: busy || projects.length === 0,
                      onClick: () => { void runImportEverything(); },
                    },
                    t('page.importAll')
                  )
                )
              ),
              catalog === null
                ? null
                : h(
                    'div',
                    { style: S.sources },
                    catalogRow(t('source.codex'), textOf(catalog.codexHome)),
                    catalogRow(t('source.target'), textOf(catalog.targetRoot))
                  ),
              busy
                ? h(ProgressBanner, {
                    title: t('import.progressTitle'),
                    hint:
                      bulk !== null
                        ? bulk.kind === 'chat'
                          ? t('import.chatProgress', { current: bulk.done + 1, total: bulk.total, name: bulk.name })
                          : t('import.allProgress', { current: bulk.done + 1, total: bulk.total, name: bulk.name })
                        : pendingKey === 'all'
                          ? t('import.allHint')
                          : pendingKey.endsWith(':all')
                            ? t('import.allChatsHint')
                            : t('import.progressHint'),
                  })
                : null,
              textOf(importError) === '' ? null : h(ErrorBanner, { title: t('error.title'), text: importError }),
              result === null
                ? null
                : h(ResultCard, {
                    result: result,
                    openError: openError,
                    onOpen: openChat,
                    onDismiss: () => {
                      setResult(null);
                      setOpenError('');
                    },
                  }),
              status === 'error'
                ? h(ErrorBanner, {
                    title: t('state.loadError'),
                    text: loadError,
                    onRetry: () => readCatalog(true),
                    retryLabel: t('state.retry'),
                  })
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
                  project: project,
                  pendingKey: pendingKey,
                  onImportProject: (selected, options) =>
                    options !== undefined && options.allThreads === true ? runImportAllChats(selected) : runImport(selected, null),
                  onImportThread: (selected, thread) => runImport(selected, thread),
                })
              )
            )
          )
        );
      };
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        const locale = ctx.get('locale');
        ctx.effect(() => {
          if (locale === undefined || locale === null || typeof locale.register !== 'function') return undefined;
          const releaseRu = locale.register(NS, 'ru', ru);
          const releaseEn = locale.register(NS, 'en', en);
          return () => {
            releaseRu();
            releaseEn();
          };
        }, 'codex-import: dictionaries');
        const t = locale !== undefined && locale !== null && typeof locale.bind === 'function' ? locale.bind(NS) : (key) => key;
        const Page = createPanelComponent(ctx, t);
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
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              locale: NS,
              label: () => t('panel'),
            },
            CodexGlyph
          )
        );
      },
    };
  },
});
