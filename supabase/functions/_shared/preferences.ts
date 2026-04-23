// supabase/functions/_shared/preferences.ts
// ──────────────────────────────────────────────────────────────────
// Fas 5.5a — Central helper för customer_preferences-tabellen.
//
// PRIMÄRKÄLLA:
//   - docs/architecture/recurring-retention-system.md §3 (CustomerPreferences
//     schema-design)
//   - supabase/migrations/20260427000002_fas5_recurring_retention_schema.sql
//     (CREATE TABLE customer_preferences)
//
// SYFTE:
//   Alla customer_preferences-accesser i Spick SKA gå via denna fil.
//   Tar bort risken för fragmentering (regel #28) när §5.8 preference-
//   learning, §5.9 email-nudges, §5.4 kund-UI och framtida onboarding
//   läser/skriver preferenser.
//
//   RLS: customer_preferences har policies för (a) kund JWT email-match
//   och (b) service_role. Denna helper accepterar båda klient-typer.
//
// STATUS: Infrastruktur (Fas 5.5a). Inga call-siter än. Retrofit i §5.5b
//   (customer-upsert-utvidgning eller ny save-preferences EF) efter Farhads
//   design-val.
//
// REGLER: #26 grep-före-edit (customer_preferences-tabell verifierad i
//   prod via REST HTTP 401), #27 scope (helper + types + tests, ingen
//   call-site), #28 single source (preferences-logik bara här), #31
//   primärkälla (schema från migrationsfil + prod-REST verifikation).
// ──────────────────────────────────────────────────────────────────

// Minimal client-interface (undviker supabase-js version-mismatch).
// Samma pattern som _shared/events.ts SupabaseRpcClient.
// deno-lint-ignore no-explicit-any
export type SupabaseClientLike = any;

// ============================================================
// Types
// ============================================================

/**
 * Customer preferences row. Alla fält nullable förutom customer_email
 * + timestamps. Helper-funktioner accepterar Partial för uppdateringar.
 */
export interface CustomerPreferences {
  id: string;
  customer_email: string;
  favorite_cleaner_id: string | null;
  blocked_cleaner_ids: string[];
  default_has_pets: boolean | null;
  pet_type: string | null;
  has_children_at_home: boolean | null;
  has_stairs: boolean | null;
  prefers_eco_products: boolean;
  default_notes_to_cleaner: string | null;
  budget_range_min_sek: number | null;
  budget_range_max_sek: number | null;
  language_preference: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fält som får uppdateras via upsert. `id`, `customer_email` och
 * timestamps hanteras av DB.
 */
export type PreferencesPatch = Partial<
  Omit<CustomerPreferences, "id" | "customer_email" | "created_at" | "updated_at">
>;

// ============================================================
// Helpers
// ============================================================

/**
 * Hämta preferences för en kund. Returnerar null om ingen rad finns
 * (första gången kunden bokar).
 *
 * Använd SERVICE_ROLE-klient för att säkert kringgå RLS vid server-side
 * operationer (t.ex. §5.8 preference-learning). Anon-klient får 401 om
 * JWT email inte matchar raden.
 */
export async function getPreferences(
  supabase: SupabaseClientLike,
  email: string,
): Promise<CustomerPreferences | null> {
  const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : "";
  if (!isValidEmail(normalizedEmail)) return null;
  try {
    const { data, error } = await supabase
      .from("customer_preferences")
      .select("*")
      .eq("customer_email", normalizedEmail)
      .maybeSingle();
    if (error) {
      console.warn("[preferences] getPreferences fel:", error.message);
      return null;
    }
    return (data as CustomerPreferences) ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[preferences] getPreferences oväntat fel:", msg);
    return null;
  }
}

/**
 * Upsert preferences för en kund. Skapar rad om den saknas, uppdaterar
 * annars (på customer_email UNIQUE). Returnerar hela raden efter op.
 *
 * Updated_at uppdateras automatiskt via customer_prefs_auto_updated_at
 * trigger (migration 20260427000002).
 */
export async function upsertPreferences(
  supabase: SupabaseClientLike,
  email: string,
  patch: PreferencesPatch,
): Promise<CustomerPreferences | null> {
  const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : "";
  if (!isValidEmail(normalizedEmail)) return null;
  try {
    const row = { customer_email: normalizedEmail, ...patch };
    const { data, error } = await supabase
      .from("customer_preferences")
      .upsert(row, { onConflict: "customer_email" })
      .select()
      .single();
    if (error) {
      console.warn("[preferences] upsertPreferences fel:", error.message);
      return null;
    }
    return data as CustomerPreferences;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[preferences] upsertPreferences oväntat fel:", msg);
    return null;
  }
}

/**
 * Sätt en cleaner som favorit. Används av §5.8 preference-learning
 * efter 3+ lyckade bokningar med samma cleaner + rating ≥4.
 *
 * Säkerhet: överskriver existing favorite_cleaner_id. För kombinerad
 * opt-in-flow (användare godkänner explicit), anropa från UI efter
 * samtycke.
 */
export async function setFavoriteCleaner(
  supabase: SupabaseClientLike,
  email: string,
  cleanerId: string,
): Promise<boolean> {
  if (!isValidEmail(email) || !isValidUuid(cleanerId)) return false;
  const result = await upsertPreferences(supabase, email, {
    favorite_cleaner_id: cleanerId,
  });
  return result !== null;
}

/**
 * Lägg till en cleaner på blockerad-listan (t.ex. efter dispute eller
 * kund sa "aldrig igen"). Array-append, duplicering skyddas av DISTINCT.
 *
 * Returnerar true om appendad. False vid fel eller redan blockerad.
 */
export async function addBlockedCleaner(
  supabase: SupabaseClientLike,
  email: string,
  cleanerId: string,
): Promise<boolean> {
  if (!isValidEmail(email) || !isValidUuid(cleanerId)) return false;
  const current = await getPreferences(supabase, email);
  const existing = current?.blocked_cleaner_ids ?? [];
  if (existing.includes(cleanerId)) return false;
  const next = [...existing, cleanerId];
  const result = await upsertPreferences(supabase, email, {
    blocked_cleaner_ids: next,
  });
  return result !== null;
}

/**
 * Ta bort en cleaner från blockerad-listan (t.ex. "tillåt igen").
 * Returnerar true om borttagen, false om inte fanns eller fel.
 */
export async function removeBlockedCleaner(
  supabase: SupabaseClientLike,
  email: string,
  cleanerId: string,
): Promise<boolean> {
  if (!isValidEmail(email) || !isValidUuid(cleanerId)) return false;
  const current = await getPreferences(supabase, email);
  const existing = current?.blocked_cleaner_ids ?? [];
  if (!existing.includes(cleanerId)) return false;
  const next = existing.filter((id) => id !== cleanerId);
  const result = await upsertPreferences(supabase, email, {
    blocked_cleaner_ids: next,
  });
  return result !== null;
}

// ============================================================
// Valideringar (defensive — hindrar ogiltiga calls)
// ============================================================

function isValidEmail(email: string): boolean {
  return typeof email === "string" &&
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUuid(id: string): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
