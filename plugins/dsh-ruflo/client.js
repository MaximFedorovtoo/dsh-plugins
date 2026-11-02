/**
 * dsh-ruflo — client half.
 *
 * Adds the `/ruflo` command to the composer's command menu (the same menu as
 * Compact / Permission / Model / Export). It opens a popup with Ruflo quick
 * actions; picking one inserts a ready prompt into the composer via the public
 * conversation input shell, so the model then calls the ruflo_* tools.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ruflo',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'ruflo-command';

    const ru = {
      title: 'Ruflo',
      description: 'Память, задачи и swarm Ruflo: проект или этот чат',
      search: 'Действие Ruflo…',
      empty: 'Нет доступных действий',
      noMatch: 'Ничего не найдено',
      'opt.statusProject': 'Статус Ruflo — проект',
      'opt.statusProject.detail': 'Агенты, задачи, память и swarm в папке проекта',
      'opt.statusChat': 'Статус Ruflo — этот чат',
      'opt.statusChat.detail': 'Изолированное состояние текущего чата',
      'opt.memoryStoreProject': 'Запомнить в память проекта',
      'opt.memoryStoreProject.detail': 'Записать факт/решение в общую память проекта',
      'opt.memoryStoreChat': 'Запомнить в память чата',
      'opt.memoryStoreChat.detail': 'Приватная заметка только для этого чата',
      'opt.memorySearchProject': 'Найти в памяти проекта',
      'opt.memorySearchProject.detail': 'Семантический поиск по памяти проекта',
      'opt.memorySearchChat': 'Найти в памяти чата',
      'opt.memorySearchChat.detail': 'Поиск по памяти текущего чата',
      'opt.memoryStatsChat': 'Статистика памяти чата',
      'opt.memoryStatsChat.detail': 'Сколько записей и где лежит база',
      'opt.tasksProject': 'Задачи Ruflo — проект',
      'opt.tasksProject.detail': 'Список задач Ruflo проекта',
      'opt.tasksChat': 'Задачи Ruflo — этот чат',
      'opt.tasksChat.detail': 'Список задач изолированного чата',
      'opt.initProject': 'Инициализировать Ruflo в проекте',
      'opt.initProject.detail': 'Создаст .claude-flow/, .claude/ и память в проекте',
      'opt.initChat': 'Инициализировать Ruflo в чате',
      'opt.initChat.detail': 'Только в кэше этого чата, проект не трогает',
      'opt.swarmChat': 'Swarm Ruflo — этот чат',
      'opt.swarmChat.detail': 'Инициализировать или показать swarm в чате',
      'cmd.statusProject': 'Покажи статус Ruflo в проекте (scope: project).',
      'cmd.statusChat': 'Покажи статус Ruflo в этом чате (scope: chat).',
      'cmd.memoryStoreProject': 'Запомни в памяти проекта: ',
      'cmd.memoryStoreChat': 'Запомни в памяти этого чата: ',
      'cmd.memorySearchProject': 'Найди в памяти проекта: ',
      'cmd.memorySearchChat': 'Найди в памяти этого чата: ',
      'cmd.memoryStatsChat': 'Покажи статистику памяти Ruflo в этом чате (scope: chat).',
      'cmd.tasksProject': 'Покажи задачи Ruflo в проекте (scope: project).',
      'cmd.tasksChat': 'Покажи задачи Ruflo в этом чате (scope: chat).',
      'cmd.initProject': 'Инициализируй Ruflo в проекте (scope: project).',
      'cmd.initChat': 'Инициализируй Ruflo в этом чате (scope: chat).',
      'cmd.swarmChat': 'Покажи статус swarm Ruflo в этом чате; если swarm не инициализирован — инициализируй его в v3-режиме (scope: chat).',
      settingsTitle: 'DeepSeek API для исполнителя Ruflo',
      settingsHint: 'Ключ хранится вне проекта — в профиле DSH (settings.json), вводится только здесь. Разрешён только endpoint https://api.deepseek.com. Ключ можно проверить перед сохранением.',
      settingsBase: 'Endpoint',
      settingsModel: 'Модель',
      settingsKey: 'API-ключ DeepSeek',
      settingsKeyPlaceholder: 'sk-… (вставьте ключ, он не показывается)',
      settingsKeySaved: 'Ключ сохранён. Введите новый, чтобы заменить.',
      settingsSave: 'Сохранить',
      settingsVerify: 'Проверить ключ',
      settingsClear: 'Удалить ключ',
      settingsSaved: 'Сохранено.',
      settingsVerified: 'Ключ DeepSeek работает.',
      settingsVerifyFailed: 'Проверка не прошла: ',
      settingsNoKey: 'Ключ не задан — исполнитель Ruflo работать не будет.',
      settingsLoading: 'Загрузка…',
      settingsLastError: 'Последняя ошибка: ',
      settingsVerifiedAt: 'Проверен: ',
    };

    const en = {
      title: 'Ruflo',
      description: 'Ruflo memory, tasks and swarm: project or this chat',
      search: 'Ruflo action…',
      empty: 'No actions available',
      noMatch: 'Nothing found',
      'opt.statusProject': 'Ruflo status — project',
      'opt.statusProject.detail': 'Agents, tasks, memory and swarm in the project folder',
      'opt.statusChat': 'Ruflo status — this chat',
      'opt.statusChat.detail': 'Isolated state of the current chat',
      'opt.memoryStoreProject': 'Remember in project memory',
      'opt.memoryStoreProject.detail': 'Store a fact/decision in the shared project memory',
      'opt.memoryStoreChat': 'Remember in chat memory',
      'opt.memoryStoreChat.detail': 'Private note for this chat only',
      'opt.memorySearchProject': 'Search project memory',
      'opt.memorySearchProject.detail': 'Semantic search over project memory',
      'opt.memorySearchChat': 'Search chat memory',
      'opt.memorySearchChat.detail': 'Search this chat’s memory',
      'opt.memoryStatsChat': 'Chat memory stats',
      'opt.memoryStatsChat.detail': 'Entry count and DB location',
      'opt.tasksProject': 'Ruflo tasks — project',
      'opt.tasksProject.detail': 'List project Ruflo tasks',
      'opt.tasksChat': 'Ruflo tasks — this chat',
      'opt.tasksChat.detail': 'List tasks of the isolated chat',
      'opt.initProject': 'Initialize Ruflo in the project',
      'opt.initProject.detail': 'Writes .claude-flow/, .claude/ and memory into the project',
      'opt.initChat': 'Initialize Ruflo in this chat',
      'opt.initChat.detail': 'Only in the chat cache, the project stays untouched',
      'opt.swarmChat': 'Ruflo swarm — this chat',
      'opt.swarmChat.detail': 'Initialize or show the chat swarm',
      'cmd.statusProject': 'Show Ruflo status in the project (scope: project).',
      'cmd.statusChat': 'Show Ruflo status in this chat (scope: chat).',
      'cmd.memoryStoreProject': 'Remember in project memory: ',
      'cmd.memoryStoreChat': 'Remember in this chat’s memory: ',
      'cmd.memorySearchProject': 'Search project memory: ',
      'cmd.memorySearchChat': 'Search this chat’s memory: ',
      'cmd.memoryStatsChat': 'Show Ruflo memory stats for this chat (scope: chat).',
      'cmd.tasksProject': 'Show Ruflo tasks in the project (scope: project).',
      'cmd.tasksChat': 'Show Ruflo tasks in this chat (scope: chat).',
      'cmd.initProject': 'Initialize Ruflo in the project (scope: project).',
      'cmd.initChat': 'Initialize Ruflo in this chat (scope: chat).',
      'cmd.swarmChat': 'Show Ruflo swarm status in this chat; if the swarm is not initialized, initialize it in v3 mode (scope: chat).',
      settingsTitle: 'DeepSeek API for the Ruflo executor',
      settingsHint: 'The key lives outside the project in the DSH profile (settings.json) and is entered only here. Only https://api.deepseek.com is allowed. You can verify the key before saving.',
      settingsBase: 'Endpoint',
      settingsModel: 'Model',
      settingsKey: 'DeepSeek API key',
      settingsKeyPlaceholder: 'sk-… (paste the key, it is never shown)',
      settingsKeySaved: 'A key is saved. Enter a new one to replace it.',
      settingsSave: 'Save',
      settingsVerify: 'Verify key',
      settingsClear: 'Remove key',
      settingsSaved: 'Saved.',
      settingsVerified: 'The DeepSeek key works.',
      settingsVerifyFailed: 'Verification failed: ',
      settingsNoKey: 'No key configured — the Ruflo executor will not run.',
      settingsLoading: 'Loading…',
      settingsLastError: 'Last error: ',
      settingsVerifiedAt: 'Verified: ',
    };

    const OPTIONS = [
      ['statusProject', 'statusProject'],
      ['statusChat', 'statusChat'],
      ['memoryStoreProject', 'memoryStoreProject'],
      ['memoryStoreChat', 'memoryStoreChat'],
      ['memorySearchProject', 'memorySearchProject'],
      ['memorySearchChat', 'memorySearchChat'],
      ['memoryStatsChat', 'memoryStatsChat'],
      ['tasksProject', 'tasksProject'],
      ['tasksChat', 'tasksChat'],
      ['initChat', 'initChat'],
      ['initProject', 'initProject'],
      ['swarmChat', 'swarmChat'],
    ];

    function RufloIcon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6.2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 8, cy: 8, r: 2.4, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      );
    }

    /**
     * Append a prepared prompt to the composer draft through the public
     * conversation input shell and focus the composer.
     * @param {object} ctx - client plugin context.
     * @param {string} sessionId - target session.
     * @param {string} text - prompt to append.
     */
    function insertPrompt(ctx, sessionId, text) {
      const conversation = ctx.get('conversation');
      const input = conversation !== undefined && conversation !== null ? conversation.input : undefined;
      if (input === undefined || typeof input.shell !== 'function') throw new Error('Ruflo: поле ввода недоступно');
      const shell = input.shell(sessionId);
      if (typeof shell.appendDraft === 'function') shell.appendDraft(text);
      else if (typeof shell.setDraft === 'function') shell.setDraft(text);
      else throw new Error('Ruflo: не удалось вставить текст в поле ввода');
      if (typeof shell.focus === 'function') shell.focus();
    }

    const FIELD = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 };
    const INPUT = {
      boxSizing: 'border-box',
      height: 28,
      padding: '0 8px',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      borderRadius: 'var(--dsw-radius-sm)',
      background: 'var(--dsw-alias-bg-l2)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
    };
    const BUTTON = {
      boxSizing: 'border-box',
      height: 28,
      padding: '0 12px',
      borderRadius: 'var(--dsw-radius-sm)',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
    };

    /**
     * Bundle settings page (Plugins → Ruflo). The DeepSeek API key is entered
     * here, stored in DSH_HOME/ruflo/settings.json, and verified against
     * https://api.deepseek.com only.
     */
    function SettingsPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (ru[key] !== undefined ? ru[key] : key);
      const [state, setState] = React.useState({ loading: true, baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], model: 'deepseek-chat', hasKey: false, verifiedAt: null, lastError: null });
      const [key, setKey] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [message, setMessage] = React.useState('');

      React.useEffect(() => {
        let alive = true;
        fetch('api/ruflo/settings', { credentials: 'same-origin', headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((payload) => {
            if (alive && payload !== null && payload.ok === true) setState((current) => ({ ...current, ...payload.settings, loading: false }));
          })
          .catch(() => {})
          .finally(() => {
            if (alive) setState((current) => (current.loading ? { ...current, loading: false } : current));
          });
        return () => {
          alive = false;
        };
      }, []);

      const request = async (path, body) => {
        const response = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });
        return await response.json();
      };

      const save = async () => {
        setBusy('save');
        setMessage('');
        try {
          const payload = await request('api/ruflo/settings', { model: state.model, ...(key.trim() !== '' ? { apiKey: key.trim() } : {}) });
          if (payload.ok === true) {
            setState((current) => ({ ...current, ...payload.settings }));
            setKey('');
            setMessage(t('settingsSaved'));
          } else setMessage(payload.error || t('settingsVerifyFailed'));
        } catch (error) {
          setMessage(String(error));
        } finally {
          setBusy('');
        }
      };

      const verify = async () => {
        setBusy('verify');
        setMessage('');
        try {
          const payload = await request('api/ruflo/verify', { ...(key.trim() !== '' ? { apiKey: key.trim() } : {}) });
          if (payload.ok === true) {
            setState((current) => ({ ...current, hasKey: true, verifiedAt: new Date().toISOString(), lastError: null }));
            setKey('');
            const models = Array.isArray(payload.models) && payload.models.length > 0 ? ` (${payload.models.slice(0, 4).join(', ')})` : '';
            setMessage(t('settingsVerified') + models);
          } else setMessage(t('settingsVerifyFailed') + (payload.error || `status ${String(payload.status ?? '')}`));
        } catch (error) {
          setMessage(String(error));
        } finally {
          setBusy('');
        }
      };

      const clear = async () => {
        setBusy('clear');
        setMessage('');
        try {
          const payload = await request('api/ruflo/settings', { clearKey: true });
          if (payload.ok === true) setState((current) => ({ ...current, hasKey: false, verifiedAt: null }));
        } catch (error) {
          setMessage(String(error));
        } finally {
          setBusy('');
        }
      };

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' } },
        h('div', { style: { fontSize: 14, fontWeight: 600 } }, t('settingsTitle')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('settingsHint')),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) 1fr', gap: 8, alignItems: 'center' } },
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('settingsBase')),
          h('code', { style: { fontSize: 12 } }, state.baseUrl),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('settingsModel')),
          h(
            'select',
            { style: INPUT, value: state.model, onChange: (event) => setState((current) => ({ ...current, model: event.target.value })) },
            ...(Array.isArray(state.models) ? state.models : ['deepseek-chat', 'deepseek-reasoner']).map((model) => h('option', { key: model, value: model }, model)),
          ),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('settingsKey')),
          h('input', {
            style: INPUT,
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: state.hasKey ? t('settingsKeySaved') : t('settingsKeyPlaceholder'),
            value: key,
            onChange: (event) => setKey(event.target.value),
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: save }, busy === 'save' ? '…' : t('settingsSave')),
          h('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: verify }, busy === 'verify' ? '…' : t('settingsVerify')),
          h('button', { type: 'button', style: BUTTON, disabled: busy !== '' || !state.hasKey, onClick: clear }, busy === 'clear' ? '…' : t('settingsClear')),
        ),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          state.loading ? t('settingsLoading') : state.hasKey ? (state.verifiedAt === null ? '● ' + t('settingsKeySaved') : '✓ ' + t('settingsVerifiedAt') + state.verifiedAt) : '○ ' + t('settingsNoKey'),
          state.lastError !== null && state.lastError !== undefined ? h('div', null, t('settingsLastError') + state.lastError) : null,
          message !== '' ? h('div', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, message) : null,
        ),
      );
    }

    return {
      name: NS,
      inject: ['commandUi', 'conversation', 'locale', 'slots'],
      apply(ctx) {
        const locale = ctx.get('locale');
        if (locale !== undefined && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, { ru, en }), 'ruflo: command locale');
        }
        const t = locale !== undefined && typeof locale.bind === 'function' ? locale.bind(NS) : (key) => (ru[key] !== undefined ? ru[key] : key);

        ctx.effect(() =>
          ctx.commandUi.register({
            name: 'ruflo',
            label: () => t('title'),
            description: () => t('description'),
            icon: RufloIcon,
            available: () => true,
            ui: {
              kind: 'popupSelect',
              searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noMatch: t('noMatch') }),
              options: async () => OPTIONS.map(([id]) => ({ id, label: t(`opt.${id}`), detail: t(`opt.${id}.detail`) })),
              onSelect: (option, session) => {
                const prompt = t(`cmd.${option.id}`);
                insertPrompt(ctx, session.sessionId, prompt);
              },
            },
          }),
          'ruflo: /ruflo command',
        );

        // Bundle settings page on Plugins → Ruflo: DeepSeek API key entry.
        if (ctx.slots !== undefined) {
          ctx.slots.inject('plugins.bundle.config', () =>
            ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-ruflo', locale: NS }, SettingsPanel),
          );
        }
      },
    };
  },
});
