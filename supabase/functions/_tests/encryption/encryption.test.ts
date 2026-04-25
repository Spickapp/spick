// supabase/functions/_tests/encryption/encryption.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för _shared/encryption.ts (Alt B PNR-kryptering, 2026-04-25).
//
// Kör: deno test supabase/functions/_tests/encryption/encryption.test.ts --allow-env
//
// Test-key (32 bytes base64) sätts via env-var per test (cleanup efter).
//
// Täckning:
//   - encrypt + decrypt round-trip för svenska PNR
//   - encrypt två gånger ger olika output (IV randomiserad)
//   - decrypt med fel key throwar
//   - decrypt med tampered cipher-text throwar (auth-tag-verifiering)
//   - isEncrypted detection
//   - decrypt utan version-prefix throwar tydligt
//   - Empty/null input throwar
//   - Klart text-PNR (legacy) detection korrekt
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assertRejects, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Test-key — 32 bytes base64 (genererad med crypto.getRandomValues för testet)
const TEST_KEY_1 = "QkM1Y2pkb2gzd2hkOWVrYWlrZWowOWZqaGtmaWtsZW8=";
const TEST_KEY_2 = "ZGlmZmVyZW50LXRlc3Qta2V5LTMyLWJ5dGVzLWxvbmcyMQ==";

// Helper: sätt key + dynamiskt importera (för cache-bust mellan tests)
async function withKey<T>(key: string, fn: (mod: typeof import("../../_shared/encryption.ts")) => Promise<T>): Promise<T> {
  Deno.env.set("PNR_ENCRYPTION_KEY", key);
  // Dynamisk re-import så cachedKey i modulen rensas mellan tester
  const mod = await import("../../_shared/encryption.ts?ts=" + Date.now());
  try {
    return await fn(mod);
  } finally {
    Deno.env.delete("PNR_ENCRYPTION_KEY");
  }
}

// ── Test 1: Round-trip ──────────────────────────────────────────

Deno.test("encryptPnr + decryptPnr — round-trip svenska PNR", async () => {
  await withKey(TEST_KEY_1, async (mod) => {
    const original = "198001011234";
    const encrypted = await mod.encryptPnr(original);

    assert(encrypted.startsWith("AES-GCM:v1:"), "Saknar version-prefix");
    assert(encrypted.length > 50, "Cipher-text för kort");

    const decrypted = await mod.decryptPnr(encrypted);
    assertEquals(decrypted, original);
  });
});

// ── Test 2: IV-randomisering ────────────────────────────────────

Deno.test("encryptPnr — två krypteringar av samma plaintext ger olika cipher-text (IV randomiserad)", async () => {
  await withKey(TEST_KEY_1, async (mod) => {
    const plaintext = "199012121234";
    const enc1 = await mod.encryptPnr(plaintext);
    const enc2 = await mod.encryptPnr(plaintext);
    assert(enc1 !== enc2, "Cipher-text ska variera per anrop pga slumpmässig IV");

    // Båda ska dekrypteras korrekt till samma värde
    const dec1 = await mod.decryptPnr(enc1);
    const dec2 = await mod.decryptPnr(enc2);
    assertEquals(dec1, plaintext);
    assertEquals(dec2, plaintext);
  });
});

// ── Test 3: Fel key ─────────────────────────────────────────────

Deno.test("decryptPnr — fel key kastar (auth-tag-mismatch)", async () => {
  // Encrypt med key 1
  const encrypted = await withKey(TEST_KEY_1, async (mod) => {
    return await mod.encryptPnr("198501013344");
  });

  // Försök decrypt med key 2 → ska kasta
  await withKey(TEST_KEY_2, async (mod) => {
    await assertRejects(
      () => mod.decryptPnr(encrypted),
      Error,
    );
  });
});

// ── Test 4: Tampered cipher-text ────────────────────────────────

Deno.test("decryptPnr — tampered cipher-text kastar", async () => {
  await withKey(TEST_KEY_1, async (mod) => {
    const original = "199206304455";
    const encrypted = await mod.encryptPnr(original);

    // Manipulera sista tecknet
    const lastChar = encrypted[encrypted.length - 1];
    const tampered = encrypted.slice(0, -1) +
      (lastChar === "A" ? "B" : "A");

    await assertRejects(
      () => mod.decryptPnr(tampered),
      Error,
    );
  });
});

// ── Test 5: isEncrypted detection ───────────────────────────────

Deno.test("isEncrypted — korrekt för krypterad / klartext / null", async () => {
  await withKey(TEST_KEY_1, async (mod) => {
    const encrypted = await mod.encryptPnr("197304056677");
    assert(mod.isEncrypted(encrypted), "Krypterad ska detekteras");

    assert(!mod.isEncrypted("198001011234"), "Klartext-PNR ska inte detekteras som krypterad");
    assert(!mod.isEncrypted(null), "null → false");
    assert(!mod.isEncrypted(undefined), "undefined → false");
    assert(!mod.isEncrypted(""), "Tom sträng → false");
    assert(!mod.isEncrypted("AES-GCM:v0:foo"), "Annan version → false");
  });
});

// ── Test 6: Saknad version-prefix ───────────────────────────────

Deno.test("decryptPnr — saknad version-prefix throwar tydligt", async () => {
  await withKey(TEST_KEY_1, async (mod) => {
    await assertRejects(
      () => mod.decryptPnr("198001011234"),
      Error,
      "AES-GCM:v1:",
    );
  });
});

// ── Test 7: Empty / null input ──────────────────────────────────

Deno.test("encryptPnr / decryptPnr — empty string throwar", async () => {
  await withKey(TEST_KEY_1, async (mod) => {
    await assertRejects(
      () => mod.encryptPnr(""),
      Error,
      "non-empty",
    );
    await assertRejects(
      () => mod.decryptPnr(""),
      Error,
      "non-empty",
    );
  });
});

// ── Test 8: Saknad key ──────────────────────────────────────────

Deno.test("encryptPnr — saknad PNR_ENCRYPTION_KEY throwar tydligt", async () => {
  Deno.env.delete("PNR_ENCRYPTION_KEY");
  const mod = await import("../../_shared/encryption.ts?ts=" + Date.now());
  await assertRejects(
    () => mod.encryptPnr("198001011234"),
    Error,
    "PNR_ENCRYPTION_KEY",
  );
});
