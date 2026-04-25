// scripts/migrate-pnr-encrypt.ts
// ──────────────────────────────────────────────────────────────────
// Alt B (2026-04-25) — engångs-migration av befintliga klartext-PNR
// i `bookings.customer_pnr` till AES-256-GCM-krypterat format.
//
// Bakgrund (per docs/sanning/pnr-och-gdpr.md):
//   - 36 rader i bookings.customer_pnr per 2026-04-24
//   - Varav 11 klartext (12 tecken YYYYMMDDXXXX) — 3 riktiga personer
//   - 27 var redan AES-krypterade med okänd nyckel (legacy från före TIC #1)
//   - 1 hash-format (48 tecken)
//
// Detta skript:
//   - Loopar över alla bookings WHERE customer_pnr IS NOT NULL
//   - Detekterar befintligt format (klartext / Alt B-krypterat / legacy-okänd)
//   - Klartext (12 tecken siffror) → kryptera med Alt B + UPDATE
//   - Alt B-krypterat (börjar med "AES-GCM:v1:") → SKIP (redan migrerat)
//   - Legacy-okänd (56 / 48 tecken) → LOG + SKIP (kräver separat utredning)
//
// KÖRNING:
//   PNR_ENCRYPTION_KEY=<base64-nyckel> \
//   SUPABASE_URL=https://urjeijcncsyuletprydy.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-key> \
//   deno run --allow-env --allow-net scripts/migrate-pnr-encrypt.ts
//
// Idempotent: re-run gör inget för redan-migrerade rader.
//
// REGLER: #26 grep-före-edit (script är nytt), #27 scope (bara Alt B-migration),
// #28 SSOT (encryptPnr från _shared/encryption.ts), #29 audit-data per
// docs/sanning/pnr-och-gdpr.md, #30 inga regulator-claims (bara
// reformaterar lagrad data), #31 verifierar format INNAN kryptering.
// ──────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encryptPnr, isEncrypted } from "../supabase/functions/_shared/encryption.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Saknar SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY env-vars.");
  Deno.exit(1);
}

if (!Deno.env.get("PNR_ENCRYPTION_KEY")) {
  console.error("Saknar PNR_ENCRYPTION_KEY env-var.");
  Deno.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Format-detection ──
const CLARTEXT_PNR_REGEX = /^\d{12}$/;
const LEGACY_56_REGEX = /^.{56}$/;
const LEGACY_48_REGEX = /^.{48}$/;

interface Stats {
  total: number;
  alreadyAltB: number;
  clartextMigrated: number;
  legacy56Skipped: number;
  legacy48Skipped: number;
  unknown: number;
  errors: number;
}

const stats: Stats = {
  total: 0,
  alreadyAltB: 0,
  clartextMigrated: 0,
  legacy56Skipped: 0,
  legacy48Skipped: 0,
  unknown: 0,
  errors: 0,
};

console.log("=== Alt B PNR-migration startad ===");

const { data: bookings, error } = await sb
  .from("bookings")
  .select("id, customer_pnr, customer_email")
  .not("customer_pnr", "is", null);

if (error) {
  console.error("Fetch failed:", error.message);
  Deno.exit(1);
}

if (!bookings || bookings.length === 0) {
  console.log("Inga bookings med customer_pnr — inget att migrera.");
  Deno.exit(0);
}

stats.total = bookings.length;
console.log(`Hittade ${bookings.length} bookings med customer_pnr. Bearbetar...\n`);

for (const b of bookings) {
  const pnr = b.customer_pnr as string;
  const id = b.id as string;
  const email = (b.customer_email as string) || "(unknown)";

  if (isEncrypted(pnr)) {
    stats.alreadyAltB++;
    continue;
  }

  if (CLARTEXT_PNR_REGEX.test(pnr)) {
    try {
      const encrypted = await encryptPnr(pnr);
      const { error: upErr } = await sb
        .from("bookings")
        .update({ customer_pnr: encrypted })
        .eq("id", id);
      if (upErr) {
        console.error(`✗ UPDATE failed för ${id} (${email}): ${upErr.message}`);
        stats.errors++;
      } else {
        console.log(`✓ Migrerad: ${id} (${email}) — klartext → AES-GCM:v1`);
        stats.clartextMigrated++;
      }
    } catch (e) {
      console.error(`✗ Encrypt failed för ${id} (${email}): ${(e as Error).message}`);
      stats.errors++;
    }
    continue;
  }

  if (LEGACY_56_REGEX.test(pnr)) {
    console.log(`⚠ Legacy 56-tecken (okänd kryptering) — SKIP: ${id} (${email})`);
    stats.legacy56Skipped++;
    continue;
  }

  if (LEGACY_48_REGEX.test(pnr)) {
    console.log(`⚠ Legacy 48-tecken (hash?) — SKIP: ${id} (${email})`);
    stats.legacy48Skipped++;
    continue;
  }

  console.log(`? Okänt format (${pnr.length} tecken) — SKIP: ${id} (${email})`);
  stats.unknown++;
}

console.log("\n=== Resultat ===");
console.log(JSON.stringify(stats, null, 2));
console.log("\nVerifiera i Studio:");
console.log("  SELECT COUNT(*) FILTER (WHERE customer_pnr LIKE 'AES-GCM:v1:%') AS alt_b,");
console.log("         COUNT(*) FILTER (WHERE customer_pnr ~ '^\\d{12}$') AS still_clartext,");
console.log("         COUNT(*) FILTER (WHERE LENGTH(customer_pnr) = 56) AS legacy_56,");
console.log("         COUNT(*) FILTER (WHERE customer_pnr IS NOT NULL) AS total");
console.log("    FROM bookings;");
