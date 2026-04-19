// ═══════════════════════════════════════════════════════════════
// SPICK – Stripe webhook HMAC-signature-validering (shared)
// 
// Används av:
// - stripe-connect-webhook (Sprint B Dag 1)
// - stripe-webhook (planerad uppgradering, senare sprint)
//
// Implementerar Stripe's standard HMAC-SHA256-validering enligt:
// https://stripe.com/docs/webhooks/signatures
// ═══════════════════════════════════════════════════════════════

export interface StripeSignatureParts {
  timestamp: number;
  signatures: string[];
}

/**
 * Parsar Stripe-Signature-header
 * Format: "t=1492774577,v1=abc123...,v1=xyz456..."
 */
export function parseStripeSignature(header: string): StripeSignatureParts {
  const parts: StripeSignatureParts = { timestamp: 0, signatures: [] };
  
  for (const element of header.split(",")) {
    const [key, value] = element.split("=", 2);
    if (key === "t") parts.timestamp = parseInt(value, 10);
    else if (key === "v1") parts.signatures.push(value);
  }
  
  return parts;
}

/**
 * Beräknar förväntad signatur
 * Format: HMAC-SHA256(`${timestamp}.${payload}`, secret)
 */
async function computeSignature(payload: string, timestamp: number, secret: string): Promise<string> {
  const signedPayload = `${timestamp}.${payload}`;
  
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Timing-safe string comparison för att förhindra timing-attacker
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verifiera en Stripe webhook-signatur.
 * 
 * @param rawBody Request body EXACT som mottagen (inte JSON.parse:ad och stringify:ad om)
 * @param signatureHeader Värdet av "Stripe-Signature"-headern
 * @param secret Webhook signing secret (whsec_...)
 * @param toleranceSeconds Max skillnad i sekunder mellan timestamp och nu (default 300 = 5 min)
 * 
 * @returns { valid, reason } — valid=true om OK, reason=string om fail
 */
export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300
): Promise<{ valid: boolean; reason?: string }> {
  if (!signatureHeader) {
    return { valid: false, reason: "missing_signature_header" };
  }
  
  if (!secret) {
    return { valid: false, reason: "missing_secret" };
  }
  
  const parts = parseStripeSignature(signatureHeader);
  
  if (!parts.timestamp) {
    return { valid: false, reason: "no_timestamp_in_signature" };
  }
  
  if (parts.signatures.length === 0) {
    return { valid: false, reason: "no_v1_signature" };
  }
  
  // Skydd mot replay: timestamp max 5 min gammal
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parts.timestamp) > toleranceSeconds) {
    return { valid: false, reason: `timestamp_outside_tolerance (${Math.abs(now - parts.timestamp)}s)` };
  }
  
  // Beräkna expected + jämför
  const expected = await computeSignature(rawBody, parts.timestamp, secret);
  
  for (const provided of parts.signatures) {
    if (timingSafeEqual(expected, provided)) {
      return { valid: true };
    }
  }
  
  return { valid: false, reason: "signature_mismatch" };
}
