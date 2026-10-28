/**
 * Client half of the screenshot bundle.
 *
 * Two surfaces:
 *
 * 1. A camera button in the composer tool row (`conversation.input.left`).
 *    It attaches the clipboard image (the usual result of Win+Shift+S), or
 *    opens the composer's own file picker when the clipboard holds no image.
 * 2. The draft-attachment rail (`conversation.input.attachments`). The shipped
 *    rail only previews images, so this bundle replaces it with a rail where
 *    clicking an attached image opens an annotation editor: pen, arrow,
 *    rectangle and text over the screenshot, undo/clear, then "Apply" swaps
 *    the draft attachment for the annotated PNG. Nothing is sent by the rail
 *    itself; the user still writes the prompt and presses send.
 *
 * Replacing the single slot keeps the drop target: the rail installs its own
 * document-level drag listeners and forwards files through `onAddFiles`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-screenshot',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const NS = 'screenshot';
    const BUTTON_SLOT = 'conversation.input.left';
    const ATTACHMENTS_SLOT = 'conversation.input.attachments';
    const BUTTON_ORDER = 1;
    /** Candidate seat weight for the shipped rail (experiment: see install notes). */
    const ATTACHMENTS_PRIORITY = -1;
    const ERROR_VISIBLE_MS = 6000;

    const COLORS = [
      { id: 'red', value: '#e5484d' },
      { id: 'orange', value: '#f5a623' },
      { id: 'green', value: '#30a46c' },
      { id: 'blue', value: '#0091ff' },
      { id: 'black', value: '#111111' },
      { id: 'white', value: '#ffffff' },
    ];
    const WIDTHS = { s: 2, m: 4, l: 7 };

    const EN = {
      'button.aria': 'Attach a screenshot',
      'button.title':
        'Attach a screenshot: reads an image from the clipboard, otherwise opens the image picker (Ctrl+V also works)',
      'error.locked': 'The composer is busy; finish or stop the current turn first.',
      'error.unavailable': 'This session is not ready for attachments yet.',
      'error.failed': 'Could not attach the screenshot.',
      'error.empty': 'The clipboard holds no image, and the file picker is unavailable.',
      'rail.edit': 'Edit screenshot',
      'rail.remove': 'Remove attachment',
      'rail.retry': 'Retry upload',
      'rail.uploading': 'Uploading {percent}%',
      'rail.failed': 'Upload failed',
      'drop.title': 'Drop to attach',
      'editor.title': 'Edit screenshot',
      'editor.close': 'Close',
      'editor.tool.pen': 'Pen',
      'editor.tool.arrow': 'Arrow',
      'editor.tool.rect': 'Rectangle',
      'editor.tool.text': 'Text',
      'editor.color': 'Color',
      'editor.width': 'Line width',
      'editor.undo': 'Undo',
      'editor.clear': 'Clear',
      'editor.cancel': 'Cancel',
      'editor.apply': 'Apply',
      'editor.moveText': 'Move',
      'editor.hint':
        'Drag the strip to move the text box; drag its bottom-right corner to change width and height. The label wraps to the box width inside the screenshot. Apply replaces the attachment with a flattened PNG.',
      'editor.loadFailed': 'The image could not be loaded.',
      'editor.applyFailed': 'The annotated image could not be created.',
      'editor.textPlaceholder': 'Text…',
    };

    const RU = {
      'button.aria': 'Прикрепить скриншот',
      'button.title':
        'Прикрепить скриншот: берёт картинку из буфера обмена, иначе открывает выбор файла (Ctrl+V тоже работает)',
      'error.locked': 'Поле ввода занято: дождитесь конца хода или остановите его.',
      'error.unavailable': 'Сессия ещё не готова принимать вложения.',
      'error.failed': 'Не удалось прикрепить скриншот.',
      'error.empty': 'В буфере нет картинки, а выбор файла недоступен.',
      'rail.edit': 'Редактировать скриншот',
      'rail.remove': 'Убрать вложение',
      'rail.retry': 'Повторить загрузку',
      'rail.uploading': 'Загрузка {percent}%',
      'rail.failed': 'Загрузка не удалась',
      'drop.title': 'Отпустите, чтобы прикрепить',
      'editor.title': 'Редактирование скриншота',
      'editor.close': 'Закрыть',
      'editor.tool.pen': 'Кисть',
      'editor.tool.arrow': 'Стрелка',
      'editor.tool.rect': 'Рамка',
      'editor.tool.text': 'Текст',
      'editor.color': 'Цвет',
      'editor.width': 'Толщина',
      'editor.undo': 'Отменить',
      'editor.clear': 'Очистить',
      'editor.cancel': 'Отмена',
      'editor.apply': 'Применить',
      'editor.moveText': 'Переместить',
      'editor.hint':
        'Тяни полоску, чтобы двигать поле; тяни правый нижний угол — чтобы менять ширину и высоту. Подпись переносится по ширине поля внутри снимка. «Применить» заменит вложение размеченным PNG.',
      'editor.loadFailed': 'Не удалось загрузить изображение.',
      'editor.applyFailed': 'Не удалось собрать размеченное изображение.',
      'editor.textPlaceholder': 'Текст…',
    };

    const CSS = `
.dshScreenshotAnchor{position:relative;display:inline-flex;align-items:center;flex:none}
.dshScreenshotButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none;transition:background-color .12s ease,color .12s ease}
.dshScreenshotButton svg{display:block;width:15px;height:15px}
.dshScreenshotButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshScreenshotButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshScreenshotButton[disabled]{cursor:default;opacity:.5}
.dshScreenshotButton[data-error="true"]{color:var(--dsw-alias-state-error-primary,#d9534f)}
.dshScreenshotSpin{box-sizing:border-box;width:11px;height:11px;border-radius:50%;border:1.5px solid currentColor;border-top-color:transparent;animation:dshScreenshotSpin .7s linear infinite}
@keyframes dshScreenshotSpin{to{transform:rotate(360deg)}}
.dshScreenshotError{position:absolute;left:0;bottom:calc(100% + 6px);z-index:30;white-space:nowrap;pointer-events:none;box-sizing:border-box;border-radius:var(--dsw-radius-sm);padding:4px 8px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-menu,var(--dsw-alias-bg-elevated,#1f1f1f));border:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}
.dshShotRailWrap{position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;min-width:0;width:100%}
.dshShotNotice{font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary,#d9534f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshShotRail{display:flex;align-items:center;gap:8px;overflow-x:auto;overflow-y:hidden;padding:2px 0 4px;scrollbar-width:thin}
.dshShotItem{position:relative;flex:none}
.dshShotThumb{box-sizing:border-box;display:block;width:64px;height:64px;padding:0;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);overflow:hidden;background:var(--dsw-alias-bg-elevated,#1f1f1f);cursor:pointer}
.dshShotThumb img{display:block;width:100%;height:100%;object-fit:cover}
.dshShotThumb:hover{border-color:var(--dsw-alias-state-business-primary,#4d9fff)}
.dshShotThumb:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshShotEditBadge{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-md,10px);background:rgba(0,0,0,.45);color:#fff;opacity:0;pointer-events:none;transition:opacity .12s ease}
.dshShotItem:hover .dshShotEditBadge,.dshShotThumb:focus-visible + .dshShotEditBadge{opacity:1}
.dshShotEditBadge svg{width:20px;height:20px}
.dshShotRemove{position:absolute;top:-5px;right:-5px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:17px;height:17px;padding:0;border:.5px solid var(--dsw-alias-border-l1);border-radius:50%;background:var(--dsw-alias-bg-elevated,#1f1f1f);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s ease}
.dshShotItem:hover .dshShotRemove,.dshShotRemove:focus-visible{opacity:1}
.dshShotRemove:hover{color:var(--dsw-alias-label-primary)}
.dshShotRetry{font-size:12px;line-height:16px;color:var(--dsw-alias-state-warning-primary,#c08a1a);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline}
.dshShotFile{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:220px;height:64px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-elevated,#1f1f1f);color:var(--dsw-alias-label-primary)}
.dshShotFileGlyph{flex:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600;text-transform:uppercase}
.dshShotFileBody{min-width:0;display:flex;flex-direction:column;gap:2px}
.dshShotFileName{font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshShotFileMeta{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshShotDrop{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,.18)}
.dshShotDropCard{box-sizing:border-box;padding:18px 24px;border:1px dashed var(--dsw-alias-state-business-primary,#4d9fff);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-elevated,#1f1f1f);color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;box-shadow:var(--dsw-elevation-prominent)}
.dshShotMask{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.55)}
.dshShotCard{box-sizing:border-box;display:flex;flex-direction:column;max-width:min(1200px,94vw);max-height:92vh;border-radius:var(--dsw-radius-lg);border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-menu,var(--dsw-alias-bg-elevated,#1f1f1f));box-shadow:var(--dsw-elevation-prominent);overflow:hidden}
.dshShotHeader{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshShotClose{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer}
.dshShotClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshShotToolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshShotToolGroup{display:flex;align-items:center;gap:4px}
.dshShotTool{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;min-width:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dshShotTool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshShotTool[aria-pressed="true"],.dshShotTool[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshShotTool svg{width:16px;height:16px;flex:none}
.dshShotToolSep{width:.5px;height:18px;margin:0 4px;background:var(--dsw-alias-border-l2)}
.dshShotSwatch{box-sizing:border-box;width:18px;height:18px;padding:0;border-radius:50%;border:.5px solid var(--dsw-alias-border-l2);cursor:pointer}
.dshShotSwatch[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4d9fff)}
.dshShotWidth{box-sizing:border-box;min-width:24px;height:24px;padding:0 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dshShotWidth[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshShotCanvasWrap{position:relative;display:inline-block;align-self:center;overflow:visible;padding:12px;background:var(--dsw-alias-bg-base,#111);min-height:0}
.dshShotCanvas{display:block;max-width:calc(94vw - 80px);max-height:calc(92vh - 210px);width:auto;height:auto;cursor:crosshair;touch-action:none}
.dshShotTextDock{position:absolute;z-index:3;display:flex;flex-direction:column;align-items:stretch;min-width:0}
.dshShotTextDrag{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:4px;height:17px;padding:0 6px;border:1px solid #4d9fff;border-bottom:none;border-radius:4px 4px 0 0;background:#e8f1ff;color:#2f6fd0;font-size:10px;line-height:1;letter-spacing:.02em;cursor:move;user-select:none;touch-action:none;white-space:nowrap;overflow:hidden}
.dshShotTextInput{display:block;box-sizing:border-box;min-width:160px;min-height:34px;max-width:60vw;max-height:50vh;padding:6px 8px;border:1px solid #4d9fff;border-top:none;border-radius:0 0 4px 4px;background:#ffffff;color:#111111;font-family:inherit;outline:none;resize:both;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dshShotTextInput::placeholder{color:#8a93a5}
.dshShotFooter{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;border-top:.5px solid var(--dsw-alias-border-l2)}
.dshShotFooterHint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);max-width:60ch}
.dshShotFooterActions{display:flex;align-items:center;gap:8px;flex:none}
.dshShotButton{box-sizing:border-box;height:30px;padding:0 14px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dshShotButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshShotButton[disabled]{opacity:.5;cursor:default}
.dshShotPrimary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d9fff);color:#fff}
.dshShotPrimary:hover{filter:brightness(1.06);background:var(--dsw-alias-state-business-primary,#4d9fff)}
.dshShotEditorError{padding:0 14px 8px;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary,#d9534f)}
`;

    /** Translate with a fallback so a missing dictionary never shows a raw key. */
    function translateWith(t, key, fallback, params) {
      let value = key;
      if (typeof t === 'function') {
        try {
          value = params === undefined ? t(key) : t(key, params);
        } catch {
          value = key;
        }
      }
      if (typeof value !== 'string' || value === key) return fallback;
      if (params === undefined) return value;
      return value.replace(/\{(\w+)\}/gu, (match, name) =>
        params[name] === undefined ? match : String(params[name]),
      );
    }

    /** Camera glyph, drawn with `currentColor` so it follows the theme. */
    function CameraIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M2.1 5.4h2.3l.8-1.2h4.6l.8 1.2h2.3c.5 0 .9.4.9.9v5c0 .5-.4.9-.9.9H2.1a.9.9 0 0 1-.9-.9v-5c0-.5.4-.9.9-.9Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 8, cy: 8.4, r: 2.1, stroke: 'currentColor', strokeWidth: 1.2 }),
      );
    }

    /** Pencil glyph for the edit badge. */
    function PencilIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M10.6 2.7 13.3 5.4 5.6 13.1l-3.4.7.7-3.4 7.7-7.7Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      );
    }

    /** Toolbar glyphs. */
    function ToolIcon({ tool }) {
      if (tool === 'pen') {
        return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M2.6 13.4 3.2 10l8-8 2.8 2.8-8 8-3.4.6Z', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }));
      }
      if (tool === 'arrow') {
        return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M2.5 13.5 13 3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }), h('path', { d: 'M7.8 2.9H13v5.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
      }
      if (tool === 'rect') {
        return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('rect', { x: 2.4, y: 3.4, width: 11.2, height: 9.2, rx: 1, stroke: 'currentColor', strokeWidth: 1.2 }));
      }
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M2.6 3.6h10.8M8 3.6v9.2M5.6 12.8h4.8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }));
    }

    /** Read every clipboard image as a browser File, or an empty list. */
    async function readClipboardImages() {
      const clipboard = typeof navigator === 'object' ? navigator.clipboard : undefined;
      if (clipboard === undefined || typeof clipboard.read !== 'function') return [];
      let items;
      try {
        items = await clipboard.read();
      } catch {
        return [];
      }
      const files = [];
      for (const item of items) {
        for (const type of item.types) {
          if (!type.startsWith('image/')) continue;
          let blob;
          try {
            blob = await item.getType(type);
          } catch {
            continue;
          }
          const extension = type.slice('image/'.length).replace(/[^a-z0-9]/gu, '') || 'png';
          files.push(new File([blob], `screenshot.${extension}`, { type }));
        }
      }
      return files;
    }

    /** Human byte size for file chips. */
    function formatBytes(bytes) {
      const value = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0;
      if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
      if (value >= 1024) return `${Math.round(value / 1024)} KB`;
      return `${value} B`;
    }

    /** The composer camera button. */
    function makeScreenshotButton(ctx) {
      return function ScreenshotButton(props) {
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined;
        const t = props.t;
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const timer = React.useRef(null);

        React.useEffect(
          () => () => {
            if (timer.current !== null) window.clearTimeout(timer.current);
          },
          [],
        );

        const fail = (message) => {
          setError(message);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setError(null), ERROR_VISIBLE_MS);
        };

        const attach = async () => {
          const conversation = ctx.get('conversation');
          if (conversation === undefined || sessionId === undefined) {
            fail(translateWith(t, 'error.unavailable', EN['error.unavailable']));
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const files = await readClipboardImages();
            if (files.length > 0) {
              const drafts = conversation.createDrafts(sessionId, files);
              let shell;
              try {
                shell = conversation.input.shell(sessionId);
              } catch {
                conversation.releaseDraftAttachments(drafts);
                fail(translateWith(t, 'error.unavailable', EN['error.unavailable']));
                return;
              }
              if (shell.addAttachments(drafts.map((draft) => draft.id)) !== true) {
                conversation.releaseDraftAttachments(drafts);
                fail(translateWith(t, 'error.locked', EN['error.locked']));
              }
              return;
            }
            if (typeof conversation.input.pickFiles !== 'function' || !conversation.input.canPickFiles(sessionId)) {
              fail(translateWith(t, 'error.empty', EN['error.empty']));
              return;
            }
            conversation.input.pickFiles(sessionId);
          } catch (cause) {
            try {
              console.warn('[screenshot] attach failed', cause);
            } catch {
              // A console failure is not worth breaking the composer.
            }
            fail(translateWith(t, 'error.failed', EN['error.failed']));
          } finally {
            setBusy(false);
          }
        };

        const label = translateWith(t, 'button.aria', EN['button.aria']);
        return h(
          'span',
          { className: 'dshScreenshotAnchor' },
          h('style', null, CSS),
          error === null ? null : h('span', { className: 'dshScreenshotError', role: 'status' }, error),
          h(
            'button',
            {
              type: 'button',
              className: 'dshScreenshotButton',
              'data-error': error === null ? 'false' : 'true',
              'aria-label': label,
              title: translateWith(t, 'button.title', EN['button.title']),
              disabled: busy,
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => {
                void attach();
              },
            },
            busy ? h('span', { className: 'dshScreenshotSpin', 'aria-hidden': true }) : h(CameraIcon),
          ),
        );
      };
    }

    /** Draw one committed annotation onto the flattened canvas. */
    function drawShape(context, shape) {
      context.save();
      context.strokeStyle = shape.color;
      context.fillStyle = shape.color;
      context.lineWidth = Math.max(1, shape.width);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      if (shape.tool === 'pen') {
        const points = Array.isArray(shape.points) ? shape.points : [];
        if (points.length === 1) {
          context.beginPath();
          context.arc(points[0].x, points[0].y, Math.max(1, shape.width / 2), 0, Math.PI * 2);
          context.fill();
        } else if (points.length > 1) {
          context.beginPath();
          context.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
          context.stroke();
        }
      } else if (shape.tool === 'arrow') {
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const head = Math.max(shape.width * 3.4, 9);
        context.beginPath();
        context.moveTo(shape.x1, shape.y1);
        context.lineTo(shape.x2, shape.y2);
        context.stroke();
        context.beginPath();
        context.moveTo(shape.x2, shape.y2);
        context.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 7), shape.y2 - head * Math.sin(angle - Math.PI / 7));
        context.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 7), shape.y2 - head * Math.sin(angle + Math.PI / 7));
        context.closePath();
        context.fill();
      } else if (shape.tool === 'rect') {
        context.strokeRect(shape.x, shape.y, shape.w, shape.h);
      } else if (shape.tool === 'text') {
        context.font = `600 ${shape.fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        context.textBaseline = 'top';
        const lines = wrapAnnotationText(context, String(shape.text), shape.maxWidth);
        lines.forEach((line, index) => context.fillText(line, shape.x, shape.y + index * shape.fontSize * 1.25));
      }
      context.restore();
    }

    /**
     * Break annotation text into lines that fit `maxWidth` image pixels, so a
     * long label stays inside the screenshot instead of running off its edge.
     * An absent or non-positive `maxWidth` keeps the authored line breaks.
     */
    function wrapAnnotationText(context, text, maxWidth) {
      const authored = text.split('\n');
      const width = typeof maxWidth === 'number' && maxWidth > 0 ? maxWidth : 0;
      if (width === 0) return authored;
      const lines = [];
      for (const paragraph of authored) {
        if (paragraph === '') {
          lines.push('');
          continue;
        }
        let current = '';
        for (const token of paragraph.split(/(\s+)/u)) {
          if (token === '') continue;
          const candidate = current + token;
          if (current !== '' && context.measureText(candidate).width > width) {
            lines.push(current.replace(/\s+$/u, ''));
            current = token.replace(/^\s+/u, '');
          } else {
            current = candidate;
          }
        }
        lines.push(current);
      }
      return lines;
    }

    /** Annotation editor shown over one draft image. */
    function ScreenshotEditor({ url, fileName, t, onCancel, onApply }) {
      const canvasRef = React.useRef(null);
      const imageRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const natural = React.useRef({ width: 0, height: 0 });
      const [shapes, setShapes] = React.useState([]);
      const [draftShape, setDraftShape] = React.useState(null);
      const [tool, setTool] = React.useState('pen');
      const [color, setColor] = React.useState(COLORS[0].value);
      const [widthKey, setWidthKey] = React.useState('m');
      const [pendingText, setPendingText] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      /** Displayed canvas width / natural width: the WYSIWYG factor for the text box. */
      const [displayScale, setDisplayScale] = React.useState(1);
      const textAreaRef = React.useRef(null);
      /** In-flight drag of the floating text box (display-space deltas). */
      const dragTextRef = React.useRef(null);
      /** True while the user drags the textarea's native resize corner. */
      const resizingRef = React.useRef(false);

      const strokeWidth = React.useCallback(() => {
        const width = natural.current.width || 1200;
        return Math.max(1, (WIDTHS[widthKey] || 4) * Math.max(1, width / 900));
      }, [widthKey]);

      const measureDisplayScale = React.useCallback(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || image.naturalWidth === 0) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0) setDisplayScale(rect.width / image.naturalWidth);
      }, []);

      const redraw = React.useCallback(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image) return;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        for (const shape of shapes) drawShape(context, shape);
        if (draftShape) drawShape(context, draftShape);
      }, [shapes, draftShape]);

      const redrawRef = React.useRef(redraw);
      redrawRef.current = redraw;

      React.useEffect(() => {
        let alive = true;
        const image = new Image();
        image.onload = () => {
          if (!alive) return;
          imageRef.current = image;
          natural.current = { width: image.naturalWidth, height: image.naturalHeight };
          redrawRef.current();
          measureDisplayScale();
        };
        image.onerror = () => {
          if (alive) setError(translateWith(t, 'editor.loadFailed', EN['editor.loadFailed']));
        };
        image.src = url;
        return () => {
          alive = false;
          image.onload = null;
          image.onerror = null;
        };
      }, [url, t, measureDisplayScale]);

      React.useEffect(() => {
        redraw();
      }, [redraw]);

      React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(() => measureDisplayScale());
        observer.observe(canvas);
        return () => observer.disconnect();
      }, [measureDisplayScale]);

      // Keep the text box big enough for what was typed until the user picks a
      // size by hand: then their width/height stay authoritative.
      React.useEffect(() => {
        const element = textAreaRef.current;
        if (!element || pendingText === null || pendingText.heightPx > 0) return;
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight}px`;
      }, [pendingText, displayScale]);

      // Remember a user-resized size so a later keystroke does not shrink it;
      // the width also becomes the wrap width of the placed label.
      React.useEffect(() => {
        const element = textAreaRef.current;
        if (!element || typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(() => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0) return;
          const resizing = resizingRef.current;
          setPendingText((current) => {
            if (current === null) return current;
            const widthPx = Math.round(rect.width);
            const heightPx = resizing ? Math.round(rect.height) : current.heightPx || 0;
            if (Math.abs((current.widthPx || 0) - widthPx) < 1 && (current.heightPx || 0) === heightPx) return current;
            return { ...current, widthPx, heightPx };
          });
        });
        observer.observe(element);
        return () => observer.disconnect();
      }, [pendingText === null]);

      // A native corner drag ends on window mouseup; from then on the captured
      // size is final and typing no longer re-grows the box.
      React.useEffect(() => {
        const stopResizing = () => {
          resizingRef.current = false;
        };
        window.addEventListener('mouseup', stopResizing, true);
        return () => window.removeEventListener('mouseup', stopResizing, true);
      }, []);

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          if (pendingText !== null) {
            setPendingText(null);
          } else {
            onCancel();
          }
          event.preventDefault();
          event.stopPropagation();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, [pendingText, onCancel]);

      const pointOf = (event) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.width === 0 ? 0 : ((event.clientX - rect.left) * canvas.width) / rect.width,
          y: rect.height === 0 ? 0 : ((event.clientY - rect.top) * canvas.height) / rect.height,
        };
      };

      const setDraft = (shape) => {
        dragRef.current = shape === null ? null : { shape };
        setDraftShape(shape);
      };

      const onPointerDown = (event) => {
        if (busy || event.button !== 0) return;
        event.preventDefault();
        const point = pointOf(event);
        if (tool === 'text') {
          const imageWidth = natural.current.width || 1;
          const imageHeight = natural.current.height || 1;
          setPendingText({
            x: Math.min(Math.max(0, point.x), Math.max(0, imageWidth - 8)),
            y: Math.min(Math.max(0, point.y), Math.max(0, imageHeight - 8)),
            value: '',
            widthPx: 0,
            heightPx: 0,
          });
          return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const width = strokeWidth();
        if (tool === 'pen') {
          setDraft({ tool: 'pen', color, width, points: [point] });
        } else if (tool === 'arrow') {
          setDraft({ tool: 'arrow', color, width, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
        } else {
          setDraft({ tool: 'rect', color, width, x: point.x, y: point.y, w: 0, h: 0 });
        }
      };

      const onPointerMove = (event) => {
        const drag = dragRef.current;
        const current = drag === null ? undefined : drag.shape;
        if (!current) return;
        const point = pointOf(event);
        if (current.tool === 'pen') {
          setDraft({ ...current, points: [...current.points, point] });
        } else if (current.tool === 'arrow') {
          setDraft({ ...current, x2: point.x, y2: point.y });
        } else {
          const startX = current.x + (current.w < 0 ? current.w : 0);
          const startY = current.y + (current.h < 0 ? current.h : 0);
          setDraft({
            ...current,
            x: Math.min(startX, point.x),
            y: Math.min(startY, point.y),
            w: Math.abs(point.x - startX),
            h: Math.abs(point.y - startY),
          });
        }
      };

      const onPointerUp = () => {
        const drag = dragRef.current;
        const current = drag === null ? null : drag.shape;
        dragRef.current = null;
        setDraftShape(null);
        if (!current) return;
        if ((current.tool === 'rect' && (current.w < 2 || current.h < 2)) || (current.tool === 'pen' && current.points.length < 2)) return;
        setShapes((previous) => [...previous, current]);
      };

      const commitText = () => {
        const pending = pendingText;
        if (pending === null) return;
        const text = String(pending.value).replace(/\s+$/u, '');
        setPendingText(null);
        if (text.trim() === '') return;
        const imageWidth = natural.current.width || 1200;
        const imageHeight = natural.current.height || 800;
        const fontSize = Math.max(14, Math.round(imageWidth / 46));
        // The moved/resized box decides both the anchor and the wrap width, so
        // the placed label stays inside the screenshot and matches what the
        // user saw in the editor.
        const element = textAreaRef.current;
        const rect = element === null ? null : element.getBoundingClientRect();
        const boxWidth = rect === null ? imageWidth * 0.6 : rect.width / (displayScale || 1);
        const x = Math.min(Math.max(0, pending.x), Math.max(0, imageWidth - 8));
        const y = Math.min(Math.max(0, pending.y), Math.max(0, imageHeight - 8));
        const maxWidth = Math.max(60, Math.min(Math.round(boxWidth), imageWidth - x - Math.round(imageWidth * 0.02)));
        setShapes((previous) => [...previous, { tool: 'text', color, text, x, y, fontSize, maxWidth }]);
      };

      const applyEdits = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setBusy(true);
        setError(null);
        try {
          const blob = await new Promise((resolve) => {
            canvas.toBlob((value) => resolve(value), 'image/png');
          });
          if (!blob) throw new Error('the canvas could not be encoded');
          const base = String(fileName === undefined ? '' : fileName).replace(/\.[^.]+$/u, '') || 'screenshot';
          onApply(new File([blob], `${base}-annotated.png`, { type: 'image/png' }));
        } catch (cause) {
          try {
            console.warn('[screenshot] annotation export failed', cause);
          } catch {
            // Ignore console failures.
          }
          setError(translateWith(t, 'editor.applyFailed', EN['editor.applyFailed']));
        } finally {
          setBusy(false);
        }
      };

      const textInput = (() => {
        if (pendingText === null) return null;
        const imageWidth = natural.current.width || 1;
        const imageHeight = natural.current.height || 1;
        const fontSizeImage = Math.max(14, Math.round((natural.current.width || 1200) / 46));
        const fontPx = Math.max(12, Math.round(fontSizeImage * displayScale));
        // Initial width: enough for the current line, then the user can drag
        // the native resize handle (the width also becomes the wrap width).
        let defaultWidth = 260;
        try {
          const canvas = canvasRef.current;
          const context = canvas === null ? null : canvas.getContext('2d');
          if (context !== null) {
            context.save();
            context.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
            const longest = Math.max(
              140,
              ...String(pendingText.value || ' ')
                .split('\n')
                .map((line) => context.measureText(line === '' ? ' ' : line).width),
            );
            context.restore();
            defaultWidth = Math.min(Math.max(240, Math.round(longest + 44)), Math.max(280, Math.round(imageWidth * displayScale * 0.6)));
          }
        } catch {
          defaultWidth = 280;
        }
        const width = pendingText.widthPx > 0 ? pendingText.widthPx : defaultWidth;
        const clampPoint = (point) => ({
          x: Math.min(Math.max(0, point.x), Math.max(0, imageWidth - 8)),
          y: Math.min(Math.max(0, point.y), Math.max(0, imageHeight - 8)),
        });
        const onDragStart = (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragTextRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: pendingText.x,
            startY: pendingText.y,
          };
        };
        const onDragMove = (event) => {
          const drag = dragTextRef.current;
          if (drag === null || drag.pointerId !== event.pointerId) return;
          const scale = displayScale || 1;
          const next = clampPoint({
            x: drag.startX + (event.clientX - drag.startClientX) / scale,
            y: drag.startY + (event.clientY - drag.startClientY) / scale,
          });
          setPendingText((current) => (current === null ? current : { ...current, x: next.x, y: next.y }));
        };
        const onDragEnd = () => {
          dragTextRef.current = null;
        };
        const moveLabel = translateWith(t, 'editor.moveText', EN['editor.moveText']);
        return h(
          'div',
          {
            className: 'dshShotTextDock',
            style: {
              left: `${(pendingText.x / imageWidth) * 100}%`,
              top: `${(pendingText.y / imageHeight) * 100}%`,
            },
          },
          h(
            'div',
            {
              className: 'dshShotTextDrag',
              title: moveLabel,
              onPointerDown: onDragStart,
              onPointerMove: onDragMove,
              onPointerUp: onDragEnd,
              onPointerCancel: onDragEnd,
              onMouseDown: (event) => {
                // Keep the textarea focused while the box is dragged.
                event.preventDefault();
                event.stopPropagation();
              },
            },
            '⠿ ',
            moveLabel,
          ),
          h('textarea', {
            ref: textAreaRef,
            className: 'dshShotTextInput',
            autoFocus: true,
            rows: 1,
            value: pendingText.value,
            placeholder: translateWith(t, 'editor.textPlaceholder', EN['editor.textPlaceholder']),
            style: {
              width: `${width}px`,
              fontSize: `${fontPx}px`,
              lineHeight: 1.25,
              ...(pendingText.heightPx > 0 ? { height: `${pendingText.heightPx}px` } : {}),
            },
            onChange: (event) => setPendingText({ ...pendingText, value: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitText();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setPendingText(null);
              }
              event.stopPropagation();
            },
            onBlur: () => commitText(),
            onMouseDown: (event) => {
              const element = textAreaRef.current;
              if (element !== null) {
                const rect = element.getBoundingClientRect();
                // Grab of the native resize corner wins over auto-sizing.
                if (rect.right - event.clientX <= 18 && rect.bottom - event.clientY <= 18) {
                  resizingRef.current = true;
                }
              }
              event.stopPropagation();
            },
          }),
        );
      })();

      const toolButton = (id, fallback) =>
        h(
          'button',
          {
            type: 'button',
            className: 'dshShotTool',
            'aria-pressed': tool === id ? 'true' : 'false',
            'aria-label': translateWith(t, `editor.tool.${id}`, fallback),
            title: translateWith(t, `editor.tool.${id}`, fallback),
            onClick: () => setTool(id),
          },
          h(ToolIcon, { tool: id }),
        );

      return h(
        'div',
        {
          className: 'dshShotMask',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translateWith(t, 'editor.title', EN['editor.title']),
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onCancel();
            event.stopPropagation();
          },
          onKeyDown: (event) => event.stopPropagation(),
        },
        h(
          'div',
          { className: 'dshShotCard', style: { pointerEvents: 'auto' } },
          h(
            'div',
            { className: 'dshShotHeader' },
            h('span', null, translateWith(t, 'editor.title', EN['editor.title'])),
            h(
              'button',
              {
                type: 'button',
                className: 'dshShotClose',
                'aria-label': translateWith(t, 'editor.close', EN['editor.close']),
                title: translateWith(t, 'editor.close', EN['editor.close']),
                onClick: onCancel,
              },
              '×',
            ),
          ),
          h(
            'div',
            { className: 'dshShotToolbar' },
            h('div', { className: 'dshShotToolGroup' }, toolButton('pen', 'Pen'), toolButton('arrow', 'Arrow'), toolButton('rect', 'Rectangle'), toolButton('text', 'Text')),
            h('span', { className: 'dshShotToolSep', 'aria-hidden': true }),
            h(
              'div',
              { className: 'dshShotToolGroup', role: 'group', 'aria-label': translateWith(t, 'editor.color', EN['editor.color']) },
              COLORS.map((entry) =>
                h('button', {
                  key: entry.id,
                  type: 'button',
                  className: 'dshShotSwatch',
                  style: { background: entry.value },
                  'aria-pressed': color === entry.value ? 'true' : 'false',
                  'aria-label': entry.id,
                  title: entry.id,
                  onClick: () => setColor(entry.value),
                }),
              ),
            ),
            h('span', { className: 'dshShotToolSep', 'aria-hidden': true }),
            h(
              'div',
              { className: 'dshShotToolGroup', role: 'group', 'aria-label': translateWith(t, 'editor.width', EN['editor.width']) },
              ['s', 'm', 'l'].map((key) =>
                h(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: 'dshShotWidth',
                    'aria-pressed': widthKey === key ? 'true' : 'false',
                    onClick: () => setWidthKey(key),
                  },
                  h('span', {
                    style: {
                      display: 'block',
                      width: '14px',
                      height: `${WIDTHS[key]}px`,
                      borderRadius: '2px',
                      background: 'currentColor',
                    },
                  }),
                ),
              ),
            ),
            h('span', { className: 'dshShotToolSep', 'aria-hidden': true }),
            h(
              'div',
              { className: 'dshShotToolGroup' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshShotTool',
                  disabled: shapes.length === 0,
                  onClick: () => setShapes((previous) => previous.slice(0, -1)),
                },
                translateWith(t, 'editor.undo', EN['editor.undo']),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshShotTool',
                  disabled: shapes.length === 0,
                  onClick: () => setShapes([]),
                },
                translateWith(t, 'editor.clear', EN['editor.clear']),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dshShotCanvasWrap' },
            h('canvas', {
              ref: canvasRef,
              className: 'dshShotCanvas',
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              onPointerLeave: (event) => {
                if (event.buttons === 0) onPointerUp();
              },
            }),
            textInput,
          ),
          error === null ? null : h('div', { className: 'dshShotEditorError', role: 'status' }, error),
          h(
            'div',
            { className: 'dshShotFooter' },
            h('div', { className: 'dshShotFooterHint' }, translateWith(t, 'editor.hint', EN['editor.hint'])),
            h(
              'div',
              { className: 'dshShotFooterActions' },
              h(
                'button',
                { type: 'button', className: 'dshShotButton', onClick: onCancel, disabled: busy },
                translateWith(t, 'editor.cancel', EN['editor.cancel']),
              ),
              h(
                'button',
                { type: 'button', className: 'dshShotButton dshShotPrimary', onClick: () => void applyEdits(), disabled: busy },
                translateWith(t, 'editor.apply', EN['editor.apply']),
              ),
            ),
          ),
        ),
      );
    }

    /** Draft-attachment rail with click-to-edit images and the composer drop target. */
    function makeAttachmentsRail() {
      return function AttachmentsRail(props) {
        const attachments = Array.isArray(props.attachments) ? props.attachments : [];
        const uploads = props.uploads !== null && typeof props.uploads === 'object' ? props.uploads : {};
        const canAcceptDrop = props.canAcceptDrop === true;
        const t = props.t;
        const [editing, setEditing] = React.useState(null);
        const [dropActive, setDropActive] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const noticeTimer = React.useRef(null);

        const showNotice = React.useCallback((message) => {
          setNotice(message);
          if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
          noticeTimer.current = window.setTimeout(() => setNotice(null), ERROR_VISIBLE_MS);
        }, []);

        React.useEffect(
          () => () => {
            if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
          },
          [],
        );

        React.useEffect(() => {
          if (!canAcceptDrop) {
            setDropActive(false);
            return undefined;
          }
          let depth = 0;
          const hasFiles = (event) =>
            Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
          const onDragEnter = (event) => {
            if (!hasFiles(event)) return;
            depth += 1;
            setDropActive(true);
          };
          const onDragOver = (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          };
          const onDragLeave = (event) => {
            if (!hasFiles(event)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) setDropActive(false);
          };
          const onDrop = (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            depth = 0;
            setDropActive(false);
            const files = [];
            const directories = new Set();
            const transfer = event.dataTransfer;
            if (transfer) {
              for (const item of Array.from(transfer.items || [])) {
                if (item.kind !== 'file') continue;
                const file = item.getAsFile();
                if (!file) continue;
                files.push(file);
                try {
                  const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
                  if (entry && entry.isDirectory) directories.add(file);
                } catch {
                  // Directory detection is best-effort only.
                }
              }
              if (files.length === 0 && transfer.files) {
                for (const file of Array.from(transfer.files)) files.push(file);
              }
            }
            if (files.length === 0 || typeof props.onAddFiles !== 'function') return;
            const result = props.onAddFiles(files, directories.size > 0 ? directories : undefined);
            if (typeof result === 'string' && result !== '') showNotice(result);
          };
          document.addEventListener('dragenter', onDragEnter, true);
          document.addEventListener('dragover', onDragOver, true);
          document.addEventListener('dragleave', onDragLeave, true);
          document.addEventListener('drop', onDrop, true);
          return () => {
            document.removeEventListener('dragenter', onDragEnter, true);
            document.removeEventListener('dragover', onDragOver, true);
            document.removeEventListener('dragleave', onDragLeave, true);
            document.removeEventListener('drop', onDrop, true);
          };
        }, [canAcceptDrop, props.onAddFiles, showNotice]);

        const applyEdit = (file) => {
          const current = editing;
          setEditing(null);
          if (current === null || typeof props.onAddFiles !== 'function') return;
          const result = props.onAddFiles([file]);
          if (typeof result === 'string' && result !== '') {
            showNotice(result);
            return;
          }
          if (typeof props.onRemoveAttachment === 'function') props.onRemoveAttachment(current.id);
        };

        const items = attachments.map((attachment) => {
          const id = attachment.id;
          const file = attachment.file;
          const isImage = attachment.kind === 'image';
          if (isImage) {
            return h(
              'div',
              { className: 'dshShotItem', key: id },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshShotThumb',
                  title: translateWith(t, 'rail.edit', EN['rail.edit']),
                  'aria-label': translateWith(t, 'rail.edit', EN['rail.edit']),
                  onClick: () => setEditing({ id, url: attachment.previewUrl, name: file && file.name ? file.name : 'screenshot.png' }),
                },
                h('img', { src: attachment.previewUrl, alt: '' }),
              ),
              h('span', { className: 'dshShotEditBadge', 'aria-hidden': true }, h(PencilIcon)),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshShotRemove',
                  title: translateWith(t, 'rail.remove', EN['rail.remove']),
                  'aria-label': translateWith(t, 'rail.remove', EN['rail.remove']),
                  onClick: () => typeof props.onRemoveAttachment === 'function' && props.onRemoveAttachment(id),
                },
                '×',
              ),
            );
          }
          const upload = uploads[id];
          const name = file && file.name ? file.name : 'file';
          const size = file && typeof file.size === 'number' ? formatBytes(file.size) : '';
          let meta = size;
          if (upload && upload.status === 'uploading') {
            const total = typeof upload.total === 'number' && upload.total > 0 ? upload.total : 0;
            const percent = total > 0 ? Math.min(99, Math.round(((upload.loaded || 0) / total) * 100)) : 0;
            meta = translateWith(t, 'rail.uploading', EN['rail.uploading'], { percent });
          } else if (upload && upload.status === 'error') {
            meta = translateWith(t, 'rail.failed', EN['rail.failed']);
          }
          return h(
            'div',
            { className: 'dshShotItem', key: id },
            h(
              'div',
              { className: 'dshShotFile' },
              h('span', { className: 'dshShotFileGlyph' }, name.includes('.') ? name.split('.').pop().slice(0, 4) : 'FILE'),
              h(
                'span',
                { className: 'dshShotFileBody' },
                h('span', { className: 'dshShotFileName', title: name }, name),
                h('span', { className: 'dshShotFileMeta' }, meta),
              ),
            ),
            upload && upload.status === 'error' && typeof props.onRetryFile === 'function'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshShotRetry',
                    onClick: () => props.onRetryFile(id),
                  },
                  translateWith(t, 'rail.retry', EN['rail.retry']),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dshShotRemove',
                title: translateWith(t, 'rail.remove', EN['rail.remove']),
                'aria-label': translateWith(t, 'rail.remove', EN['rail.remove']),
                onClick: () => typeof props.onRemoveAttachment === 'function' && props.onRemoveAttachment(id),
              },
              '×',
            ),
          );
        });

        return h(
          React.Fragment,
          null,
          h('style', null, CSS),
          attachments.length === 0
            ? null
            : h(
                'div',
                { className: 'dshShotRailWrap' },
                notice === null ? null : h('div', { className: 'dshShotNotice', role: 'status' }, notice),
                h('div', { className: 'dshShotRail' }, items),
              ),
          dropActive ? h('div', { className: 'dshShotDrop', 'aria-hidden': true }, h('div', { className: 'dshShotDropCard' }, translateWith(t, 'drop.title', EN['drop.title']))) : null,
          editing === null
            ? null
            : h(ScreenshotEditor, {
                key: editing.id,
                url: editing.url,
                fileName: editing.name,
                t,
                onCancel: () => setEditing(null),
                onApply: applyEdit,
              }),
        );
      };
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, ru: RU }), 'screenshot: locale dictionaries');
        ctx.effect(
          () =>
            ctx.slots.inject(BUTTON_SLOT, () =>
              ctx.slots.register(
                { name: BUTTON_SLOT, id: 'screenshot', order: BUTTON_ORDER, locale: NS },
                makeScreenshotButton(ctx),
              ),
            ),
          'screenshot: composer button',
        );
        ctx.effect(
          () =>
            ctx.slots.inject(ATTACHMENTS_SLOT, () =>
              ctx.slots.register(
                { name: ATTACHMENTS_SLOT, locale: NS, priority: ATTACHMENTS_PRIORITY },
                makeAttachmentsRail(),
              ),
            ),
          'screenshot: attachment editor rail',
        );
      },
    };
  },
});
