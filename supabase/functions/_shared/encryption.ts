// supabase/functions/_shared/encryption.ts
// ──────────────────────────────────────────────────────────────────
// Alt B (2026-04-25) — AES-256-GCM encryption för känsliga personuppgifter,
// primärt PNR (personnummer) för RUT-rapportering till Skatteverket.
//
// SYFTE:
//   Spara klartext-PNR krypterat i `bookings.customer_pnr` istället för
//   ren klartext (Hemfrid-modell) eller bara hash (förlorar RUT-möjlighet).
//   Klartext är aldrig "at rest" i DB — bara cipher-text + IV-prefix.
//
// PRIMÄRKÄLLA:
//   - Deno crypto.subtle (Web Crypto API) — Deno 1.x stable
//   - NIST SP 800-38D (GCM mode of operation)
//   - PNR_ENCRYPTION_KEY: 32 bytes random (base64), genererad 2026-04-25,
//     lagrad i Supabase secrets (aldrig i git eller logs)
//
// VERSION-PREFIX:
//   Alla krypterade värden börjar med "AES-GCM:v1:" för:
//   - Detection vid läsning (om börjar med prefix → kryptera, annars klartext-legacy)
//   - Framtida key-rotation (v2 med ny key + migration-flow)
//
// FORMAT:
//   "AES-GCM:v1:" + base64(IV || ciphertext || authTag)
//   IV = 12 bytes (GCM-standard)
//   AuthTag = 16 bytes (GCM-standard, läggs implicit av crypto.subtle.encrypt)
//
// REGLER: #26 grep-före-edit (helper är ny), #27 scope (bara encryption-
// helpers + version-detection), #28 SSOT (alla EFs som behöver PNR-klartext
// ska importera härifrån), #30 inga regulator-claims (encryption är teknik,
// inte juridik), #31 primärkälla (Web Crypto API verifierat fungerande
// i Deno via Supabase Edge Functions).
// ──────────────────────────────────────────────────────────────────

const ENCRYPTION_VERSION = "AES-GCM:v1:";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

// ============================================================
// Key-loading (engångs vid EF-start)
// ============================================================

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const keyBase64 = Deno.env.get("PNR_ENCRYPTION_KEY");
  if (!keyBase64) {
    throw new Error(
      "PNR_ENCRYPTION_KEY env-var saknas. Sätt i Supabase secrets innan EF kan kryptera/dekryptera PNR.",
    );
  }

  const keyBytes = base64ToBytes(keyBase64);
  if (keyBytes.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `PNR_ENCRYPTION_KEY måste vara exakt ${KEY_LENGTH_BYTES} bytes (256 bits) base64-kodat. ` +
      `Aktuell längd: ${keyBytes.length} bytes. Generera ny via: openssl rand -base64 32`,
    );
  }

  // Konvertera till explicit ArrayBuffer (Deno-TS-strikt: Uint8Array<ArrayBufferLike>
  // räknas inte som BufferSource pga SharedArrayBuffer-disambiguation).
  const keyBuffer = toArrayBuffer(keyBytes);

  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return cachedKey;
}

// ============================================================
// Encrypt
// ============================================================

/**
 * Kryptera klartext (typiskt PNR) med AES-256-GCM.
 *
 * Returnerar string i formatet "AES-GCM:v1:" + base64(IV || ciphertext+authTag).
 *
 * IV genereras slumpmässigt per anrop (12 bytes) — krävs av GCM för säkerhet.
 *
 * @param plaintext - Klartext att kryptera (typiskt PNR "YYYYMMDDXXXX")
 * @returns Krypterad sträng med version-prefix, klar att spara i DB
 * @throws Om PNR_ENCRYPTION_KEY saknas eller är ogiltigt format
 */
export async function encryptPnr(plaintext: string): Promise<string> {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("encryptPnr: plaintext måste vara non-empty string");
  }

  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintextBytes),
  );

  // Concatenate IV + ciphertext (auth-tag är de sista 16 bytes av ciphertext)
  const combined = new Uint8Array(iv.length + ciphertextBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBuffer), iv.length);

  return ENCRYPTION_VERSION + bytesToBase64(combined);
}

// ============================================================
// Decrypt
// ============================================================

/**
 * Dekryptera AES-GCM-värde till klartext.
 *
 * Förväntar input i formatet "AES-GCM:v1:" + base64(IV || ciphertext+authTag).
 *
 * @param encrypted - Krypterad sträng från `encryptPnr()`
 * @returns Klartext (typiskt PNR)
 * @throws Om format är ogiltigt, key saknas, eller auth-tag inte matchar
 *         (= tampering eller fel key)
 */
export async function decryptPnr(encrypted: string): Promise<string> {
  if (!encrypted || typeof encrypted !== "string") {
    throw new Error("decryptPnr: encrypted måste vara non-empty string");
  }

  if (!encrypted.startsWith(ENCRYPTION_VERSION)) {
    throw new Error(
      `decryptPnr: värdet börjar inte med ${ENCRYPTION_VERSION}. ` +
      `Är värdet krypterat? Använd isEncrypted() för att checka först.`,
    );
  }

  const key = await getKey();
  const base64Part = encrypted.slice(ENCRYPTION_VERSION.length);
  const combined = base64ToBytes(base64Part);

  if (combined.length < IV_LENGTH_BYTES + 16) {
    throw new Error(
      `decryptPnr: cipher-text för kort (${combined.length} bytes, minst ${IV_LENGTH_BYTES + 16} krävs)`,
    );
  }

  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );

  return new TextDecoder().decode(plaintextBuffer);
}

// ============================================================
// Detection helper
// ============================================================

/**
 * Returnerar true om värdet är krypterat med encryptPnr() (har version-prefix).
 *
 * Används vid läsning där värdet kan vara klartext-legacy eller krypterat-modern.
 * Vid migration: kalla isEncrypted() → om false, kryptera + uppdatera DB.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTION_VERSION);
}

// ============================================================
// Base64 helpers (Deno har inga ergonomiska built-in)
// ============================================================

/**
 * Konvertera Uint8Array till garanterad ArrayBuffer (inte SharedArrayBuffer).
 * Krävs av Deno-TS-strikt eftersom Uint8Array<ArrayBufferLike> inte räknas
 * som BufferSource.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
