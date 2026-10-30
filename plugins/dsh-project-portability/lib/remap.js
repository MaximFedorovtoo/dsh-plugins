/**
 * Absolute-path rewriting for a project imported on another machine.
 *
 * A chat log is a JSON event stream that mentions the project directory in
 * many places (tool arguments, request context, streamed output). When the
 * project lands under a different root on the target computer, every mention of
 * the old root has to follow, otherwise the resumed agent would operate on a
 * path that does not exist. The rewrite is deliberately boundary-aware: the old
 * root is only replaced when it appears as a whole path segment, so
 * `C:\work\app` never mangles `C:\work\application`.
 *
 * @module dsh-project-portability/lib/remap
 */

/** Characters that may legally follow/precede a path segment boundary. */
const PATH_BOUNDARY = new Set(['', '\\', '/', '"', "'", ')', ']', '}', ',', ';', ':', ' ', '\n', '\r', '\t', '|', '>', '<', '`']);

/**
 * Path spellings the same root can take inside a stored event.
 * @param {string} root - absolute path.
 * @returns {string[]} distinct spellings, including lower-case Windows forms.
 */
export function pathVariants(root) {
  const text = String(root ?? '');
  if (text.length === 0) return [];
  const variants = new Set([text, text.replace(/\\/g, '/')]);
  for (const variant of [...variants]) {
    if (/[A-Za-z]/.test(variant)) variants.add(variant.toLowerCase());
  }
  return [...variants].filter((variant) => variant.length > 0);
}

/**
 * Whether the character at `index` is a legal path boundary.
 * @param {string} text - haystack.
 * @param {number} index - position just after/before the match.
 * @returns {boolean} true when the boundary is safe.
 */
function isBoundary(text, index) {
  if (index < 0 || index >= text.length) return true;
  return PATH_BOUNDARY.has(text[index]);
}

/**
 * Replace whole-path occurrences of `needle` with `replacement`.
 * @param {string} text - haystack.
 * @param {string} needle - exact old path spelling.
 * @param {string} replacement - new path.
 * @returns {string} rewritten text.
 */
export function replacePath(text, needle, replacement) {
  if (typeof text !== 'string' || needle.length === 0 || !text.includes(needle)) return text;
  let out = '';
  let cursor = 0;
  for (;;) {
    const found = text.indexOf(needle, cursor);
    if (found === -1) {
      out += text.slice(cursor);
      break;
    }
    const before = found === 0 ? '' : text[found - 1];
    const after = text[found + needle.length] ?? '';
    const boundaryOk = !/[A-Za-z0-9_.\-]/.test(before) && !/[A-Za-z0-9_.\-]/.test(after);
    if (boundaryOk) {
      out += text.slice(cursor, found) + replacement;
      cursor = found + needle.length;
    } else {
      out += text.slice(cursor, found + 1);
      cursor = found + 1;
    }
  }
  return out;
}

/**
 * Build an ordered rewrite plan: longest spellings first so a shorter variant
 * never pre-empts a longer one.
 *
 * Two spellings of every path are covered:
 *  - the literal path (a normal string field), and
 *  - its JSON-escaped form (`\\` for every `\`), which is how the path appears
 *    inside a nested JSON string such as a `tool/call` argument blob.
 *
 * @param {string} oldRoot - absolute project root before the move.
 * @param {string} newRoot - absolute project root after the move.
 * @returns {Array<{ needle: string, replacement: string, kind: string }>} plan.
 */
export function buildPathRemap(oldRoot, newRoot) {
  if (typeof oldRoot !== 'string' || oldRoot.length === 0) throw new Error('oldRoot must be a non-empty path');
  if (typeof newRoot !== 'string' || newRoot.length === 0) throw new Error('newRoot must be a non-empty path');
  /** @type {Map<string, string>} */
  const records = new Map();
  const add = (needle, replacement) => {
    if (needle.length === 0 || records.has(needle)) return;
    records.set(needle, replacement);
  };
  for (const variant of pathVariants(oldRoot)) {
    // Preserve the separator style the event used: a forward-slash model gets a
    // forward-slash replacement.
    const replacement = variant.includes('/') && !newRoot.includes('/') ? newRoot.replace(/\\/g, '/') : newRoot;
    add(variant, replacement);
    // A root mentioned with a trailing separator is a different string match.
    add(variant.endsWith('/') ? variant : `${variant}/`, replacement.endsWith('/') ? replacement : `${replacement}/`);
    // Nested JSON strings carry escaped backslashes.
    if (variant.includes('\\')) {
      add(variant.replace(/\\/g, '\\\\'), replacement.replace(/\\/g, '\\\\'));
      add(`${variant.replace(/\\/g, '\\\\')}\\\\`, `${replacement.replace(/\\/g, '\\\\')}\\\\`);
    }
  }
  const plan = [...records.entries()].map(([needle, replacement]) => ({ needle, replacement, kind: 'path' }));
  plan.sort((left, right) => right.needle.length - left.needle.length);
  return plan;
}

/**
 * Append a session-identity rewrite to a plan.
 * @param {Array<{needle: string, replacement: string, kind: string}>} plan - existing plan.
 * @param {string} oldSessionId - stored session id.
 * @param {string} newSessionId - freshly allocated id.
 * @returns {Array<object>} a new plan with the identity record.
 */
export function withSessionId(plan, oldSessionId, newSessionId) {
  if (typeof oldSessionId !== 'string' || oldSessionId.length === 0) return plan;
  if (typeof newSessionId !== 'string' || newSessionId.length === 0) return plan;
  return [...plan, { needle: oldSessionId, replacement: newSessionId, kind: 'session-id' }];
}

/**
 * Rewrite every string inside a JSON value according to the plan.
 * @param {unknown} value - parsed JSON value.
 * @param {Array<{needle: string, replacement: string}>} plan - rewrite plan.
 * @returns {unknown} rewritten clone.
 */
export function remapJson(value, plan) {
  if (Array.isArray(value)) return value.map((item) => remapJson(item, plan));
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = remapJson(item, plan);
    return out;
  }
  if (typeof value !== 'string') return value;
  let text = value;
  for (const { needle, replacement } of plan) {
    if (text.includes(needle)) text = replacePath(text, needle, replacement);
  }
  return text;
}

/**
 * Rewrite one session event log (array of events) for a new project root and id.
 * @param {Array<object>} events - stored events.
 * @param {{ oldCwd: string, newCwd: string, oldSessionId?: string, newSessionId?: string }} input - identity facts.
 * @returns {Array<object>} rewritten events.
 */
export function remapEvents(events, input) {
  let plan = buildPathRemap(input.oldCwd, input.newCwd);
  if (input.oldSessionId && input.newSessionId) plan = withSessionId(plan, input.oldSessionId, input.newSessionId);
  return /** @type {Array<object>} */ (remapJson(events, plan));
}
