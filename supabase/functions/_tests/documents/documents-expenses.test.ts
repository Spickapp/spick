// supabase/functions/_tests/documents/documents-expenses.test.ts
// ──────────────────────────────────────────────────────────────────
// Sprint A (2026-04-26) — tester för document-store + expenses helpers.
//
// Kör: deno test supabase/functions/_tests/documents/documents-expenses.test.ts --allow-env
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStoragePath,
  calcRetentionUntil,
  DEFAULT_BUCKET,
  DEFAULT_RETENTION_DAYS,
  extFromMime,
  getDocumentDownloadUrl,
  listDocumentsForOwner,
  type SupabaseDocumentClient,
  uploadDocument,
} from "../../_shared/document-store.ts";
import {
  approveExpense,
  calcTransportOre,
  calcVatFromGross,
  EXPENSE_DEFAULT_AUTO_APPROVE_UNDER_ORE,
  EXPENSE_DEFAULT_MAX_PER_BOOKING_ORE,
  EXPENSE_DEFAULT_TRANSPORT_ORE_PER_KM,
  getCleanerExpenseTotal,
  getExpenseConfig,
  getPendingExpensesForCompany,
  rejectExpense,
  settleExpensesAtPayout,
  submitExpense,
  type SupabaseExpenseClient,
} from "../../_shared/expenses.ts";

// ── Universal mock-helper ──

interface MockState {
  platform_settings: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  cleaner_expenses: Array<Record<string, unknown>>;
  storage_uploads: Array<{ bucket: string; path: string; size: number }>;
  storage_signed_urls: Record<string, string>;
  storage_should_fail?: boolean;
  insert_should_fail?: boolean;
  trigger_auto_approve_under?: number;  // mock DB-trigger
}

// deno-lint-ignore no-explicit-any
function createMock(state: Partial<MockState>) {
  const s: MockState = {
    platform_settings: state.platform_settings || [],
    documents: state.documents || [],
    cleaner_expenses: state.cleaner_expenses || [],
    storage_uploads: state.storage_uploads || [],
    storage_signed_urls: state.storage_signed_urls || {},
    storage_should_fail: state.storage_should_fail,
    insert_should_fail: state.insert_should_fail,
    trigger_auto_approve_under: state.trigger_auto_approve_under,
  };

  // deno-lint-ignore no-explicit-any
  const queryBuilder = (table: keyof MockState): any => {
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    const gteFilters: Record<string, unknown> = {};
    const lteFilters: Record<string, unknown> = {};
    let inserting: Record<string, unknown> | null = null;
    let updating: Record<string, unknown> | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const exec = () => {
      const rows = s[table] as Array<Record<string, unknown>>;
      let result = rows.filter((r) => {
        for (const [k, v] of Object.entries(filters)) {
          if (r[k] !== v) return false;
        }
        for (const [k, vs] of Object.entries(inFilters)) {
          if (!vs.includes(r[k])) return false;
        }
        for (const [k, v] of Object.entries(gteFilters)) {
          if ((r[k] as string) < (v as string)) return false;
        }
        for (const [k, v] of Object.entries(lteFilters)) {
          if ((r[k] as string) > (v as string)) return false;
        }
        return true;
      });
      if (orderCol) {
        result = [...result].sort((a, b) => {
          const av = a[orderCol!] as string;
          const bv = b[orderCol!] as string;
          if (av === bv) return 0;
          return orderAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
        });
      }
      if (limitN !== null) result = result.slice(0, limitN);
      return result;
    };

    const builder = {
      select() { return this; },
      eq(col: string, val: unknown) { filters[col] = val; return this; },
      in(col: string, vals: unknown[]) { inFilters[col] = vals; return this; },
      gte(col: string, val: unknown) { gteFilters[col] = val; return this; },
      lte(col: string, val: unknown) { lteFilters[col] = val; return this; },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return this;
      },
      limit(n: number) { limitN = n; return this; },
      maybeSingle() {
        if (inserting) {
          if (s.insert_should_fail) {
            return Promise.resolve({ data: null, error: { message: "insert_failed" } });
          }
          let row: Record<string, unknown> = { id: crypto.randomUUID(), ...inserting };
          // Simulera DB-trigger för cleaner_expenses
          if (table === "cleaner_expenses" && s.trigger_auto_approve_under !== undefined) {
            const amt = Number(row.amount_ore) || 0;
            if (amt <= s.trigger_auto_approve_under && row.status === undefined) {
              row.status = "approved";
              row.approved_at = new Date().toISOString();
            } else if (row.status === undefined) {
              row.status = "pending";
            }
          } else if (table === "cleaner_expenses" && row.status === undefined) {
            row.status = "pending";
          }
          (s[table] as Array<Record<string, unknown>>).push(row);
          return Promise.resolve({ data: row, error: null });
        }
        const result = exec();
        return Promise.resolve({ data: result[0] ?? null, error: null });
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        // Promise-like för list-queries (utan maybeSingle/insert)
        if (inserting) {
          // shouldn't happen but defensive
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        if (updating) {
          const rows = s[table] as Array<Record<string, unknown>>;
          rows.forEach((r) => {
            let match = true;
            for (const [k, v] of Object.entries(filters)) {
              if (r[k] !== v) { match = false; break; }
            }
            if (match) {
              for (const [k, vs] of Object.entries(inFilters)) {
                if (!vs.includes(r[k])) { match = false; break; }
              }
            }
            if (match) Object.assign(r, updating);
          });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        return Promise.resolve({ data: exec(), error: null }).then(resolve);
      },
      // deno-lint-ignore no-explicit-any
      insert(row: any) { inserting = row; return this; },
      // deno-lint-ignore no-explicit-any
      update(row: any) {
        updating = row;
        return {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return {
              eq(col2: string, val2: unknown) {
                filters[col2] = val2;
                const rows = s[table] as Array<Record<string, unknown>>;
                rows.forEach((r) => {
                  let m = true;
                  for (const [k, v] of Object.entries(filters)) {
                    if (r[k] !== v) { m = false; break; }
                  }
                  if (m) Object.assign(r, updating);
                });
                return Promise.resolve({ data: null, error: null });
              },
              then(resolve: (v: { data: unknown; error: null }) => void) {
                const rows = s[table] as Array<Record<string, unknown>>;
                rows.forEach((r) => {
                  let m = true;
                  for (const [k, v] of Object.entries(filters)) {
                    if (r[k] !== v) { m = false; break; }
                  }
                  if (m) Object.assign(r, updating);
                });
                return Promise.resolve({ data: null, error: null }).then(resolve);
              },
            };
          },
          in(col: string, vals: unknown[]) {
            inFilters[col] = vals;
            return Promise.resolve({ data: null, error: null }).then((v) => {
              const rows = s[table] as Array<Record<string, unknown>>;
              rows.forEach((r) => {
                if (vals.includes(r[col])) Object.assign(r, updating);
              });
              return v;
            });
          },
        };
      },
    };
    return builder;
  };

  const docClient: SupabaseDocumentClient = {
    from(t: string) { return queryBuilder(t as keyof MockState); },
    storage: {
      from(bucket: string) {
        return {
          // deno-lint-ignore no-explicit-any
          upload(path: string, body: Uint8Array | ArrayBuffer, _opts?: any) {
            if (s.storage_should_fail) {
              return Promise.resolve({ data: null, error: { message: "storage_fail" } });
            }
            const size = (body as Uint8Array).length || (body as ArrayBuffer).byteLength;
            s.storage_uploads.push({ bucket, path, size });
            return Promise.resolve({ data: { path }, error: null });
          },
          createSignedUrl(path: string, _ttl: number) {
            const url = s.storage_signed_urls[path] || `https://signed.example/${path}?token=mock`;
            return Promise.resolve({ data: { signedUrl: url }, error: null });
          },
          remove(_paths: string[]) {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };
  const expClient: SupabaseExpenseClient = { from(t: string) { return queryBuilder(t as keyof MockState); } };
  return { docClient, expClient, state: s };
}

// ============================================================
// document-store helpers
// ============================================================

Deno.test("DEFAULT_BUCKET = 'documents'", () => {
  assertEquals(DEFAULT_BUCKET, "documents");
});

Deno.test("DEFAULT_RETENTION_DAYS = 2555 (~7 år)", () => {
  assertEquals(DEFAULT_RETENTION_DAYS, 2555);
});

Deno.test("extFromMime: mappar PDF + JPEG + HTML korrekt", () => {
  assertEquals(extFromMime("application/pdf"), "pdf");
  assertEquals(extFromMime("image/jpeg"), "jpg");
  assertEquals(extFromMime("text/html"), "html");
  assertEquals(extFromMime("application/xml"), "xml");
  assertEquals(extFromMime("image/png"), "png");
});

Deno.test("extFromMime: okänd mime → 'bin'", () => {
  assertEquals(extFromMime("application/octet-stream"), "bin");
  assertEquals(extFromMime("foo/bar"), "bin");
});

Deno.test("calcRetentionUntil: returnerar ISO-string i framtiden", () => {
  const r = calcRetentionUntil(7);
  const d = new Date(r);
  const diff = d.getTime() - Date.now();
  assert(diff > 6 * 86400000 && diff < 8 * 86400000, "borde vara ~7 dagar i framtiden");
});

Deno.test("buildStoragePath: format type/yyyy-mm/ownerKey/uuid.ext", () => {
  const p = buildStoragePath({ type: "receipt", ownerKey: "abc123", ext: "pdf" });
  assert(/^receipt\/\d{4}-\d{2}\/abc123\/[0-9a-f-]+\.pdf$/.test(p), `path: ${p}`);
});

Deno.test("buildStoragePath: sanitiserar farliga ext", () => {
  const p = buildStoragePath({ type: "other", ownerKey: "x", ext: "../etc/passwd" });
  assert(!p.includes("../"), "borde stripp:a path-traversal");
  assert(!p.includes("/passwd"), "borde stripp:a path-traversal");
});

Deno.test("uploadDocument: kastar utan ägare-FK", async () => {
  const { docClient } = createMock({});
  await assertRejects(
    () => uploadDocument(docClient, {
      type: "receipt",
      title: "Test",
      fileBuffer: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    }),
    Error,
    "minst en ägar-FK",
  );
});

Deno.test("uploadDocument: laddar upp + skapar metarad", async () => {
  const { docClient, state } = createMock({});
  const r = await uploadDocument(docClient, {
    type: "receipt",
    title: "Booking SP-001 kvitto",
    fileBuffer: new Uint8Array([1, 2, 3, 4, 5]),
    mimeType: "application/pdf",
    customerEmail: "kund@test.se",
    bookingId: "b-1",
  });
  assert(r.document_id);
  assert(r.storage_path.startsWith("receipt/"));
  assertEquals(r.bucket, "documents");
  assertEquals(state.storage_uploads.length, 1);
  assertEquals(state.storage_uploads[0].size, 5);
  assertEquals(state.documents.length, 1);
  assertEquals(state.documents[0].customer_email, "kund@test.se");
  assertEquals(state.documents[0].booking_id, "b-1");
  assertEquals(state.documents[0].file_size_bytes, 5);
});

Deno.test("uploadDocument: storage-fel → kastar", async () => {
  const { docClient } = createMock({ storage_should_fail: true });
  await assertRejects(
    () => uploadDocument(docClient, {
      type: "receipt",
      title: "T",
      fileBuffer: new Uint8Array([1]),
      mimeType: "application/pdf",
      bookingId: "b",
    }),
    Error,
    "storage-fel",
  );
});

Deno.test("uploadDocument: cleaner_id som ägare", async () => {
  const { docClient, state } = createMock({});
  await uploadDocument(docClient, {
    type: "training_cert",
    title: "Spick handbok-test 2026",
    fileBuffer: new Uint8Array([1, 2, 3]),
    mimeType: "application/pdf",
    cleanerId: "cl-1",
    retentionDays: 365,
  });
  assertEquals(state.documents[0].cleaner_id, "cl-1");
  assertEquals(state.documents[0].document_type, "training_cert");
});

Deno.test("listDocumentsForOwner: filtrerar på customer_email", async () => {
  const { docClient } = createMock({
    documents: [
      { id: "d1", customer_email: "a@x.se", status: "active", issued_at: "2026-04-01", document_type: "receipt", storage_path: "p1", title: "X" },
      { id: "d2", customer_email: "b@x.se", status: "active", issued_at: "2026-04-02", document_type: "receipt", storage_path: "p2", title: "Y" },
      { id: "d3", customer_email: "a@x.se", status: "archived", issued_at: "2026-04-03", document_type: "receipt", storage_path: "p3", title: "Z" },
    ],
  });
  const r = await listDocumentsForOwner(docClient, { customerEmail: "a@x.se" });
  assertEquals(r.length, 1);
  assertEquals(r[0].id, "d1");
});

Deno.test("listDocumentsForOwner: returnerar [] utan ägare-filter", async () => {
  const { docClient } = createMock({});
  const r = await listDocumentsForOwner(docClient, {});
  assertEquals(r.length, 0);
});

Deno.test("getDocumentDownloadUrl: returnerar signerad URL", async () => {
  const { docClient } = createMock({
    storage_signed_urls: { "receipt/2026-04/k/x.pdf": "https://signed/abc" },
  });
  const url = await getDocumentDownloadUrl(docClient, "receipt/2026-04/k/x.pdf");
  assertEquals(url, "https://signed/abc");
});

// ============================================================
// expenses helpers
// ============================================================

Deno.test("EXPENSE_DEFAULT_MAX_PER_BOOKING_ORE = 50000 (500 kr)", () => {
  assertEquals(EXPENSE_DEFAULT_MAX_PER_BOOKING_ORE, 50000);
});

Deno.test("EXPENSE_DEFAULT_AUTO_APPROVE_UNDER_ORE = 10000 (100 kr)", () => {
  assertEquals(EXPENSE_DEFAULT_AUTO_APPROVE_UNDER_ORE, 10000);
});

Deno.test("EXPENSE_DEFAULT_TRANSPORT_ORE_PER_KM = 250 (2,50 kr/km)", () => {
  assertEquals(EXPENSE_DEFAULT_TRANSPORT_ORE_PER_KM, 250);
});

Deno.test("calcVatFromGross: 100 kr inkl moms = 20 kr moms", () => {
  // 10000 öre brutto inkl 25% → moms = 10000 - (10000/1.25) = 10000 - 8000 = 2000 öre
  assertEquals(calcVatFromGross(10000, 25), 2000);
});

Deno.test("calcTransportOre: 12 km × 2,50 kr/km = 30 kr (3000 öre)", () => {
  assertEquals(calcTransportOre(12, 250), 3000);
});

Deno.test("getExpenseConfig: defaults när allt saknas", async () => {
  const { expClient } = createMock({});
  const cfg = await getExpenseConfig(expClient);
  assertEquals(cfg.max_per_booking_ore, 50000);
  assertEquals(cfg.auto_approve_under_ore, 10000);
  assertEquals(cfg.transport_default_ore_per_km, 250);
  assertEquals(cfg.settlement_enabled, false);
  assertEquals(cfg.categories_enabled.length, 5);
});

Deno.test("getExpenseConfig: parsing av comma-separated kategorier", async () => {
  const { expClient } = createMock({
    platform_settings: [
      { key: "expense_categories_enabled", value: "chemicals,tools" },
    ],
  });
  const cfg = await getExpenseConfig(expClient);
  assertEquals(cfg.categories_enabled, ["chemicals", "tools"]);
});

Deno.test("submitExpense: blockerar amount=0", async () => {
  const { expClient } = createMock({});
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 0,
    category: "tools",
    description: "Test",
    expenseDate: "2026-04-26",
  });
  assertEquals(r.expense_id, null);
  assertEquals(r.reason, "amount_must_be_positive");
});

Deno.test("submitExpense: blockerar tom description", async () => {
  const { expClient } = createMock({});
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 100,
    category: "tools",
    description: "",
    expenseDate: "2026-04-26",
  });
  assertEquals(r.reason, "description_required");
});

Deno.test("submitExpense: blockerar invalid date", async () => {
  const { expClient } = createMock({});
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 100,
    category: "tools",
    description: "Test",
    expenseDate: "2026/04/26",
  });
  assertEquals(r.reason, "invalid_expense_date");
});

Deno.test("submitExpense: blockerar belopp > max", async () => {
  const { expClient } = createMock({
    platform_settings: [{ key: "expense_max_per_booking_ore", value: "5000" }],
  });
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 6000,
    category: "tools",
    description: "Stort köp",
    expenseDate: "2026-04-26",
  });
  assertEquals(r.expense_id, null);
  assertEquals(r.reason, "amount_exceeds_max_5000_ore");
});

Deno.test("submitExpense: blockerar disabled kategori", async () => {
  const { expClient } = createMock({
    platform_settings: [{ key: "expense_categories_enabled", value: "chemicals,tools" }],
  });
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 100,
    category: "transport",
    description: "Bil",
    expenseDate: "2026-04-26",
  });
  assertEquals(r.reason, "category_not_enabled");
});

Deno.test("submitExpense: lyckad insert + auto-approve via mock-trigger", async () => {
  const { expClient, state } = createMock({
    trigger_auto_approve_under: 10000, // simulera DB-trigger
  });
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 8900,    // 89 kr — under 100 kr threshold
    category: "chemicals",
    description: "Allrent ICA",
    expenseDate: "2026-04-26",
  });
  assert(r.expense_id);
  assertEquals(r.status, "approved");
  assertEquals(r.reason, "auto_approved_under_threshold");
  assertEquals(state.cleaner_expenses.length, 1);
});

Deno.test("submitExpense: stort belopp → pending (ej auto-approve)", async () => {
  const { expClient } = createMock({
    trigger_auto_approve_under: 10000,
  });
  const r = await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 25000,   // 250 kr
    category: "tools",
    description: "Stor verktygsväska",
    expenseDate: "2026-04-26",
  });
  assert(r.expense_id);
  assertEquals(r.status, "pending");
  assertEquals(r.reason, "submitted");
});

Deno.test("submitExpense: cap:ar description till 500 chars + notes till 1000", async () => {
  const { expClient, state } = createMock({});
  const longDesc = "a".repeat(800);
  const longNotes = "n".repeat(2000);
  await submitExpense(expClient, {
    cleanerId: "cl-1",
    amountOre: 100,
    category: "other",
    description: longDesc,
    expenseDate: "2026-04-26",
    notes: longNotes,
  });
  assertEquals((state.cleaner_expenses[0].description as string).length, 500);
  assertEquals((state.cleaner_expenses[0].notes as string).length, 1000);
});

Deno.test("approveExpense: ändrar status från pending till approved", async () => {
  const { expClient, state } = createMock({
    cleaner_expenses: [{ id: "e1", status: "pending", amount_ore: 100 }],
  });
  const r = await approveExpense(expClient, { expenseId: "e1", approvedByCleanerId: "vd-1" });
  assertEquals(r.ok, true);
  assertEquals(state.cleaner_expenses[0].status, "approved");
  assertEquals(state.cleaner_expenses[0].approved_by_cleaner_id, "vd-1");
});

Deno.test("rejectExpense: ändrar status till rejected med reason", async () => {
  const { expClient, state } = createMock({
    cleaner_expenses: [{ id: "e1", status: "pending", amount_ore: 100 }],
  });
  const r = await rejectExpense(expClient, {
    expenseId: "e1",
    rejectedByCleanerId: "vd-1",
    reason: "Inte arbetsrelaterat",
  });
  assertEquals(r.ok, true);
  assertEquals(state.cleaner_expenses[0].status, "rejected");
  assertEquals(state.cleaner_expenses[0].rejected_reason, "Inte arbetsrelaterat");
});

Deno.test("getCleanerExpenseTotal: aggregerar per status", async () => {
  const { expClient } = createMock({
    cleaner_expenses: [
      { id: "e1", cleaner_id: "cl-1", amount_ore: 100, status: "pending", expense_date: "2026-04-01" },
      { id: "e2", cleaner_id: "cl-1", amount_ore: 200, status: "approved", expense_date: "2026-04-05" },
      { id: "e3", cleaner_id: "cl-1", amount_ore: 300, status: "approved", expense_date: "2026-04-10" },
      { id: "e4", cleaner_id: "cl-1", amount_ore: 400, status: "paid", expense_date: "2026-04-15" },
      { id: "e5", cleaner_id: "cl-2", amount_ore: 500, status: "pending", expense_date: "2026-04-20" },
    ],
  });
  const r = await getCleanerExpenseTotal(expClient, "cl-1");
  assertEquals(r.pending_ore, 100);
  assertEquals(r.approved_ore, 500);
  assertEquals(r.paid_ore, 400);
  assertEquals(r.count, 4);
});

Deno.test("getCleanerExpenseTotal: filtrerar på datum-range", async () => {
  const { expClient } = createMock({
    cleaner_expenses: [
      { id: "e1", cleaner_id: "cl-1", amount_ore: 100, status: "pending", expense_date: "2026-03-31" },
      { id: "e2", cleaner_id: "cl-1", amount_ore: 200, status: "pending", expense_date: "2026-04-15" },
      { id: "e3", cleaner_id: "cl-1", amount_ore: 300, status: "pending", expense_date: "2026-05-01" },
    ],
  });
  const r = await getCleanerExpenseTotal(expClient, "cl-1", "2026-04-01", "2026-04-30");
  assertEquals(r.pending_ore, 200);
  assertEquals(r.count, 1);
});

Deno.test("getPendingExpensesForCompany: returnerar bara pending", async () => {
  const { expClient } = createMock({
    cleaner_expenses: [
      { id: "e1", company_id: "co-1", status: "pending", amount_ore: 100, submitted_at: "2026-04-01T00:00:00Z" },
      { id: "e2", company_id: "co-1", status: "approved", amount_ore: 200, submitted_at: "2026-04-02T00:00:00Z" },
      { id: "e3", company_id: "co-1", status: "pending", amount_ore: 300, submitted_at: "2026-04-03T00:00:00Z" },
      { id: "e4", company_id: "co-2", status: "pending", amount_ore: 400, submitted_at: "2026-04-04T00:00:00Z" },
    ],
  });
  const r = await getPendingExpensesForCompany(expClient, "co-1");
  assertEquals(r.length, 2);
  assertEquals(r.every((e) => e.status === "pending"), true);
  assertEquals(r.every((e) => e.company_id === "co-1"), true);
});

Deno.test("settleExpensesAtPayout: no-op när disabled", async () => {
  const { expClient } = createMock({});
  const r = await settleExpensesAtPayout(expClient, { cleanerId: "cl-1", payoutAuditLogId: "pa-1" });
  assertEquals(r.enabled, false);
  assertEquals(r.settled_count, 0);
  assertEquals(r.reason, "settlement_disabled");
});

Deno.test("settleExpensesAtPayout: enabled markerar approved → paid", async () => {
  const { expClient, state } = createMock({
    platform_settings: [{ key: "expense_settlement_enabled", value: "true" }],
    cleaner_expenses: [
      { id: "e1", cleaner_id: "cl-1", status: "approved", amount_ore: 8900 },
      { id: "e2", cleaner_id: "cl-1", status: "approved", amount_ore: 4900 },
      { id: "e3", cleaner_id: "cl-1", status: "pending", amount_ore: 25000 },  // ej approved → ej settle
      { id: "e4", cleaner_id: "cl-2", status: "approved", amount_ore: 1000 },  // annan cleaner
    ],
  });
  const r = await settleExpensesAtPayout(expClient, { cleanerId: "cl-1", payoutAuditLogId: "pa-1" });
  assertEquals(r.enabled, true);
  assertEquals(r.settled_count, 2);
  assertEquals(r.total_settled_ore, 13800);
  // Verifiera state
  assertEquals(state.cleaner_expenses[0].status, "paid");
  assertEquals(state.cleaner_expenses[0].paid_in_payout_id, "pa-1");
  assertEquals(state.cleaner_expenses[1].status, "paid");
  assertEquals(state.cleaner_expenses[2].status, "pending");  // ej rörd
  assertEquals(state.cleaner_expenses[3].status, "approved"); // annan cleaner
});

Deno.test("settleExpensesAtPayout: 0 approved → reason='no_approved_expenses'", async () => {
  const { expClient } = createMock({
    platform_settings: [{ key: "expense_settlement_enabled", value: "true" }],
    cleaner_expenses: [
      { id: "e1", cleaner_id: "cl-1", status: "pending", amount_ore: 100 },
    ],
  });
  const r = await settleExpensesAtPayout(expClient, { cleanerId: "cl-1", payoutAuditLogId: "pa-1" });
  assertEquals(r.settled_count, 0);
  assertEquals(r.reason, "no_approved_expenses");
});
