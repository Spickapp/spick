#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * DB-index static audit (Fas 13 §13.2)
 *
 * Scannar alla supabase/migrations/*.sql för CREATE INDEX-statements
 * och scannar alla supabase/functions/**\/*.ts för `.from(<tabell>)`
 * + filter-kolumner (.eq, .lt, .gte, .in, .order, .contains).
 *
 * Genererar rapport: docs/audits/2026-04-24-db-indexes-static.md
 *
 * Rapport-innehåll:
 *  - Alla indexes per tabell (tabell, kolumn, unik, WHERE, källa-migration)
 *  - Alla query-patterns per tabell+kolumn (från EF-kod)
 *  - Gap-analys: queryas kolumner utan index (potentiella full-scans)
 *  - Okända indexes: indexes vars kolumn aldrig queryas (kan vara dead)
 *
 * Kör:
 *   deno run --allow-read --allow-write scripts/audit-db-indexes.ts
 *
 * VARNING: Detta är static analys, inte runtime-EXPLAIN. Faktisk
 * query-plan-verifiering kräver `EXPLAIN ANALYZE` mot prod med
 * representativ data-volym. Scriptet flaggar potentiella gaps.
 */

import { join, fromFileUrl, relative } from "jsr:@std/path@1";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url)).replace(/\/$/, "");

type IndexDef = {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  whereClause: string | null;
  source: string;
};

type QueryPattern = {
  table: string;
  column: string;
  operation: string; // eq, lt, gte, in, order, contains, etc.
  source: string;
  line: number;
};

async function collectFiles(
  root: string,
  exts: string[],
  acc: string[] = [],
): Promise<string[]> {
  try {
    for await (const entry of Deno.readDir(root)) {
      const abs = join(root, entry.name);
      if (entry.isDirectory) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;
        if (entry.name === "_tests") continue;
        await collectFiles(abs, exts, acc);
      } else if (exts.some((e) => entry.name.endsWith(e))) {
        acc.push(abs);
      }
    }
  } catch {}
  return acc;
}

async function parseIndexes(): Promise<IndexDef[]> {
  const migrationsDir = join(REPO_ROOT, "supabase/migrations");
  const files = await collectFiles(migrationsDir, [".sql"]);
  const indexes: IndexDef[] = [];

  // CREATE INDEX-regex: förenklat, slutar vid första ; eller \n efter ) eller WHERE-slut
  const createIdxRe =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-zA-Z0-9_]+)["']?\s+ON\s+(?:"?public"?\.)?["']?([a-zA-Z0-9_]+)["']?\s+(?:USING\s+\w+\s+)?\(([^)]+)\)([^;]*)/gis;

  // PRIMARY KEY-regex: fångar `col UUID PRIMARY KEY`, `"id" uuid PRIMARY KEY` i CREATE TABLE
  const pkInlineRe =
    /["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s+[a-zA-Z_]+(?:\([^)]*\))?\s+(?:NOT\s+NULL\s+)?PRIMARY\s+KEY/gi;
  // CREATE TABLE för att hitta tabell-namn + constraint PRIMARY KEY (col1, col2)
  const createTblRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?["']?([a-zA-Z0-9_]+)["']?\s*\(([\s\S]*?)^\s*\)\s*;/gim;
  const pkConstraintRe =
    /(?:CONSTRAINT\s+["']?[\w_]+["']?\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/gi;

  // UNIQUE constraints på TABLE-level (ger auto-index)
  const uniqueConstraintRe =
    /(?:CONSTRAINT\s+["']?[\w_]+["']?\s+)?UNIQUE\s*\(([^)]+)\)/gi;
  // ALTER TABLE ... ADD PRIMARY KEY (col)
  const alterPkRe =
    /ALTER\s+TABLE\s+(?:"?public"?\.)?["']?([a-zA-Z0-9_]+)["']?[\s\S]{0,200}?ADD\s+(?:CONSTRAINT\s+["']?[\w_]+["']?\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/gi;

  for (const abs of files) {
    let content: string;
    try {
      content = await Deno.readTextFile(abs);
    } catch {
      continue;
    }
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, "/");

    // 1) Explicit CREATE INDEX
    let match: RegExpExecArray | null;
    let guard = 0;
    createIdxRe.lastIndex = 0;
    while ((match = createIdxRe.exec(content)) !== null) {
      if (++guard > 2000) break;
      const [, unique, name, table, cols, tail] = match;
      const columns = cols
        .split(",")
        .map((c) => c.trim().replace(/['"]/g, "").replace(/\s+.*$/, ""));
      const whereMatch = tail.match(/WHERE\s+(.+?)(?=;|$)/is);
      indexes.push({
        name,
        table: table.replace(/['"]/g, ""),
        columns,
        unique: !!unique,
        whereClause: whereMatch?.[1]?.trim() ?? null,
        source: rel,
      });
      if (match.index === createIdxRe.lastIndex) createIdxRe.lastIndex++;
    }

    // 2) CREATE TABLE → hitta PRIMARY KEY (inline + constraint) och UNIQUE
    createTblRe.lastIndex = 0;
    guard = 0;
    while ((match = createTblRe.exec(content)) !== null) {
      if (++guard > 500) break;
      const [, tableName, body] = match;
      const cleanTable = tableName.replace(/['"]/g, "");

      // Inline PRIMARY KEY-kolumner
      pkInlineRe.lastIndex = 0;
      let pkMatch: RegExpExecArray | null;
      while ((pkMatch = pkInlineRe.exec(body)) !== null) {
        const col = pkMatch[1];
        indexes.push({
          name: `${cleanTable}_pkey`,
          table: cleanTable,
          columns: [col],
          unique: true,
          whereClause: null,
          source: rel + " (PK inline)",
        });
      }

      // CONSTRAINT PRIMARY KEY (col1, col2)
      pkConstraintRe.lastIndex = 0;
      while ((pkMatch = pkConstraintRe.exec(body)) !== null) {
        const cols = pkMatch[1].split(",").map((c) => c.trim().replace(/['"]/g, ""));
        indexes.push({
          name: `${cleanTable}_pkey`,
          table: cleanTable,
          columns: cols,
          unique: true,
          whereClause: null,
          source: rel + " (PK constraint)",
        });
      }

      // UNIQUE constraints
      uniqueConstraintRe.lastIndex = 0;
      let uniqCount = 0;
      while ((pkMatch = uniqueConstraintRe.exec(body)) !== null) {
        const cols = pkMatch[1].split(",").map((c) => c.trim().replace(/['"]/g, ""));
        indexes.push({
          name: `${cleanTable}_unique_${uniqCount++}`,
          table: cleanTable,
          columns: cols,
          unique: true,
          whereClause: null,
          source: rel + " (UNIQUE)",
        });
      }
      if (match.index === createTblRe.lastIndex) createTblRe.lastIndex++;
    }

    // 3) ALTER TABLE ... ADD PRIMARY KEY
    alterPkRe.lastIndex = 0;
    guard = 0;
    while ((match = alterPkRe.exec(content)) !== null) {
      if (++guard > 500) break;
      const [, table, cols] = match;
      const cleanTable = table.replace(/['"]/g, "");
      const columns = cols.split(",").map((c) => c.trim().replace(/['"]/g, ""));
      indexes.push({
        name: `${cleanTable}_pkey`,
        table: cleanTable,
        columns,
        unique: true,
        whereClause: null,
        source: rel + " (ALTER PK)",
      });
      if (match.index === alterPkRe.lastIndex) alterPkRe.lastIndex++;
    }
  }

  // Deduplikera PKs — ta bort duplikat-entries för samma table+columns
  const seen = new Set<string>();
  return indexes.filter((idx) => {
    const key = `${idx.table}|${idx.columns.join(",")}|${idx.unique}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function parseQueries(): Promise<QueryPattern[]> {
  const efDir = join(REPO_ROOT, "supabase/functions");
  const jsDir = join(REPO_ROOT, "js");
  const files = [
    ...(await collectFiles(efDir, [".ts"])),
    ...(await collectFiles(jsDir, [".js"])),
  ];

  const patterns: QueryPattern[] = [];

  // Match: .from('<table>' or "<table>")
  // Then: subsequent .eq/.lt/.gte/.gt/.lte/.in/.order/.contains/.neq/.is/.match('<col>'
  const fromRe = /\.from\(\s*['"]([a-z_]+)['"]/g;
  const filterRe =
    /\.(eq|lt|gte|gt|lte|in|order|contains|neq|is|match|range|filter)\(\s*['"]([a-z_][\w]*)['"]/g;

  for (const abs of files) {
    let content: string;
    try {
      content = await Deno.readTextFile(abs);
    } catch {
      continue;
    }
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, "/");
    const lines = content.split(/\r?\n/);

    // Linjärt: hitta .from() och kolla följande ~50 rader för .filter()
    // (supabase-js chainar: .from().select().eq().order() vanligen på samma ~5 rader)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      fromRe.lastIndex = 0;
      let fromMatch: RegExpExecArray | null;
      while ((fromMatch = fromRe.exec(line)) !== null) {
        const table = fromMatch[1];
        // Leta fram till nästa .from() eller max 10 rader senare för filter-patterns
        const endIdx = Math.min(i + 10, lines.length);
        const chunk = lines.slice(i, endIdx).join("\n");
        filterRe.lastIndex = 0;
        let filterMatch: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((filterMatch = filterRe.exec(chunk)) !== null) {
          const [, op, col] = filterMatch;
          const key = `${op}:${col}`;
          if (seen.has(key)) continue;
          seen.add(key);
          patterns.push({
            table,
            column: col,
            operation: op,
            source: rel,
            line: i + 1,
          });
        }
        if (fromMatch.index === fromRe.lastIndex) fromRe.lastIndex++;
      }
    }
  }
  return patterns;
}

function formatReport(
  indexes: IndexDef[],
  patterns: QueryPattern[],
): string {
  const today = new Date().toISOString().slice(0, 10);

  // Grupp indexes per tabell
  const indexesByTable = new Map<string, IndexDef[]>();
  for (const idx of indexes) {
    const arr = indexesByTable.get(idx.table) ?? [];
    arr.push(idx);
    indexesByTable.set(idx.table, arr);
  }

  // Grupp queries per tabell+kolumn
  const queriesByTableCol = new Map<string, QueryPattern[]>();
  const queriesByTable = new Map<string, Set<string>>();
  for (const p of patterns) {
    const key = `${p.table}.${p.column}`;
    const arr = queriesByTableCol.get(key) ?? [];
    arr.push(p);
    queriesByTableCol.set(key, arr);
    const cols = queriesByTable.get(p.table) ?? new Set();
    cols.add(p.column);
    queriesByTable.set(p.table, cols);
  }

  // Gap-analys: queryas kolumner utan index
  // Heuristik: skippa kolumner "id" — Postgres skapar automatiskt PK-index
  // även om PK-definitionen ligger utanför migrations/ (t.ex. legacy Supabase-native).
  const PRIMARY_KEY_LIKE = new Set(["id", "uuid", "pk"]);
  const gaps: { table: string; column: string; hits: QueryPattern[] }[] = [];
  for (const [key, hits] of queriesByTableCol) {
    const [table, column] = key.split(".");
    if (PRIMARY_KEY_LIKE.has(column)) continue;
    const tblIdxs = indexesByTable.get(table) ?? [];
    // Btree-prefix-regel: en composite-index (A, B, C) täcker queries på A, (A, B), (A, B, C)
    // men INTE B ensam. Vi markerar "täckt" om kolumnen är FÖRSTA i något index.
    const covered = tblIdxs.some((idx) => idx.columns[0] === column);
    if (!covered && hits.length > 0) {
      gaps.push({ table, column, hits });
    }
  }
  gaps.sort((a, b) => b.hits.length - a.hits.length);

  // Okända indexes: indexes på kolumner som aldrig queryas i EF-kod
  const unusedIdxCandidates: IndexDef[] = [];
  for (const idx of indexes) {
    const queriedCols = queriesByTable.get(idx.table) ?? new Set();
    // Om inga av indexets kolumner queryas i någon EF/JS-fil
    const anyQueried = idx.columns.some((c) => queriedCols.has(c));
    if (!anyQueried) unusedIdxCandidates.push(idx);
  }

  const tables = [
    ...new Set([...indexesByTable.keys(), ...queriesByTable.keys()]),
  ].sort();

  const lines: string[] = [
    `# DB-index static audit (Fas 13 §13.2)`,
    ``,
    `**Genererad:** ${today} via \`deno run scripts/audit-db-indexes.ts\``,
    `**Källor:** \`supabase/migrations/*.sql\` (indexes) + \`supabase/functions/**/*.ts\` + \`js/*.js\` (query-patterns)`,
    ``,
    `## Sammanfattning`,
    ``,
    `- Totalt **${indexes.length}** CREATE INDEX i migrations`,
    `- Totalt **${patterns.length}** distinct-query-patterns (tabell+kolumn+operation) i kod`,
    `- **${tables.length}** tabeller involverade`,
    `- **${gaps.length}** potentiella gap (queryas utan index)`,
    `- **${unusedIdxCandidates.length}** potentiellt oanvända indexes (kolumn queryas aldrig i kod)`,
    ``,
    `## Begränsningar`,
    ``,
    `- Static analys, inte runtime-EXPLAIN. Faktisk performance beror på data-volym, distribution och Postgres-planner-beslut.`,
    `- Query-parser fångar \`.eq/.lt/.gte/.in/.order/...\` men missar råa SQL-strängar (\`sb.rpc(...)\`, raw SQL).`,
    `- Index-täckning räknas när en kolumn matchar första eller senare kolumn i composite-index. Btree-prefix-regler inte simulerade.`,
    `- RPC-funktioner och VIEWs inte inkluderade i denna audit.`,
    ``,
    `## Gap-analys (högst prioritet)`,
    ``,
    `Queryas-kolumner utan synligt index, sorterat efter antal query-ställen:`,
    ``,
    gaps.length === 0
      ? `Inga gap upptäckta.`
      : `| Tabell | Kolumn | Query-ställen | Exempel | Rekommendation |\n|---|---|---|---|---|`,
  ];

  for (const g of gaps.slice(0, 50)) {
    const example = `\`${g.hits[0].source}:${g.hits[0].line}\``;
    const ops = [...new Set(g.hits.map((h) => h.operation))].join(", ");
    lines.push(
      `| ${g.table} | ${g.column} | ${g.hits.length} (${ops}) | ${example} | Överväg CREATE INDEX om query är hot-path |`,
    );
  }

  if (gaps.length > 50) {
    lines.push(``, `_(${gaps.length - 50} fler gaps ej visade — se kör-output)_`);
  }

  lines.push(``, `## Alla indexes per tabell`, ``);

  for (const table of tables) {
    const tblIdxs = indexesByTable.get(table) ?? [];
    const tblCols = queriesByTable.get(table) ?? new Set();
    if (tblIdxs.length === 0 && tblCols.size === 0) continue;
    lines.push(
      `### ${table}  (${tblIdxs.length} indexes, ${tblCols.size} query-kolumner)`,
      ``,
    );
    if (tblIdxs.length === 0) {
      lines.push(`_(Inga indexes definierade i migrations)_`, ``);
    } else {
      lines.push(`| Index | Kolumner | Unik | WHERE | Källa |`);
      lines.push(`|---|---|---|---|---|`);
      for (const idx of tblIdxs) {
        const cols = idx.columns.join(", ");
        const where = idx.whereClause ? `\`${idx.whereClause}\`` : "—";
        lines.push(
          `| ${idx.name} | ${cols} | ${idx.unique ? "✓" : ""} | ${where} | ${idx.source.split("/").pop()} |`,
        );
      }
      lines.push(``);
    }
  }

  if (unusedIdxCandidates.length > 0) {
    lines.push(
      ``,
      `## Potentiellt oanvända indexes (review)`,
      ``,
      `Dessa indexes har kolumner som aldrig queryas explicit i EF-kod. Kan vara:`,
      ``,
      `- **Legitima:** används av RPC-funktioner, VIEWs, raw SQL eller Postgres-planner för joins/sorts.`,
      `- **Dead:** lämnad efter refaktor. Ta bort om confirmed via \`pg_stat_user_indexes.idx_scan = 0\` över 30 dagar.`,
      ``,
      `| Index | Tabell | Kolumner | Källa |`,
      `|---|---|---|---|`,
    );
    for (const idx of unusedIdxCandidates.slice(0, 40)) {
      lines.push(
        `| ${idx.name} | ${idx.table} | ${idx.columns.join(", ")} | ${idx.source.split("/").pop()} |`,
      );
    }
    if (unusedIdxCandidates.length > 40) {
      lines.push(
        ``,
        `_(${unusedIdxCandidates.length - 40} fler ej visade)_`,
      );
    }
  }

  lines.push(
    ``,
    `## Nästa steg`,
    ``,
    `1. Kör \`EXPLAIN ANALYZE\` mot prod för top-10 gap-queries i tabellen ovan.`,
    `2. Beroende på data-volym: lägg till CREATE INDEX via migration om Seq Scan dominerar.`,
    `3. För unused-kandidaterna: kör \`SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname = '...';\` och verifiera över 30 dgr.`,
    `4. Uppdatera \`docs/ga-readiness-checklist.md\` §13.2-status när audit är faktisk EXPLAIN-baserad.`,
    ``,
    `---`,
    ``,
    `_Regenerera denna rapport: \`deno run --allow-read --allow-write scripts/audit-db-indexes.ts\`_`,
    ``,
  );

  return lines.join("\n");
}

async function main() {
  console.log("Scanner migrations för CREATE INDEX...");
  const indexes = await parseIndexes();
  console.log(`  Hittade ${indexes.length} indexes`);

  console.log("Scanner EF/JS för query-patterns...");
  const patterns = await parseQueries();
  console.log(`  Hittade ${patterns.length} query-patterns`);

  const report = formatReport(indexes, patterns);
  const out = join(REPO_ROOT, "docs/audits/2026-04-24-db-indexes-static.md");

  try {
    await Deno.mkdir(join(REPO_ROOT, "docs/audits"), { recursive: true });
  } catch {}
  await Deno.writeTextFile(out, report);
  console.log(`\n✓ Rapport skriven till: docs/audits/2026-04-24-db-indexes-static.md`);
  console.log(`  (${report.split("\n").length} rader)`);
}

if (import.meta.main) main();
