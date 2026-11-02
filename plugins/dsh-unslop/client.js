/**
 * dsh-unslop — client half.
 *
 * Adds the `/unslop` command to the composer's command menu. It opens a popup
 * with de-AI actions; picking one inserts a ready prompt into the composer so
 * the user can paste the text and send it, and the model then calls the
 * unslop_* tools.
 */
window.__ModuleLoader__.load({
  id: 'dsh-unslop',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'unslop-command';

    const ru = {
      title: 'unslop',
      description: 'Де-AI текста: сканеры, preservation-гейты, перепись',
      search: 'Действие unslop…',
      empty: 'Нет доступных действий',
      noMatch: 'Ничего не найдено',
      'opt.scan': 'Проверить текст (сканеры)',
      'opt.scan.detail': 'phrase/structure/silhouette — только реальные проблемы в контексте',
      'opt.rewrite': 'Переписать по unslop',
      'opt.rewrite.detail': 'scan → constraints → rewrite → preservation → повторный scan',
      'opt.suggest': 'Предложения без правок',
      'opt.suggest.detail': 'unslop_suggest + четыре контрактных гейта',
      'opt.validate': 'Сверить сохранение фактов',
      'opt.validate.detail': 'unslop_validate между оригиналом и переписью',
      'opt.guide': 'Показать доктрину unslop',
      'opt.guide.detail': 'SKILL.md: cleanup/rewrite/teach/mimic и границы',
      'cmd.scan': 'Проверь следующий текст через unslop_scan (phrase, structure, silhouette) и покажи только реальные проблемы в контексте, без «лечения» того, что не болело. Текст: ',
      'cmd.rewrite': 'Перепиши следующий текст по доктрине unslop: сначала unslop_scan и unslop_constraints, затем unslop_rewrite; сохрани все числа, имена, даты, цитаты, единицы и регистр; покажи rewritten, preservation и scan до/после. Текст: ',
      'cmd.suggest': 'Дай unslop_suggest с check:true для следующего текста — предложения со span/severity/rationale и результат контрактных гейтов, ничего не меняя. Текст: ',
      'cmd.validate': 'Сверь сохранение фактов между оригиналом и переписью через unslop_validate (strict для регулируемого текста). Оригинал и перепись: ',
      'cmd.guide': 'Прочитай unslop_guide и кратко объясни, как применить unslop к моему тексту: что чистить, что защищать, какие гейты обязательны.',
    };

    const en = {
      title: 'unslop',
      description: 'De-AI writing: scanners, preservation gates, rewrite',
      search: 'unslop action…',
      empty: 'No actions available',
      noMatch: 'Nothing found',
      'opt.scan': 'Scan text (scanners)',
      'opt.scan.detail': 'phrase/structure/silhouette — only real problems in context',
      'opt.rewrite': 'Rewrite with unslop',
      'opt.rewrite.detail': 'scan → constraints → rewrite → preservation → re-scan',
      'opt.suggest': 'Suggestions without edits',
      'opt.suggest.detail': 'unslop_suggest + the four contract gates',
      'opt.validate': 'Check fact preservation',
      'opt.validate.detail': 'unslop_validate between original and rewrite',
      'opt.guide': 'Show the unslop doctrine',
      'opt.guide.detail': 'SKILL.md: cleanup/rewrite/teach/mimic and limits',
      'cmd.scan': 'Scan the following text with unslop_scan (phrase, structure, silhouette) and report only real problems in context, without “fixing” what was not broken. Text: ',
      'cmd.rewrite': 'Rewrite the following text under the unslop doctrine: run unslop_scan and unslop_constraints first, then unslop_rewrite; keep every number, name, date, quote, unit and register; show rewritten, preservation and before/after scans. Text: ',
      'cmd.suggest': 'Give unslop_suggest with check:true for the following text — suggestions with span/severity/rationale and the contract-gate result, changing nothing. Text: ',
      'cmd.validate': 'Check fact preservation between the original and the rewrite with unslop_validate (strict for regulated text). Original and rewrite: ',
      'cmd.guide': 'Read unslop_guide and briefly explain how to apply unslop to my text: what to clean, what to protect, which gates are mandatory.',
    };

    const OPTIONS = ['scan', 'rewrite', 'suggest', 'validate', 'guide'];

    function UnslopIcon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M2.5 4.5h8M2.5 8h6M2.5 11.5h4.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M11 9.5l2 2M13 9.5l-2 2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      );
    }

    /**
     * Append a prepared prompt to the composer draft through the public
     * conversation input shell and focus the composer.
     */
    function insertPrompt(ctx, sessionId, text) {
      const conversation = ctx.get('conversation');
      const input = conversation !== undefined && conversation !== null ? conversation.input : undefined;
      if (input === undefined || typeof input.shell !== 'function') throw new Error('unslop: поле ввода недоступно');
      const shell = input.shell(sessionId);
      if (typeof shell.appendDraft === 'function') shell.appendDraft(text);
      else if (typeof shell.setDraft === 'function') shell.setDraft(text);
      else throw new Error('unslop: не удалось вставить текст в поле ввода');
      if (typeof shell.focus === 'function') shell.focus();
    }

    return {
      name: NS,
      inject: ['commandUi', 'conversation', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        if (locale !== undefined && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, { ru, en }), 'unslop: command locale');
        }
        const t = locale !== undefined && typeof locale.bind === 'function' ? locale.bind(NS) : (key) => (ru[key] !== undefined ? ru[key] : key);

        ctx.effect(() =>
          ctx.commandUi.register({
            name: 'unslop',
            label: () => t('title'),
            description: () => t('description'),
            icon: UnslopIcon,
            available: () => true,
            ui: {
              kind: 'popupSelect',
              searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noMatch: t('noMatch') }),
              options: async () => OPTIONS.map((id) => ({ id, label: t(`opt.${id}`), detail: t(`opt.${id}.detail`) })),
              onSelect: (option, session) => {
                insertPrompt(ctx, session.sessionId, t(`cmd.${option.id}`));
              },
            },
          }),
          'unslop: /unslop command',
        );
      },
    };
  },
});
