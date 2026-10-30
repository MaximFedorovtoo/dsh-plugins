/**
 * GigaAM Russian ASR worker (plain Node process).
 *
 * sherpa-onnx returns external buffers, which the Electron host forbids ("V8
 * memory cage"), so recognition runs in a separate plain-Node process. The
 * parent speaks one JSON object per line over stdin and reads one JSON reply
 * per line from stdout.
 */
'use strict';

const readline = require('node:readline');

let sherpa;
let recognizer;
let modelPath;
let tokensPath;

/**
 * Create the recognizer if needed.
 * @param {string} model - model.int8.onnx path.
 * @param {string} tokens - tokens.txt path.
 * @param {number} threads - CPU threads.
 */
function load(model, tokens, threads) {
  if (recognizer !== undefined && modelPath === model && tokensPath === tokens) return;
  if (sherpa === undefined) sherpa = require(process.env.SHERPA_MODULE_PATH || 'sherpa-onnx-node');
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      nemoCtc: { model },
      tokens,
      numThreads: Number.isSafeInteger(threads) && threads > 0 ? threads : 2,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_ctc',
    },
  });
  modelPath = model;
  tokensPath = tokens;
}

/**
 * Transcribe one 16 kHz mono PCM16 WAV file.
 * @param {string} wavPath - absolute WAV path.
 * @param {string} model - model path.
 * @param {string} tokens - tokens path.
 * @param {number} threads - CPU threads.
 * @returns {{text: string}} transcript.
 */
function transcribe(wavPath, model, tokens, threads) {
  load(model, tokens, threads);
  const wave = sherpa.readWave(wavPath);
  if (wave.sampleRate !== 16000) throw new Error(`WAV sample rate must be 16000, got ${wave.sampleRate}`);
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  return { text: String(result && result.text ? result.text : '').trim() };
}

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === '') return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: null, ok: false, error: `bad request: ${String(error)}` })}\n`);
    return;
  }
  try {
    if (request.op === 'ping') {
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true })}\n`);
      return;
    }
    if (request.op === 'load') {
      load(request.model, request.tokens, request.threads);
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true })}\n`);
      return;
    }
    if (request.op === 'transcribe') {
      const result = transcribe(request.wavPath, request.model, request.tokens, request.threads);
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, text: result.text })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: `unknown op ${String(request.op)}` })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request.id ?? null, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  }
});
process.on('disconnect', () => process.exit(0));
