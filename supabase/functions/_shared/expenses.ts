// supabase/functions/_shared/expenses.ts
// ──────────────────────────────────────────────────────────────────
// Sprint A (2026-04-26) — Cleaner-utlägg-helpers.
//
// SYFTE:
//   Cleaners betalar utrustning/transport ur egen ficka idag (~200 kr/jobb).
//   Detta system loggar utlägg, låter VD godkänna, och Sprint D integrerar
//   återbetalning vid Stripe-transfer.
//
// FLAG-GATE: platform_settings.expense_settlement_enabled
//   - 'false' (default) = utlägg loggas + godkänns men SETTLEMENT sker EJ
//   - 'true' (Sprint D, kräver jurist) = approved expenses läggs till
//     i triggerStripeTransfer
//
// SCOPE Sprint A:
//   - submitExpense: cleaner skickar in utlägg (auto-godkänner småbelopp via DB-trigger)
//   - approveExpense / rejectExpense: VD-actions
//   - getCleanerExpenseTotal: aggregat per period
//   - getPendingExpensesForCompany: VD-pending-lista
//   - settleExpensesAtPayout: stub (full impl i Sprint D)
//
// REGLER: #26 N/A (ny fil), #27 scope (bara expense-helpers), #28 SSOT
//   (alla utlägg-rörelser via dessa funktioner), #30 moms-hantering +
//   F-skatt-flow KRÄVER jurist innan Sprint D, #31 schema curl-verifierat
//   2026-04-26 (cleaner_expenses existerar ej före migration).
// ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface SupabaseExpenseClient {
  from: (table: string) => any;
}

export type ExpenseCategory = "chemicals" | "tools" | "transport" | "parking" | "other";
export type ExpenseStatus = "pending" | "approved" | "rejected" | "paid";

export interface ExpenseSubmission {
  cleanerId: string;
  companyId?: string | null;
  bookingId?: string | null;
  amountOre: number;
  vatOre?: number;
  category: ExpenseCategory;
  description: string;
  expenseDate: string;       // ISO 'YYYY-MM-DD'
  receiptStoragePath?: string | null;
  receiptMimeType?: string | null;
  notes?: string | null;
}

export interface ExpenseRecord {
  id: string;
  cleaner_id: string;
  company_id: string | null;
  booking_id: string | null;
  amount_ore: number;
  vat_amount_ore: number;
  category: ExpenseCategory;
  description: string;
  receipt_storage_path: string | null;
  receipt_mime_type: string | null;
  expense_date: string;
  submitted_at: string;
  status: ExpenseStatus;
  approved_by_cleaner_id: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  paid_in_payout_id: string | null;
  paid_at: string | null;
  notes: string | null;
}

export interface ExpenseConfig {
  max_per_booking_ore: number;
  auto_approve_under_ore: number;
  categories_enabled: ExpenseCategory[];
  transport_default_ore_per_km: number;
  settlement_enabled: boolean;
}

export const EXPENSE_DEFAULT_MAX_PER_BOOKING_ORE = 50000;     // 500 kr
export const EXPENSE_DEFAULT_AUTO_APPROVE_UNDER_ORE = 10000;  // 100 kr
export const EXPENSE_DEFAULT_TRANSPORT_ORE_PER_KM = 250;      // 2,50 kr/km

// ============================================================
// Config-läsning
// ============================================================

export async function getExpenseConfig(supabase: SupabaseExpenseClient): Promise<ExpenseConfig> {
  const keys = [
    "expense_max_per_booking_ore",
    "expense_auto_approve_under_ore",
    "expense_categories_enabled",
    "transport_default_ore_per_km",
    "expense_settlement_enabled",
  ];
  // deno-lint-ignore no-explicit-any
  const lookups: Record<string, any> = {};
  for (const k of keys) {
    const { data } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", k)
      .maybeSingle();
    lookups[k] = data?.value;
  }

  const maxPerBooking = Number(lookups.expense_max_per_booking_ore);
  const autoApprove = Number(lookups.expense_auto_approve_under_ore);
  const transportPerKm = Number(lookups.transport_default_ore_per_km);
  const categoriesRaw = String(lookups.expense_categories_enabled || "");
  const validCats: ExpenseCategory[] = ["chemicals", "tools", "transport", "parking", "other"];
  const categories = categoriesRaw
    ? categoriesRaw.split(",").map((c) => c.trim()).filter((c) => validCats.includes(c as ExpenseCategory)) as ExpenseCategory[]
    : validCats;

  return {
    max_per_booking_ore: isFinite(maxPerBooking) && maxPerBooking > 0 ? maxPerBooking : EXPENSE_DEFAULT_MAX_PER_BOOKING_ORE,
    auto_approve_under_ore: isFinite(autoApprove) && autoApprove >= 0 ? autoApprove : EXPENSE_DEFAULT_AUTO_APPROVE_UNDER_ORE,
    categories_enabled: categories.length > 0 ? categories : validCats,
    transport_default_ore_per_km: isFinite(transportPerKm) && transportPerKm > 0 ? transportPerKm : EXPENSE_DEFAULT_TRANSPORT_ORE_PER_KM,
    settlement_enabled: lookups.expense_settlement_enabled === "true",
  };
}

// ============================================================
// Submit / approve / reject
// ============================================================

export interface SubmitResult {
  expense_id: string | null;
  status: ExpenseStatus;
  reason: string;
}

/**
 * Skickar in ett utlägg. DB-trigger auto-godkänner om belopp <= threshold.
 * Validerar amount > 0 och belopp <= max_per_booking.
 */
export async function submitExpense(
  supabase: SupabaseExpenseClient,
  opts: ExpenseSubmission,
): Promise<SubmitResult> {
  if (opts.amountOre <= 0) {
    return { expense_id: null, status: "pending", reason: "amount_must_be_positive" };
  }
  if (!opts.description || opts.description.trim().length < 2) {
    return { expense_id: null, status: "pending", reason: "description_required" };
  }
  if (!opts.expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(opts.expenseDate)) {
    return { expense_id: null, status: "pending", reason: "invalid_expense_date" };
  }

  const cfg = await getExpenseConfig(supabase);
  if (!cfg.categories_enabled.includes(opts.category)) {
    return { expense_id: null, status: "pending", reason: "category_not_enabled" };
  }
  if (opts.amountOre > cfg.max_per_booking_ore) {
    return { expense_id: null, status: "pending", reason: `amount_exceeds_max_${cfg.max_per_booking_ore}_ore` };
  }

  const insertRow = {
    cleaner_id: opts.cleanerId,
    company_id: opts.companyId ?? null,
    booking_id: opts.bookingId ?? null,
    amount_ore: opts.amountOre,
    vat_amount_ore: opts.vatOre ?? 0,
    category: opts.category,
    description: opts.description.trim().slice(0, 500),
    receipt_storage_path: opts.receiptStoragePath ?? null,
    receipt_mime_type: opts.receiptMimeType ?? null,
    expense_date: opts.expenseDate,
    notes: opts.notes ? opts.notes.slice(0, 1000) : null,
  };

  const { data, error } = await supabase
    .from("cleaner_expenses")
    .insert(insertRow)
    .select("id, status")
    .maybeSingle();

  if (error || !data) {
    return { expense_id: null, status: "pending", reason: `insert_failed: ${error?.message || "unknown"}` };
  }

  return {
    expense_id: data.id as string,
    status: data.status as ExpenseStatus,
    reason: data.status === "approved" ? "auto_approved_under_threshold" : "submitted",
  };
}

export async function approveExpense(
  supabase: SupabaseExpenseClient,
  opts: { expenseId: string; approvedByCleanerId: string },
): Promise<{ ok: boolean; reason: string }> {
  const { error } = await supabase
    .from("cleaner_expenses")
    .update({
      status: "approved",
      approved_by_cleaner_id: opts.approvedByCleanerId,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.expenseId)
    .eq("status", "pending");
  if (error) return { ok: false, reason: error.message };
  return { ok: true, reason: "approved" };
}

export async function rejectExpense(
  supabase: SupabaseExpenseClient,
  opts: { expenseId: string; rejectedByCleanerId: string; reason: string },
): Promise<{ ok: boolean; reason: string }> {
  const { error } = await supabase
    .from("cleaner_expenses")
    .update({
      status: "rejected",
      approved_by_cleaner_id: opts.rejectedByCleanerId,
      approved_at: new Date().toISOString(),
      rejected_reason: opts.reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.expenseId)
    .eq("status", "pending");
  if (error) return { ok: false, reason: error.message };
  return { ok: true, reason: "rejected" };
}

// ============================================================
// Read / aggregat
// ============================================================

export async function getCleanerExpenseTotal(
  supabase: SupabaseExpenseClient,
  cleanerId: string,
  fromDate?: string,
  toDate?: string,
): Promise<{ pending_ore: number; approved_ore: number; paid_ore: number; rejected_ore: number; count: number }> {
  let q = supabase.from("cleaner_expenses").select("amount_ore, status").eq("cleaner_id", cleanerId);
  if (fromDate) q = q.gte("expense_date", fromDate);
  if (toDate) q = q.lte("expense_date", toDate);
  const { data } = await q;
  const rows = (data || []) as Array<{ amount_ore: number; status: ExpenseStatus }>;
  const totals = { pending_ore: 0, approved_ore: 0, paid_ore: 0, rejected_ore: 0, count: rows.length };
  for (const r of rows) {
    const amt = Number(r.amount_ore) || 0;
    if (r.status === "pending") totals.pending_ore += amt;
    else if (r.status === "approved") totals.approved_ore += amt;
    else if (r.status === "paid") totals.paid_ore += amt;
    else if (r.status === "rejected") totals.rejected_ore += amt;
  }
  return totals;
}

export async function getPendingExpensesForCompany(
  supabase: SupabaseExpenseClient,
  companyId: string,
  limit: number = 50,
): Promise<ExpenseRecord[]> {
  const { data } = await supabase
    .from("cleaner_expenses")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("submitted_at", { ascending: false })
    .limit(limit);
  return (data as ExpenseRecord[]) || [];
}

// ============================================================
// Settlement (Sprint D — kräver jurist-OK på moms)
// ============================================================

/**
 * Stub för Sprint D. Markerar approved-utlägg som 'paid' när
 * settlement-flag är aktiverad. Returnerar 0 om disabled.
 */
export async function settleExpensesAtPayout(
  supabase: SupabaseExpenseClient,
  opts: {
    cleanerId: string;
    payoutAuditLogId: string;
  },
): Promise<{ enabled: boolean; settled_count: number; total_settled_ore: number; reason: string }> {
  const cfg = await getExpenseConfig(supabase);
  if (!cfg.settlement_enabled) {
    return { enabled: false, settled_count: 0, total_settled_ore: 0, reason: "settlement_disabled" };
  }

  // Hämta alla approved-utlägg som ej är paid
  const { data: approved } = await supabase
    .from("cleaner_expenses")
    .select("id, amount_ore")
    .eq("cleaner_id", opts.cleanerId)
    .eq("status", "approved");
  const rows = (approved || []) as Array<{ id: string; amount_ore: number }>;
  if (rows.length === 0) {
    return { enabled: true, settled_count: 0, total_settled_ore: 0, reason: "no_approved_expenses" };
  }

  const ids = rows.map((r) => r.id);
  const total = rows.reduce((s, r) => s + (Number(r.amount_ore) || 0), 0);
  const nowIso = new Date().toISOString();

  // Markera som paid + länka till payout
  await supabase
    .from("cleaner_expenses")
    .update({
      status: "paid",
      paid_in_payout_id: opts.payoutAuditLogId,
      paid_at: nowIso,
      updated_at: nowIso,
    })
    .in("id", ids);

  return {
    enabled: true,
    settled_count: rows.length,
    total_settled_ore: total,
    reason: "settled",
  };
}

// ============================================================
// Konvertering-hjälpare
// ============================================================

/**
 * Beräknar moms från brutto (25% standard).
 */
export function calcVatFromGross(grossOre: number, vatPct: number = 25): number {
  return Math.round(grossOre - (grossOre / (1 + vatPct / 100)));
}

/**
 * Beräknar transport-utlägg från km × öre/km.
 */
export function calcTransportOre(km: number, orePerKm: number = EXPENSE_DEFAULT_TRANSPORT_ORE_PER_KM): number {
  return Math.round(km * orePerKm);
}
