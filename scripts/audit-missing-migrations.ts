#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net

/**
 * H19-audit: Missing Migrations i prod (Fas 13 §13.2.b)
 *
 * Syfte: Hitta migrations-filer i repo som INTE är körda i prod-DB.
 *
 * Rule #31: Migration-fil i repo ≠ körd i prod. Classic schema-drift.
 * Upptäckt 2026-04-24 via A04-fel (bookings.rut saknas i prod trots
 * migration 20260325000001 lägger till kolumnen).
 *
 * Input:
 *  - supabase/migrations/*.sql (alla migrations-filer i repo)
 *  - Prod: supabase_migrations.schema_migrations (körda versions)
 *
 * Output:
 *  - docs/audits/2026-04-24-missing-migrations.md med diff-lista
 *
 * Kräver: SUPABASE_SERVICE_ROLE_KEY env var för att läsa
 * supabase_migrations-schemat.
 *
 * Alternativ manuell-körning (om service_key saknas):
 *   Kör denna SQL i Studio:
 *     SELECT version FROM supabase_migrations.schema_migrations
 *     ORDER BY version;
 *   Kopiera resultat. Denna rapport kan generera listan utan DB-access
 *   om du skickar tillbaka.
 */

import { join, fromFileUrl, relative } from "jsr:@std/path@1";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url)).replace(/\/$/, "");
const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function listRepoMigrations(): Promise<
  Array<{ version: string; filename: string; path: string }>
> {
  const dir = join(REPO_ROOT, "supabase/migrations");
  const out: Array<{ version: string; filename: string; path: string }> = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    // Supabase-konvention: <timestamp>_<name>.sql — eller <3siffrigt>_<name>.sql för legacy
    const match = entry.name.match(/^(\d+)_/);
    if (!match) continue;
    out.push({
      version: match[1],
      filename: entry.name,
      path: `supabase/migrations/${entry.name}`,
    });
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

async function listProdMigrations(): Promise<Set<string>> {
  if (!SERVICE_KEY) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY saknas. Kör i Studio istället:",
    );
    console.error(
      "  SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;",
    );
    Deno.exit(2);
  }
  const res = await fetch(
    `${SUPA_URL}/rest/v1/rpc/exec_sql`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query:
          "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
      }),
    },
  );
  if (!res.ok) {
    console.error(
      `Kunde ej läsa prod-migrations (${res.status}). Fallback till Studio-query.`,
    );
    Deno.exit(3);
  }
  const rows = (await res.json()) as Array<{ version: string }>;
  return new Set(rows.map((r) => r.version));
}

async function main() {
  const args = Deno.args;
  const prodVersionsArg = args.indexOf("--prod-versions");
  let prodVersions: Set<string>;

  if (prodVersionsArg >= 0 && args[prodVersionsArg + 1]) {
    // Manuell input: --prod-versions "20260101,20260102,..."
    const list = args[prodVersionsArg + 1].split(",").map((v) => v.trim());
    prodVersions = new Set(list);
    console.log(`Prod-versions från CLI: ${prodVersions.size} entries`);
  } else {
    console.log("Hämtar prod-migrations via Supabase API...");
    prodVersions = await listProdMigrations();
    console.log(`Prod-versions: ${prodVersions.size} entries`);
  }

  const repoMigrations = await listRepoMigrations();
  console.log(`Repo-migrations: ${repoMigrations.length} filer`);

  const missing = repoMigrations.filter((m) => !prodVersions.has(m.version));
  const orphaned = [...prodVersions].filter(
    (v) => !repoMigrations.some((m) => m.version === v),
  );

  console.log("");
  console.log(`Missing i prod (repo har, prod saknar): ${missing.length}`);
  for (const m of missing) {
    console.log(`  ✗ ${m.filename}`);
  }
  console.log("");
  console.log(`Orphaned i prod (prod har, repo saknar): ${orphaned.length}`);
  for (const v of orphaned) {
    console.log(`  ? ${v}`);
  }

  // Generera rapport
  const today = new Date().toISOString().slice(0, 10);
  const report = [
    `# Missing Migrations Audit (H19)`,
    ``,
    `**Genererad:** ${today}`,
    `**Källa:** \`scripts/audit-missing-migrations.ts\``,
    `**Primärkälla (rule #31):** \`supabase_migrations.schema_migrations\` i prod`,
    ``,
    `## Sammanfattning`,
    ``,
    `- **Repo-migrations:** ${repoMigrations.length} filer`,
    `- **Prod-versions:** ${prodVersions.size} körda`,
    `- **Missing (GAP!):** ${missing.length}`,
    `- **Orphaned:** ${orphaned.length}`,
    ``,
    `## Missing i prod (KRÄVER åtgärd)`,
    ``,
    missing.length === 0
      ? `Inga missing migrations. ✓`
      : `Dessa migrations-filer finns i repo men är **EJ körda** i prod. EF-kod som förutsätter dem kan fail:a (t.ex. A04 bookings.rut som triggade denna audit).`,
    ``,
  ];

  if (missing.length > 0) {
    report.push(`| Version | Fil | Åtgärd |`);
    report.push(`|---|---|---|`);
    for (const m of missing) {
      report.push(`| ${m.version} | \`${m.path}\` | Kör i Studio eller via supabase CLI |`);
    }
    report.push(``);
    report.push(`### Rekommenderad åtgärd`);
    report.push(``);
    report.push(`**Option A (säkert):** En migration åt gången via Studio SQL Editor.`);
    report.push(`1. Öppna migration-fil, granska innehåll.`);
    report.push(`2. Copy-paste SQL i Studio, kör.`);
    report.push(`3. Insert i schema_migrations-tabellen:`);
    report.push(`   \`INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('<version>');\``);
    report.push(``);
    report.push(`**Option B (snabbt):** Supabase CLI push av alla pending.`);
    report.push(`   \`supabase db push --linked\``);
    report.push(`   Kräver Farhads CLI + auth.`);
  }

  if (orphaned.length > 0) {
    report.push(``);
    report.push(`## Orphaned i prod (informativt)`);
    report.push(``);
    report.push(`Dessa versions körs i prod men saknar fil i repo:`);
    report.push(``);
    for (const v of orphaned) {
      report.push(`- \`${v}\``);
    }
    report.push(``);
    report.push(`Troligen: manuella Studio-ändringar eller migration-filer flyttade till archive. Verifiera.`);
  }

  const outPath = join(REPO_ROOT, `docs/audits/${today}-missing-migrations.md`);
  await Deno.mkdir(join(REPO_ROOT, "docs/audits"), { recursive: true }).catch(() => {});
  await Deno.writeTextFile(outPath, report.join("\n") + "\n");
  console.log(`\nRapport skriven: ${relative(REPO_ROOT, outPath).replace(/\\/g, "/")}`);

  if (missing.length > 0) Deno.exit(1);
}

if (import.meta.main) main();
