#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Lint: hardcoded business values (Fas 12 §12.5)
 *
 * Fångar:
 *  - hardcoded commission (0.17, 17%, commission=literal)
 *  - hardcoded hourly_rate utanför allow-list
 *  - hardcoded RUT_SERVICES-array (rule #30 + #28)
 *  - UPDATE/DELETE/ALL USING(true) i nya migrationer
 *
 * Ratchet-pattern: existerande träffar allow-listas i
 * scripts/.lint-allow.json med TODO-motivering. CI fail:ar
 * bara för NYA hardcoded-värden.
 *
 * Använd:
 *   deno run --allow-read --allow-write scripts/lint-hardcoded-values.ts
 *   deno run --allow-read --allow-write scripts/lint-hardcoded-values.ts --regenerate-allow
 *
 * Regenerate-allow-flaggan uppdaterar allow-listan från nuvarande
 * träffar (används en gång vid initial setup, sen manuellt underhåll).
 */

import { relative, fromFileUrl, join } from "jsr:@std/path@1";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url)).replace(/\/$/, "");

type Rule = {
  id: string;
  description: string;
  pattern: RegExp;
  fileGlobs: string[];
  skipIfLineContains?: RegExp;
  fixSuggestion: string;
  severity: "error" | "warning";
  defaultReason: string;
};

const RULES: Rule[] = [
  {
    id: "commission_017_hardcoded",
    description: "Hårdkodad provision 0.17 (gammalt 17%-värde)",
    pattern: /\b0\.17\b/,
    fileGlobs: [".html", ".js", ".ts"],
    skipIfLineContains:
      /\/\/|<!--|\*\s|console\.|TODO|FIXME|primärkälla|legacy|removed|throw new/i,
    fixSuggestion:
      "Läs från platform_settings.commission_standard via _shared/money.ts eller js/commission-helpers.js (rule #28 SSOT).",
    severity: "error",
    defaultReason:
      "Drift från Fas 1-avskaffande (trappsystem -> 12% flat 2026-04-17). Rensas via provision-centralisering-sprint.",
  },
  {
    id: "commission_17pct_hardcoded",
    description: "Hårdkodad '17%' i kod (gammalt provisions-värde)",
    pattern: /\b17\s*%/,
    fileGlobs: [".html", ".js", ".ts"],
    skipIfLineContains:
      /\/\/|<!--|\*\s|console\.|TODO|FIXME|primärkälla|legacy|removed/i,
    fixSuggestion:
      "Läs från platform_settings.commission_standard via helpers. Ingen hardcoded provisionssats får finnas i kod.",
    severity: "error",
    defaultReason:
      "Drift-HTML från Fas 1-avskaffande (trappsystem -> 12% flat 2026-04-17). Dokumenterad i docs/sanning/provision.md under 'Drift (känd men inte pilot-blockerande)'. Rensas i fortsättning av provision-centralisering-sprint.",
  },
  {
    id: "hourly_rate_hardcoded",
    description: "Hårdkodat timpris (299/300/349/350/399/400/450/500)",
    pattern:
      /(hourly_rate|hourlyRate|basePrice|base_price)\s*[:=]\s*(299|300|349|350|399|400|450|500)\b/,
    fileGlobs: [".html", ".js", ".ts"],
    skipIfLineContains: /\/\/|<!--|\*\s|placeholder|example|sample/i,
    fixSuggestion:
      "Läs cleaner.hourly_rate från DB eller platform_settings. Defaults tillåtna i allow-list med motivering.",
    severity: "error",
    defaultReason:
      "Hardcoded default. Verifiera att värdet läses från DB i runtime och endast är initial seed/fallback.",
  },
  {
    id: "rut_services_hardcoded",
    description:
      "Hårdkodad RUT-tjänstelista (rule #30 Skatteverket-regler + rule #28 SSOT)",
    pattern: /\[\s*['"]Hemstädning['"],\s*['"]Storstädning['"]/,
    fileGlobs: [".html", ".js", ".ts"],
    fixSuggestion:
      "Läs RUT-tjänster från platform_settings.rut_services_list eller services-tabellen (WHERE is_rut_eligible=true). Skatteverkets regler får inte fragmenteras i frontend-arrayer.",
    severity: "error",
    defaultReason:
      "Hardcoded RUT-lista (rule #30 Skatteverket + rule #28 SSOT-brott). Ska flyttas till platform_settings/services-tabell. Flaggat för framtida sprint (Fas 4 Services HTML-migration eller tidigare punktfix).",
  },
  {
    id: "rls_unsafe_update_delete",
    description:
      "RLS-policy med USING(true) för UPDATE/DELETE/ALL — tillåter öppet skriv",
    pattern:
      /CREATE\s+POLICY[^\n]*\s+FOR\s+(UPDATE|DELETE|ALL)[\s\S]{1,500}?USING\s*\(\s*true\s*\)/i,
    fileGlobs: [".sql"],
    fixSuggestion:
      "Begränsa till service_role (TO service_role) eller auth.uid()-match. USING(true) för UPDATE/DELETE/ALL = öppet hål.",
    severity: "error",
    defaultReason:
      "Review-krävd: granska om policyn skyddar PII-data. Om inte, begränsa till service_role eller auth.uid()-match.",
  },
  // ── BUSINESS-CONTENT-CLAIMS (Audit-fix 2026-04-27 Farhad-fynd) ──
  // Fångar felaktiga business-claims i copy som inte stämmer mot
  // CLAUDE.md / docs/sanning/. Trigger: foretag.html "30 dagars
  // betalvillkor" som var falskt påstående.
  {
    id: "business_payment_terms",
    description:
      "Hardcoded betalvillkor (X dagars betalvillkor) — måste matcha bolagets faktiska betalningspolicy",
    pattern: /\b\d{1,3}\s*-?\s*dagars?\s+betalvillkor\b/i,
    fileGlobs: [".html"],
    skipIfLineContains: /\/\/|<!--|TODO|FIXME|primärkälla/i,
    fixSuggestion:
      "Spick använder Stripe + Klarna (CLAUDE.md). Inga 30/60/90-dagars-faktura-villkor som default. Ta bort claim eller använd 'Faktura via Klarna eller företagskort'.",
    severity: "error",
    defaultReason:
      "Verifiera mot CLAUDE.md tech-stack och docs/sanning/. Om bolaget INTE erbjuder X-dagars-villkor → ta bort. Om det är custom B2B-kontrakt → flytta till sanning/-fil och allow-lista här.",
  },
  {
    id: "business_guarantee_claim",
    description:
      "Hardcoded garanti-claim (X dagars garanti, X% nöjd-garanti) — måste matcha sanning",
    pattern: /\b(\d{1,3})\s*-?\s*(dagars?|%)\s+(garanti|n[öo]jd[-\s]?garanti)\b/i,
    fileGlobs: [".html"],
    skipIfLineContains: /\/\/|<!--|TODO|FIXME|primärkälla/i,
    fixSuggestion:
      "Verifiera mot docs/sanning/garanti.md (om finns) eller CLAUDE.md. Garanti-claims är legal-bindande.",
    severity: "error",
    defaultReason:
      "Garanti-claim måste verifieras mot bolagets faktiska policy + jurist-godkännande. Allow-lista bara om Farhad bekräftat.",
  },
  {
    id: "business_superlative_claim",
    description:
      "Superlativ-claim ('Sveriges största/bästa/ledande', 'alltid', 'aldrig')",
    pattern: /\b(Sveriges|världens)\s+(största|bästa|ledande|främsta|nyaste)\b|\b(alltid svensk|aldrig sena|100%\s*nöjd)/i,
    fileGlobs: [".html"],
    skipIfLineContains: /\/\/|<!--|TODO|FIXME|primärkälla|test|exempel|review/i,
    fixSuggestion:
      "Superlativ ('Sveriges största') kan vara osanna marknadsföringsclaim. Använd faktiska siffror eller 'En av Sveriges...'.",
    severity: "warning",
    defaultReason:
      "Superlativ kräver verifiering. Allow-lista bara om bolaget HAR data som stödjer påståendet (t.ex. branschstatistik).",
  },
];

// Explicit target-paths för att undvika OOM-problem vid walk()
// över hela repot. Målet är endast applikations-kod + nya migrations.
const TARGET_DIRS: { dir: string; recursive: boolean; exts: string[] }[] = [
  { dir: ".", recursive: false, exts: [".html"] },
  { dir: "js", recursive: true, exts: [".js"] },
  { dir: "supabase/functions", recursive: true, exts: [".ts"] },
  { dir: "supabase/migrations", recursive: false, exts: [".sql"] },
];

const SKIP_SUBPATHS = [
  /_tests/,
  /node_modules/,
  /\.git[\\/]/,
];

const SKIP_FILE_PATTERNS = [
  /prod-schema.*\.sql$/,
  /\.lint-allow\.json$/,
  /lint-hardcoded-values\.ts$/,
];

// Legacy-migrations (innan 2026-04) hanteras separat via
// targeted sanering, inte bulk-lint.
const LEGACY_MIGRATION_CUTOFF = "20260400000000";

type Finding = {
  file: string;
  line: number;
  rule: string;
  severity: "error" | "warning";
  lineContent: string;
  fixSuggestion: string;
};

type AllowEntry = {
  file: string;
  line: number;
  rule: string;
  reason: string;
  added: string;
};

function shouldSkipPath(relPath: string): boolean {
  for (const pattern of SKIP_SUBPATHS) {
    if (pattern.test(relPath)) return true;
  }
  for (const pattern of SKIP_FILE_PATTERNS) {
    if (pattern.test(relPath)) return true;
  }
  if (relPath.startsWith("supabase/migrations/")) {
    const filename = relPath.split("/").pop() ?? "";
    const match = filename.match(/^(\d{14,})/);
    if (match && match[1] < LEGACY_MIGRATION_CUTOFF) return true;
    if (/^\d{3}_/.test(filename)) return true;
  }
  return false;
}

function matchesFileGlob(path: string, globs: string[]): boolean {
  return globs.some((g) => path.endsWith(g));
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const target of TARGET_DIRS) {
    const absDir = join(REPO_ROOT, target.dir);
    try {
      await collectFromDir(absDir, target.recursive, target.exts, files);
    } catch (err) {
      console.error(`  skip ${target.dir}: ${(err as Error).message}`);
    }
  }
  return files;
}

async function collectFromDir(
  absDir: string,
  recursive: boolean,
  exts: string[],
  acc: string[],
): Promise<void> {
  for await (const entry of Deno.readDir(absDir)) {
    const abs = join(absDir, entry.name);
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, "/");
    if (shouldSkipPath(rel)) continue;
    if (entry.isDirectory) {
      if (recursive) await collectFromDir(abs, recursive, exts, acc);
      continue;
    }
    if (!entry.isFile) continue;
    if (!exts.some((e) => abs.endsWith(e))) continue;
    acc.push(abs);
  }
}

async function loadAllowList(): Promise<AllowEntry[]> {
  const allowPath = `${REPO_ROOT}/scripts/.lint-allow.json`;
  try {
    const content = await Deno.readTextFile(allowPath);
    return JSON.parse(content) as AllowEntry[];
  } catch {
    return [];
  }
}

function isAllowed(finding: Finding, allowList: AllowEntry[]): boolean {
  return allowList.some(
    (a) =>
      a.file === finding.file &&
      a.line === finding.line &&
      a.rule === finding.rule,
  );
}

async function lintFile(
  path: string,
  relPath: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    return findings;
  }

  const lines = content.split(/\r?\n/);

  for (const rule of RULES) {
    if (!matchesFileGlob(path, rule.fileGlobs)) continue;

    // SQL-regeln är multi-line (CREATE POLICY ... kan spänna flera rader)
    if (rule.id === "rls_unsafe_update_delete") {
      const flags = rule.pattern.flags.includes("g")
        ? rule.pattern.flags
        : rule.pattern.flags + "g";
      const re = new RegExp(rule.pattern.source, flags);
      let match: RegExpExecArray | null;
      let guard = 0;
      while ((match = re.exec(content)) !== null) {
        if (++guard > 1000) break;
        const matchedText = match[0];
        // Skip om policyn är begränsad till service_role — backend-only = OK
        if (/TO\s+"?service_role"?/i.test(matchedText)) {
          if (match.index === re.lastIndex) re.lastIndex++;
          continue;
        }
        const offset = match.index;
        const lineNum = content.slice(0, offset).split(/\r?\n/).length;
        findings.push({
          file: relPath,
          line: lineNum,
          rule: rule.id,
          severity: rule.severity,
          lineContent: lines[lineNum - 1]?.trim().slice(0, 120) ?? "",
          fixSuggestion: rule.fixSuggestion,
        });
        if (match.index === re.lastIndex) re.lastIndex++;
      }
      continue;
    }

    // Line-by-line för resten
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip mycket långa rader (minifierad kod, base64-data) — undvik regex-backtracking
      if (line.length > 2000) continue;
      if (rule.skipIfLineContains && rule.skipIfLineContains.test(line)) continue;
      if (rule.pattern.test(line)) {
        findings.push({
          file: relPath,
          line: i + 1,
          rule: rule.id,
          severity: rule.severity,
          lineContent: line.trim().slice(0, 120),
          fixSuggestion: rule.fixSuggestion,
        });
      }
    }
  }

  return findings;
}

async function main() {
  const args = Deno.args;
  const regenerateAllow = args.includes("--regenerate-allow");

  const allFindings: Finding[] = [];
  const files = await collectFiles();
  console.log(`Scanning ${files.length} files...`);

  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, "/");
    const findings = await lintFile(abs, rel);
    allFindings.push(...findings);
  }

  if (regenerateAllow) {
    const today = new Date().toISOString().slice(0, 10);
    const ruleReasonMap = new Map(RULES.map((r) => [r.id, r.defaultReason]));
    const allowList: AllowEntry[] = allFindings.map((f) => ({
      file: f.file,
      line: f.line,
      rule: f.rule,
      reason: ruleReasonMap.get(f.rule) ?? "TODO: fyll i motivering",
      added: today,
    }));
    const allowPath = `${REPO_ROOT}/scripts/.lint-allow.json`;
    await Deno.writeTextFile(
      allowPath,
      JSON.stringify(allowList, null, 2) + "\n",
    );
    console.log(
      `✓ Regenererat allow-list: ${allowList.length} entries → scripts/.lint-allow.json`,
    );
    console.log("  Fyll i 'reason'-fältet för varje entry innan commit.");
    return;
  }

  const allowList = await loadAllowList();

  const newFindings = allFindings.filter((f) => !isAllowed(f, allowList));
  const allowedFindings = allFindings.filter((f) => isAllowed(f, allowList));

  console.log(
    `Lint: ${allFindings.length} total findings, ${allowedFindings.length} allow-listade, ${newFindings.length} nya`,
  );
  console.log("");

  if (newFindings.length === 0) {
    console.log("✓ Inga nya hardcoded värden.");
    // Flagga orphan allow-list-rader (rader som inte längre träffar)
    const orphans = allowList.filter(
      (a) =>
        !allFindings.some(
          (f) => f.file === a.file && f.line === a.line && f.rule === a.rule,
        ),
    );
    if (orphans.length > 0) {
      console.log(
        `\n⚠ ${orphans.length} allow-list-rader matchar inget längre (fixad eller flyttad kod):`,
      );
      for (const o of orphans) {
        console.log(`  - ${o.file}:${o.line} (${o.rule})`);
      }
      console.log(
        "\nRensa dessa från scripts/.lint-allow.json för att hålla listan ren.",
      );
    }
    Deno.exit(0);
  }

  console.log(`✗ ${newFindings.length} nya hardcoded värden upptäckta:\n`);
  const byRule = new Map<string, Finding[]>();
  for (const f of newFindings) {
    const arr = byRule.get(f.rule) ?? [];
    arr.push(f);
    byRule.set(f.rule, arr);
  }

  for (const [ruleId, findings] of byRule) {
    const rule = RULES.find((r) => r.id === ruleId);
    console.log(`┌─ ${ruleId} (${findings.length} träffar)`);
    console.log(`│  ${rule?.description ?? ""}`);
    console.log(`│  Fix: ${rule?.fixSuggestion ?? ""}`);
    for (const f of findings) {
      console.log(`│  • ${f.file}:${f.line}`);
      console.log(`│    ${f.lineContent}`);
    }
    console.log("└");
    console.log("");
  }

  console.log(
    "Om detta är befogat (t.ex. legitim default), lägg i scripts/.lint-allow.json med motivering.",
  );
  console.log(
    "Annars: fixa via platform_settings / _shared/-helper / DB-lookup.",
  );
  Deno.exit(1);
}

if (import.meta.main) {
  main();
}
