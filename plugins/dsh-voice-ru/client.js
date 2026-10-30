/**
 * dsh-voice-ru — client half.
 *
 * Two actions in the composer dock:
 *
 * 1. **Voice task** (microphone): one click starts recording; after ~1.2 s of
 *    silence the recording stops automatically, the Host transcribes it with
 *    the local Russian provider, shapes the theses into a structured task with
 *    the project context, and the task is sent to the agent immediately — no
 *    second click. A click while recording stops it manually.
 * 2. **Run task**: shapes the current draft (typed or dictated by the built-in
 *    voice input) and sends it. Shift+click only inserts it into the draft.
 */
window.__ModuleLoader__.load({
  id: 'dsh-voice-ru',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'voice-ru';

    const ru = {
      taskButton: 'В задачу',
      taskBusy: 'Формирую задачу…',
      taskHint: 'Сформировать связную задачу из тезисов в поле ввода — текст появится в поле для проверки и ручной отправки',
      micButton: 'Голосом',
      micStop: 'Стоп',
      micBusy: 'Распознаю…',
      micHint: 'Нажмите и надиктуйте тезисы — после паузы связная задача появится в поле для проверки и ручной отправки',
      micListening: 'Говорите…',
      micInserted: 'Задача в поле — проверьте и отправьте сами',
      micTooShort: 'Слишком короткая запись — надиктуйте ещё раз',
      empty: 'Сначала надиктуйте тезисы голосом',
      noActions: 'Не удалось заменить текст в поле ввода',
      micDenied: 'Нет доступа к микрофону',
      error: 'Не получилось: {message}',
    };

    const en = {
      taskButton: 'Make task',
      taskBusy: 'Shaping the task…',
      taskHint: 'Shape the theses in the composer into one coherent task — the text is inserted for you to review and send manually',
      micButton: 'Voice',
      micStop: 'Stop',
      micBusy: 'Recognizing…',
      micHint: 'Click and dictate the theses — after a pause the coherent task is inserted into the composer for you to review and send manually',
      micListening: 'Listening…',
      micInserted: 'The task is in the composer — review and send it yourself',
      micTooShort: 'Recording is too short — try again',
      empty: 'Dictate the theses first',
      noActions: 'Could not replace the composer text',
      micDenied: 'Microphone access is denied',
      error: 'Failed: {message}',
    };

    const BTN = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 24,
      padding: '0 10px',
      borderRadius: 'var(--dsw-radius-sm)',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '18px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };
    const BTN_RECORDING = {
      ...BTN,
      borderColor: 'var(--dsw-alias-state-error-primary)',
      color: 'var(--dsw-alias-state-error-primary)',
    };

    /** Compact round icon button for the composer activity row (the old mic spot). */
    const ICON_BTN = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      padding: 0,
      borderRadius: '50%',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
    };
    const ICON_BTN_RECORDING = {
      ...ICON_BTN,
      borderColor: 'var(--dsw-alias-state-error-primary)',
      color: 'var(--dsw-alias-state-error-primary)',
      background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)',
    };

    const MIC_ICON = h(
      'svg',
      { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('rect', { x: 5.6, y: 1.8, width: 4.8, height: 7.4, rx: 2.4, stroke: 'currentColor', strokeWidth: 1.2 }),
      h('path', { d: 'M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2V14.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
    );

    const TASK_ICON = h(
      'svg',
      { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M3 12h10M3 8h7M3 4h10', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      h('path', { d: 'm11.5 9.5 1.5 1.5-1.5 1.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    );

    function interpolate(template, params) {
      return typeof template === 'string'
        ? template.replace(/\{(\w+)\}/g, (match, key) => (params && key in params ? String(params[key]) : match))
        : '';
    }

    /** Resolve the session action face from whichever prop the slot supplies. */
    function actionsOf(props) {
      if (props.inputActions !== undefined && props.inputActions !== null) return props.inputActions;
      if (props.keyboard !== undefined && props.keyboard !== null && props.keyboard.actions !== undefined) return props.keyboard.actions;
      return undefined;
    }

    /** Little-endian ASCII into a DataView. */
    function writeAscii(view, offset, text) {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    }

    /** Encode mono Float32 samples as 16-bit PCM WAV. */
    function encodeWav(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      writeAscii(view, 0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeAscii(view, 8, 'WAVE');
      writeAscii(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, 'data');
      view.setUint32(40, samples.length * 2, true);
      for (let index = 0; index < samples.length; index += 1) {
        const clamped = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      }
      return new Uint8Array(buffer);
    }

    /** Convert raw bytes to base64 without call-stack limits. */
    function toBase64(bytes) {
      let binary = '';
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk));
      }
      return window.btoa(binary);
    }

    /** Decode a recorded blob and re-encode it as 16 kHz mono PCM16 WAV base64. */
    async function blobToWavBase64(blob) {
      const bytes = await blob.arrayBuffer();
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      const context = new AudioCtor();
      let decoded;
      try {
        decoded = await context.decodeAudioData(bytes.slice(0));
      } finally {
        if (typeof context.close === 'function') await context.close();
      }
      const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
      const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const offline = new OfflineCtor(1, frames, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      return toBase64(encodeWav(rendered.getChannelData(0), 16000));
    }

    /** Shape the composer draft into a task and send it (or only insert on Shift). */
    function TaskButton(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (ru[key] !== undefined ? ru[key] : key);
      const input = typeof props.useInput === 'function' ? props.useInput((state) => state) : undefined;
      const draft = input !== undefined && typeof input.draft === 'string' ? input.draft : '';
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      if (busy) return h('span', { style: { ...BTN, cursor: 'default', opacity: 0.7 } }, t('taskBusy'));
      if (draft.trim() === '') return null;

      const run = () => {
        setBusy(true);
        setError('');
        fetch('api/voice-ru/task', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ text: draft, sessionId: props.sessionId }),
        })
          .then(async (response) => {
            let payload = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
            if (!response.ok || payload === null || payload.ok === false) {
              throw new Error(payload !== null && typeof payload.error === 'string' && payload.error !== '' ? payload.error : `HTTP ${response.status}`);
            }
            return payload;
          })
          .then((payload) => {
            const actions = actionsOf(props);
            if (actions === undefined || typeof actions.setDraft !== 'function') throw new Error(t('noActions'));
            // Only shape the text: the user reviews it and sends it manually.
            actions.setDraft(payload.task);
          })
          .catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)))
          .finally(() => setBusy(false));
      };

      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 } },
        h('button', { type: 'button', style: BTN, title: t('taskHint'), onClick: run }, TASK_ICON, t('taskButton')),
        error === '' ? null : h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' } }, interpolate(ru.error, { message: error })),
      );
    }

    /** One-click dictation: record, auto-stop on silence, shape and send. */
    function VoiceButton(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (ru[key] !== undefined ? ru[key] : key);
      const [state, setState] = React.useState('idle');
      const [error, setError] = React.useState('');
      const session = React.useRef({ stop: null, cancel: null });

      const finish = React.useCallback((reason) => {
        const current = session.current;
        if (current === null) return;
        session.current = null;
        if (current.interval !== null) window.clearInterval(current.interval);
        if (typeof current.cancel === 'function') current.cancel();
        setState('thinking');
        const blob = new Blob(current.chunks, { type: current.mimeType || 'audio/webm' });
        void (async () => {
          try {
            if (blob.size < 8000) throw new Error(t('micTooShort'));
            const audioBase64 = await blobToWavBase64(blob);
            const response = await fetch('api/voice-ru/dictate', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ audioBase64, sessionId: props.sessionId }),
            });
            let payload = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
            if (!response.ok || payload === null || payload.ok === false) {
              throw new Error(payload !== null && typeof payload.error === 'string' && payload.error !== '' ? payload.error : `HTTP ${response.status}`);
            }
            const actions = actionsOf(props);
            if (actions === undefined || typeof actions.setDraft !== 'function') throw new Error(t('noActions'));
            // Insert the shaped task into the composer; the user reviews and sends it.
            actions.setDraft(payload.task);
            setError('');
            setState('inserted');
            window.setTimeout(() => setState((current) => (current === 'inserted' ? 'idle' : current)), 8000);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
            setState('error');
          }
        })();
      }, [props, t]);

      const start = React.useCallback(async () => {
        setError('');
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
          const AudioCtor = window.AudioContext || window.webkitAudioContext;
          const audioContext = new AudioCtor();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
          const recorder = mimeType === '' ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });
          const chunks = [];
          recorder.addEventListener('dataavailable', (event) => {
            if (event.data !== undefined && event.data.size > 0) chunks.push(event.data);
          });
          const stopTracks = () => {
            for (const track of stream.getTracks()) track.stop();
            if (typeof audioContext.close === 'function') void audioContext.close();
          };
          const cancel = () => {
            try {
              recorder.stop();
            } catch {
              // Recorder was already stopped.
            }
            stopTracks();
          };
          session.current = { chunks, mimeType, interval: null, cancel };
          recorder.start(250);
          setState('recording');
          let speechSeen = false;
          let silenceSince = null;
          const startedAt = Date.now();
          session.current.interval = window.setInterval(() => {
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (let index = 0; index < samples.length; index += 1) {
              const value = (samples[index] - 128) / 128;
              sum += value * value;
            }
            const rms = Math.sqrt(sum / samples.length);
            if (rms > 0.02) {
              speechSeen = true;
              silenceSince = null;
            } else if (speechSeen) {
              if (silenceSince === null) silenceSince = Date.now();
              else if (Date.now() - silenceSince > 1200) finish('silence');
            }
            if (Date.now() - startedAt > 60000) finish('timeout');
          }, 100);
        } catch (failure) {
          setError(t('micDenied'));
          setState('error');
        }
      }, [finish, t]);

      const onClick = () => {
        if (state === 'recording') finish('manual');
        else if (state === 'idle' || state === 'error') void start();
      };

      if (state === 'thinking') return h('span', { style: { ...ICON_BTN, cursor: 'default', opacity: 0.6 }, title: t('micBusy') }, MIC_ICON);
      const recording = state === 'recording';
      const inserted = state === 'inserted';
      return h(
        'button',
        {
          type: 'button',
          style: recording ? ICON_BTN_RECORDING : ICON_BTN,
          title: recording ? t('micStop') : inserted ? t('micInserted') : error === '' ? t('micHint') : interpolate(ru.error, { message: error }),
          onClick,
        },
        MIC_ICON,
        recording ? h('span', { style: { position: 'absolute', width: 6, height: 6, marginTop: 16, marginLeft: 16, borderRadius: '50%', background: 'var(--dsw-alias-state-error-primary)' } }) : null,
      );
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { ru, en }), 'voice-ru: locale dictionaries');
        // The microphone lives exactly where the built-in voice input used to
        // render it: in the composer activity row, next to Send.
        ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register({ name: 'conversation.input.activity', locale: NS }, VoiceButton),
        );
        // Shaping an already typed/dictated draft stays under the composer.
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'voice-task', order: 3, locale: NS }, TaskButton),
        );
      },
    };
  },
});
