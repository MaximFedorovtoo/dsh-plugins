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

    return {
      name: NS,
      inject: ['commandUi', 'conversation', 'locale'],
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
      },
    };
  },
});
