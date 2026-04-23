// scripts/generate-claude-md.ts
// ──────────────────────────────────────────────────────────────────
// Fas 11.1 — Auto-generate codebase snapshot för CLAUDE.md.
//
// Fixar Regel #29-drift: CLAUDE.md säger "14 Edge Functions" men
// supabase/functions/ har 66 stycken. Varje Claude-session startar
// därmed med felaktig kontext. Denna script scannar filsystem och
// emitterar färska markdown-fragment.
//
// KÖRSÄTT:
//   deno run --allow-read scripts/generate-claude-md.ts
//   # → stdout innehåller markdown som kan copy-pasteas in i
//   #    CLAUDE.md (manuellt, efter review).
//
// OMFATTNING (denna version):
//   - Edge Functions (antal + per-EF första JSDoc-kommentar)
//   - GitHub Actions workflows (antal + lista)
//   - Migrations (antal + senaste timestamp)
//   - Shared helpers i _shared/ (för kontextkänning)
//
// EJ OMFATTAT (framtida versioner):
//   - DB-objekt (CREATE VIEW, CREATE TABLE) — kräver pg_dump access
//   - Runtime-EF-status (deploy:ad vs repo-only) — kräver supabase CLI
//
// Regler: #27 (scope endast filesystem scan, ingen DB-query),
// #31 (läser primary source = filerna, inte antaganden),
// #28 (ingen config-duplikat; canonical paths hårdkodade här OK
// eftersom de är Spick-repo-specifika konstanter).
// ──────────────────────────────────────────────────────────────────

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { dirname, join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));

// Windows path fix (removes leading slash)
const ROOT = Deno.build.os === "windows" && REPO_ROOT.startsWith("/")
  ? REPO_ROOT.slice(1)
  : REPO_ROOT;

const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

// ── Helpers ──────────────────────────────────────────────────────

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(path: string, exclude: string[] = []): Promise<string[]> {
  const result: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (entry.isDirectory && !exclude.includes(entry.name)) {
      result.push(entry.name);
    }
  }
  return result.sort();
}

async function listFiles(
  path: string,
  filter?: (name: string) => boolean,
): Promise<string[]> {
  const result: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (entry.isFile && (!filter || filter(entry.name))) {
      result.push(entry.name);
    }
  }
  return result.sort();
}

async function firstComment(filePath: string): Promise<string> {
  try {
    const content = await Deno.readTextFile(filePath);
    const lines = content.split("\n").slice(0, 50);
    const commentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (commentLines.length === 0) {
        if (line.startsWith("/*") || line.startsWith("//")) {
          const cleaned = line
            .replace(/^\/\*\*?/, "")
            .replace(/^\*\s?/, "")
            .replace(/^\/\//, "")
            .trim();
          if (cleaned && !cleaned.startsWith("=")) commentLines.push(cleaned);
        } else if (line && !line.startsWith("import ") && !line.startsWith("'use ")) {
          // Ingen kommentar högst upp, hoppa över
          break;
        }
      } else {
        if (line.startsWith("*/") || line === "*") break;
        if (line.startsWith("*") || line.startsWith("//")) {
          const cleaned = line
            .replace(/^\*\s?/, "")
            .replace(/^\/\//, "")
            .trim();
          if (cleaned && !cleaned.startsWith("=")) {
            commentLines.push(cleaned);
            if (commentLines.length >= 2) break;
          }
        } else if (!line) {
          // tom rad, fortsätt
        } else {
          break;
        }
      }
    }

    return commentLines.join(" ").slice(0, 120);
  } catch {
    return "(no first-comment found)";
  }
}

// ── Section renderers ───────────────────────────────────────────

async function sectionEdgeFunctions(): Promise<string> {
  const dirs = await listDirs(FUNCTIONS_DIR, ["_shared", "_tests"]);
  const rows: string[] = [];

  for (const name of dirs) {
    const indexPath = join(FUNCTIONS_DIR, name, "index.ts");
    const exists = await pathExists(indexPath);
    const desc = exists ? await firstComment(indexPath) : "(no index.ts)";
    rows.push(`| \`${name}\` | ${desc} |`);
  }

  return [
    `## Edge Functions (${dirs.length} st)`,
    "",
    "| Funktion | Första kommentar |",
    "|----------|------------------|",
    ...rows,
    "",
  ].join("\n");
}

async function sectionSharedHelpers(): Promise<string> {
  const sharedDir = join(FUNCTIONS_DIR, "_shared");
  if (!(await pathExists(sharedDir))) return "";

  const files = await listFiles(sharedDir, (n) => n.endsWith(".ts"));
  const rows: string[] = [];

  for (const file of files) {
    const filePath = join(sharedDir, file);
    const desc = await firstComment(filePath);
    rows.push(`| \`_shared/${file}\` | ${desc} |`);
  }

  return [
    `## Shared EF helpers (${files.length} st)`,
    "",
    "| Fil | Första kommentar |",
    "|-----|------------------|",
    ...rows,
    "",
  ].join("\n");
}

async function sectionWorkflows(): Promise<string> {
  if (!(await pathExists(WORKFLOWS_DIR))) return "";

  const files = await listFiles(
    WORKFLOWS_DIR,
    (n) => n.endsWith(".yml") || n.endsWith(".yaml"),
  );

  return [
    `## GitHub Actions workflows (${files.length} st)`,
    "",
    ...files.map((f) => `- \`.github/workflows/${f}\``),
    "",
  ].join("\n");
}

async function sectionMigrations(): Promise<string> {
  if (!(await pathExists(MIGRATIONS_DIR))) return "";

  const files = await listFiles(MIGRATIONS_DIR, (n) => n.endsWith(".sql"));
  const latest = files[files.length - 1] ?? "(none)";
  const timestamp = latest.match(/^(\d{14}|\d{8})/)?.[1] ?? "unknown";

  return [
    `## Migrations (${files.length} st)`,
    "",
    `- Senaste: \`${latest}\``,
    `- Timestamp-prefix: \`${timestamp}\``,
    "",
  ].join("\n");
}

// ── Main ─────────────────────────────────────────────────────────

if (import.meta.main) {
  const now = new Date().toISOString().split("T")[0];

  const parts = [
    `# Codebase Snapshot (auto-generated ${now})`,
    "",
    `Genererad av \`scripts/generate-claude-md.ts\`. Kopiera valda sektioner`,
    `till CLAUDE.md för att fixa Regel #29-drift.`,
    "",
    "---",
    "",
    await sectionEdgeFunctions(),
    await sectionSharedHelpers(),
    await sectionWorkflows(),
    await sectionMigrations(),
  ];

  console.log(parts.join("\n"));
}
