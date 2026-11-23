/**
 * Safely parses JSON from a fetch Response without crashing with
 * "Unexpected token '<', \"<!doctype \"... is not valid JSON" when
 * a reverse proxy, gateway timeout, or SPA fallback returns HTML.
 */
export async function parseJsonResponse<T = Record<string, unknown>>(
  resp: Response,
  fallbackError?: string
): Promise<T> {
  const rawText = await resp.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    if (!resp.ok) {
      throw new Error(fallbackError || `Request failed (HTTP ${resp.status}).`);
    }
    return {} as T;
  }

  const looksLikeHtml =
    trimmed.startsWith('<') ||
    trimmed.toLowerCase().startsWith('<!doctype') ||
    trimmed.toLowerCase().startsWith('<html');

  if (looksLikeHtml) {
    throw new Error(
      fallbackError ||
        `Server returned an HTML error page instead of JSON (HTTP ${resp.status}). Please try again in a moment.`
    );
  }

  let parsed: T;
  try {
    parsed = JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      fallbackError ||
        `Invalid server response format (HTTP ${resp.status}). Please retry.`
    );
  }

  if (!resp.ok) {
    const errObj = parsed as Record<string, unknown>;
    const msg =
      typeof errObj?.error === 'string' && errObj.error.trim()
        ? errObj.error
        : fallbackError || `Request failed (HTTP ${resp.status}).`;
    throw new Error(msg);
  }

  return parsed;
}
