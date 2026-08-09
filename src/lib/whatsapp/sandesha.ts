/**
 * Sandesha.ai WhatsApp template-send client.
 *
 * Contract (from the provider's Postman collection):
 *   POST {baseUrl}/send/whatsapp/template
 *   headers: X-Api-Key, Content-Type: application/json
 *   body:    { toNumber, templateName, languageCode: 'en', bodyParams: string[] }
 *
 * Rules baked in here:
 *   - languageCode is always 'en' (en_US / en_GB fail with 132001).
 *   - bodyParams is positional and must never contain an empty string — the
 *     caller (templates.ts) is responsible for coalescing, but we defend too.
 *   - 200 + { status: 'SENT' } is success; store providerMessageId (the Meta
 *     wamid) as the delivery correlation key.
 *   - A 504 / network error may mean the message WAS accepted but the response
 *     was lost. We return { status: 'unknown' } for these and the caller must
 *     NOT auto-retry (no idempotency on the provider side).
 *
 * Never throws on an HTTP or network error — always returns a typed result so
 * the drain loop can record it and move on.
 */

const DEFAULT_BASE_URL = 'https://sandesha.ai/api/v1';
const TIMEOUT_MS = 15_000;

export type SendResult =
  | { status: 'sent'; providerMessageId: string | null; messageId: string | null }
  | { status: 'failed'; httpStatus: number; errorCode: string | null; error: string }
  | { status: 'unknown'; reason: string };

type SandeshaResponse = {
  status?: string;
  providerMessageId?: string;
  messageId?: string;
  errorCode?: string;
  error?: string;
};

export async function sendWhatsAppTemplate(input: {
  toNumber: string;
  templateName: string;
  bodyParams: string[];
}): Promise<SendResult> {
  const apiKey = process.env.SANDESHA_API_KEY;
  if (!apiKey) {
    return { status: 'failed', httpStatus: 0, errorCode: 'NO_API_KEY', error: 'SANDESHA_API_KEY is not set' };
  }
  // Defensive: an empty positional param triggers Meta 132000.
  if (input.bodyParams.some((p) => p == null || p.length === 0)) {
    return { status: 'failed', httpStatus: 0, errorCode: 'EMPTY_PARAM', error: 'bodyParams contains an empty value' };
  }

  const baseUrl = process.env.SANDESHA_BASE_URL ?? DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/send/whatsapp/template`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toNumber: input.toNumber,
        templateName: input.templateName,
        languageCode: 'en',
        bodyParams: input.bodyParams,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    // Timeout / DNS / connection reset — provider may or may not have accepted.
    return { status: 'unknown', reason: err instanceof Error ? err.message : 'network error' };
  } finally {
    clearTimeout(timer);
  }

  // A gateway timeout is the documented duplicate risk — treat as unknown.
  if (res.status === 504) return { status: 'unknown', reason: 'PROVIDER_TIMEOUT' };

  let body: SandeshaResponse | null = null;
  try {
    body = (await res.json()) as SandeshaResponse;
  } catch {
    /* non-JSON body */
  }

  if (res.ok && body?.status === 'SENT') {
    return {
      status: 'sent',
      providerMessageId: body.providerMessageId ?? null,
      messageId: body.messageId ?? null,
    };
  }

  return {
    status: 'failed',
    httpStatus: res.status,
    errorCode: body?.errorCode ?? null,
    error: body?.error ?? `HTTP ${res.status}`,
  };
}
