// _shared/slot-holds.ts — Fas 5 §5.4.2
// ═══════════════════════════════════════════════════════════════
// Helpers för subscription_slot_holds (soft-reservation av städares
// återkommande veckoslots). Används av:
//   - setup-subscription (skapa hold vid new subscription)
//   - customer-subscription-manage (pause/resume/update-time/delete)
//   - auto-rebook (conflict-check innan skapa booking)
//
// Primärkälla: docs/planning/spick-arkitekturplan-v3.md §5.4
// Schema: supabase/migrations/20260424000001_fas5_subscription_slot_holds.sql
// ═══════════════════════════════════════════════════════════════

export type SlotHoldClient = {
  from: (table: string) => {
    select: (cols?: string) => unknown;
    insert: (data: unknown) => unknown;
    update: (data: unknown) => unknown;
    delete: () => unknown;
    upsert: (data: unknown, opts?: unknown) => unknown;
  };
};

export interface SubscriptionSlotInput {
  subscription_id: string;
  cleaner_id: string;
  weekday: number;          // 1-7 (måndag=1)
  start_time: string;       // HH:MM eller HH:MM:SS
  duration_hours: number;   // 1-24
}

export interface SlotConflict {
  id: string;
  subscription_id: string;
  cleaner_id: string;
  weekday: number;
  start_time: string;
  duration_hours: number;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Skapa hold för new subscription. Idempotent via UNIQUE(subscription_id).
 * Om hold redan finns: uppdatera (t.ex. efter change-time).
 */
export async function upsertHold(
  sb: any,
  input: SubscriptionSlotInput,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("subscription_slot_holds")
    .upsert(
      {
        subscription_id: input.subscription_id,
        cleaner_id: input.cleaner_id,
        weekday: input.weekday,
        start_time: input.start_time,
        duration_hours: input.duration_hours,
        active: true,
        paused_at: null,
      },
      { onConflict: "subscription_id" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function pauseHold(sb: any, subscription_id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("subscription_slot_holds")
    .update({ active: false, paused_at: new Date().toISOString() })
    .eq("subscription_id", subscription_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resumeHold(sb: any, subscription_id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("subscription_slot_holds")
    .update({ active: true, paused_at: null })
    .eq("subscription_id", subscription_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteHold(sb: any, subscription_id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("subscription_slot_holds")
    .delete()
    .eq("subscription_id", subscription_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateHoldTime(
  sb: any,
  subscription_id: string,
  start_time: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("subscription_slot_holds")
    .update({ start_time })
    .eq("subscription_id", subscription_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Kolla om någon annan aktiv subscription redan har hold på samma
 * (cleaner, weekday) med överlappande tid.
 *
 * Returnerar första krocken (om flera finns). Null = ingen konflikt.
 * excludeSubscriptionId filtrerar bort den egna subscriptionen (vid
 * resume/change-time-check).
 */
export async function findSlotConflict(
  sb: any,
  params: {
    cleaner_id: string;
    weekday: number;
    start_time: string;
    duration_hours: number;
    exclude_subscription_id?: string;
  },
): Promise<SlotConflict | null> {
  const query = sb
    .from("subscription_slot_holds")
    .select("id, subscription_id, cleaner_id, weekday, start_time, duration_hours")
    .eq("cleaner_id", params.cleaner_id)
    .eq("weekday", params.weekday)
    .eq("active", true);

  const { data, error } = await query;
  if (error || !data) return null;

  const startMin = timeToMinutes(params.start_time);
  const endMin   = startMin + Math.round(params.duration_hours * 60);

  for (const row of data as SlotConflict[]) {
    if (params.exclude_subscription_id && row.subscription_id === params.exclude_subscription_id) continue;
    const rowStart = timeToMinutes(row.start_time);
    const rowEnd   = rowStart + Math.round(row.duration_hours * 60);
    if (rowStart < endMin && rowEnd > startMin) return row;
  }
  return null;
}

/**
 * Hitta all-slots för en städare (för cleaner-dashboard-visning framöver).
 * Returnerar bara aktiva holds.
 */
export async function listCleanerHolds(
  sb: any,
  cleaner_id: string,
): Promise<SlotConflict[]> {
  const { data, error } = await sb
    .from("subscription_slot_holds")
    .select("id, subscription_id, cleaner_id, weekday, start_time, duration_hours")
    .eq("cleaner_id", cleaner_id)
    .eq("active", true)
    .order("weekday")
    .order("start_time");
  if (error || !data) return [];
  return data as SlotConflict[];
}
