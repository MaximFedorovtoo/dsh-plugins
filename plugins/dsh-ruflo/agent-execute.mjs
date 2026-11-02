/**
 * dsh-ruflo — DeepSeek execution worker.
 *
 * Ruflo's CLI has no "execute" command: `agent spawn --task` only registers an
 * agent. The real LLM call lives in its `agent-execute-core` module, which
 * supports OpenRouter-compatible endpoints through `RUFLO_PROVIDER=openrouter`
 * + `OPENROUTER_BASE_URL`. This worker calls that core with the saved DeepSeek
 * settings and prints one JSON result; it is the executor for ruflo_execute.
 *
 * Input (stdin JSON): { settingsPath, corePath, model, prompt, systemPrompt, maxTokens, timeoutMs }
 * Output (stdout JSON): { success, model, output, usage, error?, durationMs }
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Read stdin fully. */
function readStdin() {
  return readFileSync(0, 'utf8');
}

const input = JSON.parse(readStdin() || '{}');
const settings = JSON.parse(readFileSync(String(input.settingsPath), 'utf8'));
const baseUrl = String(settings.baseUrl ?? '').replace(/\/+$/, '');
if (baseUrl !== 'https://api.deepseek.com') {
  console.log(JSON.stringify({ success: false, error: 'ruflo worker: разрешён только https://api.deepseek.com' }));
  process.exit(0);
}
if (typeof settings.apiKey !== 'string' || settings.apiKey === '') {
  console.log(JSON.stringify({ success: false, error: 'ruflo worker: ключ DeepSeek не задан' }));
  process.exit(0);
}

process.env.RUFLO_PROVIDER = 'openrouter';
process.env.OPENROUTER_API_KEY = settings.apiKey;
process.env.OPENROUTER_BASE_URL = baseUrl;
process.env.OPENROUTER_DEFAULT_MODEL = String(settings.model ?? 'deepseek-chat');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_BASE_URL;
delete process.env.OLLAMA_API_KEY;
delete process.env.OLLAMA_BASE_URL;

try {
  const core = await import(pathToFileURL(String(input.corePath)).href);
  if (typeof core.callAnthropicMessages !== 'function') {
    console.log(JSON.stringify({ success: false, error: 'ruflo worker: callAnthropicMessages не найден в agent-execute-core' }));
    process.exit(0);
  }
  const result = await core.callAnthropicMessages({
    provider: 'openrouter',
    model: String(input.model ?? settings.model ?? 'deepseek-chat'),
    systemPrompt: String(input.systemPrompt ?? ''),
    prompt: String(input.prompt ?? ''),
    maxTokens: Number.isSafeInteger(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : 4000,
    timeoutMs: Number.isSafeInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 120000,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
}
