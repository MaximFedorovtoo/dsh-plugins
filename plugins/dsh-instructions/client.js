/**
 * Client half of the instructions bundle.
 *
 * One sidebar panel ("Instructions") with a page that:
 * - shows the machine-wide instruction file (`$DSH_HOME/AGENTS.md`) and its state;
 * - uploads a local `.md`/`.txt` file into the editor;
 * - saves the edited text through the Host (`POST /api/instructions`);
 * - deletes the file so DSH falls back to project-level instructions only.
 *
 * The page talks to the Host routes registered by `index.js`; it never touches
 * the filesystem itself.
 */
window.__ModuleLoader__.load({
  id: 'dsh-instructions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'instructions';
    const PANEL_ID = 'instructions';
    const ROUTE = '/api/instructions';
    const MAX_PREVIEW_CHARS = 400;

    const ru = {
      panel: 'Инструкции',
      'page.title': 'Инструкции по умолчанию',
      'page.subtitle':
        'Загрузите или отредактируйте AGENTS.md: DSH читает этот файл в каждой сессии и в каждом проекте, поэтому правила действуют по умолчанию.',
      'state.loading': 'Читаю файл инструкций…',
      'state.error': 'Не удалось прочитать файл инструкций',
      'state.retry': 'Повторить',
      'file.path': 'Файл:',
      'file.exists': 'Существует',
      'file.missing': 'Файла нет',
      'file.updated': 'Изменён: {date}',
      'file.size': 'Размер: {size}',
      'file.limit': 'Лимит: {size}',
      'editor.label': 'Содержимое инструкций',
      'editor.placeholder': 'Вставьте правила работы или выберите файл AGENTS.md…',
      'editor.dirty': 'Есть несохранённые изменения',
      'action.choose': 'Выбрать файл…',
      'action.save': 'Сохранить',
      'action.saving': 'Сохраняю…',
      'action.reset': 'Отменить изменения',
      'action.delete': 'Удалить файл',
      'action.reload': 'Перечитать',
      'notice.saved': 'Инструкции сохранены. Новые сессии подхватят файл; текущую сессию перезапустите, если нужно применить сразу.',
      'notice.removed': 'Файл инструкций удалён.',
      'notice.reset': 'Изменения отменены.',
      'notice.loaded': 'Файл загружен в редактор, нажмите «Сохранить».',
      'notice.empty': 'Выберите файл или вставьте текст.',
      'confirm.delete': 'Удалить файл инструкций? Новые сессии перестанут применять эти правила.',
      'error.save': 'Не удалось сохранить инструкции',
      'error.delete': 'Не удалось удалить файл',
      'error.file': 'Не удалось прочитать выбранный файл',
      'error.network': 'Нет связи с DSH',
    };

    const en = {
      panel: 'Instructions',
      'page.title': 'Default instructions',
      'page.subtitle':
        'Upload or edit AGENTS.md: DSH reads this file in every session and every project, so the rules apply by default.',
      'state.loading': 'Reading the instruction file…',
      'state.error': 'Could not read the instruction file',
      'state.retry': 'Try again',
      'file.path': 'File:',
      'file.exists': 'Present',
      'file.missing': 'Missing',
      'file.updated': 'Updated: {date}',
      'file.size': 'Size: {size}',
      'file.limit': 'Limit: {size}',
      'editor.label': 'Instruction content',
      'editor.placeholder': 'Paste the working rules or choose an AGENTS.md file…',
      'editor.dirty': 'Unsaved changes',
      'action.choose': 'Choose file…',
      'action.save': 'Save',
      'action.saving': 'Saving…',
      'action.reset': 'Discard changes',
      'action.delete': 'Delete file',
      'action.reload': 'Reload',
      'notice.saved': 'Instructions saved. New sessions pick the file up; restart the current session if it must apply right away.',
      'notice.removed': 'The instruction file was removed.',
      'notice.reset': 'Changes discarded.',
      'notice.loaded': 'File loaded into the editor; press Save.',
      'notice.empty': 'Choose a file or paste the text.',
      'confirm.delete': 'Delete the instruction file? New sessions will stop applying these rules.',
      'error.save': 'Could not save the instructions',
      'error.delete': 'Could not delete the file',
      'error.file': 'Could not read the selected file',
      'error.network': 'No connection to DSH',
    };

    const C = {
      text: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      muted: 'var(--dsw-alias-label-tertiary)',
      bg: 'var(--dsw-alias-bg-base)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      border: 'var(--dsw-alias-border-l1)',
      business: 'var(--dsw-alias-state-business-primary)',
      success: 'var(--dsw-alias-state-success-primary, #2f9e44)',
      danger: 'var(--dsw-alias-state-error-primary, #d9534f)',
      radius: 'var(--dsw-radius-lg)',
      radiusSm: 'var(--dsw-radius-sm)',
      mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    };

    const S = {
      page: { height: '100%', overflowY: 'auto', background: C.bg },
      content: { maxWidth: 900, margin: '0 auto', padding: '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 14 },
      header: { display: 'flex', alignItems: 'flex-start', gap: 16, justifyContent: 'space-between' },
      headText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
      h1: { margin: 0, fontSize: 20, lineHeight: '26px', fontWeight: 600, color: C.text },
      subtitle: { margin: 0, fontSize: 13, lineHeight: '18px', color: C.muted },
      meta: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      badge: { fontSize: 12, lineHeight: '18px', color: C.secondary, border: '1px solid ' + C.border, borderRadius: 999, padding: '1px 8px' },
      badgeOk: { fontSize: 12, lineHeight: '18px', color: C.success, border: '1px solid ' + C.border, borderRadius: 999, padding: '1px 8px' },
      badgeWarn: { fontSize: 12, lineHeight: '18px', color: C.danger, border: '1px solid ' + C.border, borderRadius: 999, padding: '1px 8px' },
      path: { fontFamily: C.mono, fontSize: 12, color: C.secondary, wordBreak: 'break-all' },
      card: { background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      textarea: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: 360,
        resize: 'vertical',
        fontFamily: C.mono,
        fontSize: 12,
        lineHeight: '18px',
        color: C.text,
        background: C.bg,
        border: '1px solid ' + C.border,
        borderRadius: C.radiusSm,
        padding: 12,
      },
      actions: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      notice: { fontSize: 12, lineHeight: '18px', color: C.success, borderLeft: '2px solid ' + C.success, paddingLeft: 8 },
      error: { fontSize: 12, lineHeight: '18px', color: C.danger, borderLeft: '2px solid ' + C.danger, paddingLeft: 8, whiteSpace: 'pre-wrap' },
      hint: { fontSize: 12, lineHeight: '18px', color: C.muted },
      loading: { fontSize: 13, color: C.muted, padding: '16px 0' },
    };

    function buttonStyle(kind) {
      const base = {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        lineHeight: '18px',
        padding: '4px 10px',
        borderRadius: C.radiusSm,
        cursor: 'pointer',
        border: '1px solid ' + C.border,
        background: 'transparent',
        color: C.secondary,
      };
      if (kind === 'primary') return { ...base, background: C.business, borderColor: C.business, color: '#fff' };
      if (kind === 'danger') return { ...base, color: C.danger };
      return base;
    }

    /** Sidebar icon: a document with a pencil, drawn in the current text color. */
    function InstructionsGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: 18, height: 18, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M18 12h20l8 8v32H18z', fill: 'none', stroke: 'currentColor', strokeWidth: 4, strokeLinejoin: 'round' }),
        h('path', { d: 'M38 12v8h8', fill: 'none', stroke: 'currentColor', strokeWidth: 4 }),
        h('path', { d: 'M24 30h16M24 38h10', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round', fill: 'none' }),
        h('path', { d: 'M40 46l7-7 4 4-7 7-5 1z', fill: 'currentColor' })
      );
    }

    function Button({ kind, disabled, onClick, children }) {
      return h(
        'button',
        {
          type: 'button',
          style: disabled === true ? { ...buttonStyle(kind), opacity: 0.55, cursor: 'default' } : buttonStyle(kind),
          disabled: disabled === true,
          onClick: disabled === true ? undefined : onClick,
        },
        children,
      );
    }

    function formatBytes(value) {
      const bytes = Number.isFinite(value) ? Number(value) : 0;
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function createPanelComponent(ctx, t) {
      async function requestJson(url, options) {
        const init = Object.assign({ method: 'GET', credentials: 'same-origin' }, options || {});
        init.headers = Object.assign({ accept: 'application/json' }, options && options.headers ? options.headers : {});
        let response;
        try {
          response = await fetch(url, init);
        } catch (error) {
          throw new Error(t('error.network') + ': ' + (error instanceof Error ? error.message : String(error)));
        }
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          const detail = payload && typeof payload === 'object' && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status;
          throw new Error(detail);
        }
        if (payload === null || typeof payload !== 'object') throw new Error('unexpected response');
        if (payload.ok === false) throw new Error(typeof payload.error === 'string' ? payload.error : 'request failed');
        return payload;
      }

      function InstructionsPage() {
        const [status, setStatus] = React.useState('loading');
        const [file, setFile] = React.useState(null);
        const [draft, setDraft] = React.useState('');
        const [dirty, setDirty] = React.useState(false);
        const [busy, setBusy] = React.useState('');
        const [notice, setNotice] = React.useState('');
        const [error, setError] = React.useState('');
        const inputRef = React.useRef(null);
        const alive = React.useRef(true);

        function applyState(payload) {
          setFile(payload);
          setDraft(typeof payload.content === 'string' ? payload.content : '');
          setDirty(false);
          setStatus('ready');
        }

        function load() {
          setStatus('loading');
          setError('');
          requestJson(ROUTE).then(
            (payload) => {
              if (!alive.current) return;
              applyState(payload);
            },
            (failure) => {
              if (!alive.current) return;
              setError(failure instanceof Error ? failure.message : String(failure));
              setStatus('error');
            },
          );
        }

        React.useEffect(() => {
          alive.current = true;
          load();
          return () => {
            alive.current = false;
          };
        }, []);

        function chooseFile() {
          setNotice('');
          setError('');
          if (inputRef.current !== null) inputRef.current.click();
        }

        function onFileChosen(event) {
          const picked = event.target.files && event.target.files[0];
          event.target.value = '';
          if (!picked) return;
          picked.text().then(
            (text) => {
              if (!alive.current) return;
              setDraft(text);
              setDirty(true);
              setNotice(t('notice.loaded'));
            },
            (failure) => {
              if (!alive.current) return;
              setError(t('error.file') + ': ' + (failure instanceof Error ? failure.message : String(failure)));
            },
          );
        }

        function save() {
          if (busy !== '') return;
          if (draft.trim() === '') {
            setError(t('notice.empty'));
            return;
          }
          setBusy('save');
          setError('');
          setNotice('');
          requestJson(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: draft }),
          }).then(
            (payload) => {
              if (!alive.current) return;
              setBusy('');
              applyState(payload);
              setNotice(t('notice.saved'));
            },
            (failure) => {
              if (!alive.current) return;
              setBusy('');
              setError(t('error.save') + ': ' + (failure instanceof Error ? failure.message : String(failure)));
            },
          );
        }

        function resetDraft() {
          setDraft(file !== null && typeof file.content === 'string' ? file.content : '');
          setDirty(false);
          setError('');
          setNotice(t('notice.reset'));
        }

        function remove() {
          if (busy !== '') return;
          const confirmFn = typeof globalThis.confirm === 'function' ? globalThis.confirm.bind(globalThis) : null;
          if (confirmFn !== null && !confirmFn(t('confirm.delete'))) return;
          setBusy('delete');
          setError('');
          setNotice('');
          requestJson(ROUTE, { method: 'DELETE' }).then(
            (payload) => {
              if (!alive.current) return;
              setBusy('');
              applyState({ ...payload, exists: false, content: '', size: 0, updatedAt: null });
              setNotice(t('notice.removed'));
            },
            (failure) => {
              if (!alive.current) return;
              setBusy('');
              setError(t('error.delete') + ': ' + (failure instanceof Error ? failure.message : String(failure)));
            },
          );
        }

        const exists = file !== null && file.exists === true;
        const path = file !== null && typeof file.path === 'string' ? file.path : '';
        const maxBytes = file !== null && Number.isFinite(file.maxBytes) ? file.maxBytes : 0;

        return h(
          'div',
          { style: S.page },
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
                h('p', { style: S.subtitle }, t('page.subtitle')),
              ),
              h(Button, { disabled: status === 'loading', onClick: load }, t('action.reload')),
            ),
            status === 'error'
              ? h('div', { style: S.card }, h('div', { style: S.error }, error || t('state.error')), h(Button, { onClick: load }, t('state.retry')))
              : null,
            status === 'loading'
              ? h('div', { style: S.loading }, t('state.loading'))
              : h(
                  'div',
                  { style: S.card },
                  h(
                    'div',
                    { style: S.meta },
                    h('span', { style: exists ? S.badgeOk : S.badgeWarn }, exists ? t('file.exists') : t('file.missing')),
                    h('span', { style: S.badge }, t('file.size', { size: formatBytes(file !== null ? file.size : 0) })),
                    maxBytes > 0 ? h('span', { style: S.badge }, t('file.limit', { size: formatBytes(maxBytes) })) : null,
                    file !== null && typeof file.updatedAt === 'string' && file.updatedAt !== ''
                      ? h('span', { style: S.badge }, t('file.updated', { date: formatDate(file.updatedAt) }))
                      : null,
                  ),
                  path === '' ? null : h('div', { style: S.path }, t('file.path') + ' ' + path),
                  h('label', { style: S.hint, htmlFor: 'instructions-editor' }, t('editor.label')),
                  h('textarea', {
                    id: 'instructions-editor',
                    style: S.textarea,
                    spellCheck: false,
                    placeholder: t('editor.placeholder'),
                    value: draft,
                    onChange: (event) => {
                      setDraft(event.target.value);
                      setDirty(true);
                      setNotice('');
                    },
                  }),
                  h(
                    'div',
                    { style: S.row },
                    h(
                      'div',
                      { style: S.actions },
                      h('input', {
                        ref: inputRef,
                        type: 'file',
                        accept: '.md,.markdown,.txt,text/plain,text/markdown',
                        style: { display: 'none' },
                        onChange: onFileChosen,
                      }),
                      h(Button, { onClick: chooseFile }, t('action.choose')),
                      h(Button, { kind: 'primary', disabled: busy !== '' || !dirty, onClick: save }, busy === 'save' ? t('action.saving') : t('action.save')),
                      h(Button, { disabled: busy !== '' || !dirty, onClick: resetDraft }, t('action.reset')),
                      h(Button, { kind: 'danger', disabled: busy !== '' || !exists, onClick: remove }, t('action.delete')),
                    ),
                    dirty ? h('span', { style: S.hint }, t('editor.dirty')) : null,
                  ),
                  notice === '' ? null : h('div', { style: S.notice }, notice),
                  error === '' ? null : h('div', { style: S.error }, error),
                ),
          ),
        );
      }

      return InstructionsPage;
    }

    return {
      inject: ['slots', 'locale'],
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
        }, 'instructions: dictionaries');
        const t = locale !== undefined && locale !== null && typeof locale.bind === 'function' ? locale.bind(NS) : (key) => key;
        const Page = createPanelComponent(ctx, t);
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            Page,
          ),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              locale: NS,
              label: () => t('panel'),
            },
            InstructionsGlyph,
          ),
        );
      },
    };
  },
});
