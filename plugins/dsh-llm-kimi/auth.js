/**
 * Credential resolution through the harness credential seam.
 *
 * The Models settings page stores a key write-only under the profile's
 * credential reference (`KIMI_CODE_API_KEY` for the subscription route,
 * `MOONSHOT_API_KEY` for the pay-per-token route). The file-backed provider
 * also falls back to the launch environment, so a CI job can export the same
 * reference instead of writing it through the UI.
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, assertUsableApiKey } from '@deepseek-ai/dsh-llm'

/**
 * Resolve the API key one route authenticates with.
 * @param ctx - plugin context carrying the credential service.
 * @param profile - resolved route profile naming the credential reference.
 * @returns the usable key value.
 * @throws LlmError MISSING_CREDENTIAL when nothing supplies the reference.
 */
export async function resolveApiKey(ctx, profile) {
  let ref
  try {
    ref = credentialRef(profile.apiKeyEnv)
  } catch (error) {
    throw new LlmError(
      `llm-kimi: provider "${profile.id}" apiKeyEnv "${profile.apiKeyEnv}" is not a valid credential reference`,
      'INVALID_CREDENTIAL',
      { cause: error },
    )
  }
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-kimi', ref)
  } else {
    const ambient = launchEnvironmentOf(ctx).get(ref)
    if (ambient !== undefined && typeof ambient.value === 'string' && ambient.value.length > 0) {
      return assertUsableApiKey(ambient.value, 'llm-kimi', ref)
    }
  }
  throw new LlmError(
    `llm-kimi: no API key for provider "${profile.id}"; add it in Settings -> Models (stored as ${ref}), or export ${ref}`,
    'MISSING_CREDENTIAL',
  )
}
