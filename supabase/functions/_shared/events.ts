// supabase/functions/_shared/events.ts
// ──────────────────────────────────────────────────────────────────
// Fas 6.2 — Central events-helper för booking_events-tabellen.
//
// PRIMÄRKÄLLA:
//   - docs/planning/spick-arkitekturplan-v3.md §6 (Event-system)
//   - docs/architecture/event-schema.md (canonical event taxonomy)
//   - supabase/migrations/20260401181153_sprint1_missing_tables.sql:92-123
//     (tabell-definition + log_booking_event RPC signatur)
//
// SYFTE:
//   Alla booking-relaterade events i Spick MÅSTE loggas via denna fil.
//   Canonical event-types är typ-unionen `BookingEventType` nedan.
//   Retrofit av befintliga EFs sker i §6.3 (separat sprint).
//
// STATUS: Skelett (Fas 6.2, 2026-04-23). Ingen retrofit — bara helpers +
// typer. booking-create:528 loggar redan `booking_created` via direkt
// rpc-anrop och ska migreras till denna helper i §6.3.
//
// REGLER: #26 grep-före-edit, #27 scope (bara helper + typer),
// #28 single source (canonical event_types bara här), #31 primärkälla
// (RPC-signatur + tabell-schema verifierat via migration-fil).
// ──────────────────────────────────────────────────────────────────

// Minimal client-interface istället för `SupabaseClient`-import.
// Förebygger type-mismatch mellan EF:er som importerar supabase-js@2
// (latest) vs @2.49.4 (pinned). Eftersom denna helper bara behöver
// .rpc() räcker en tunn definition som alla versions är kompatibla med.
// (Pre-existing hygien-flag H5 dokumenterade samma issue mellan
// resolvePricing och booking-create.)
// rpc()-returtypen är `any` eftersom supabase-js faktiskt returnerar en
// PostgrestFilterBuilder (thenable) som först vid await resolverar till
// { data, error }. Att striktyp:a skulle bryta mot verklig supabase-js-
// signatur. Konsumenter av helpern behöver inte se den komplexiteten.
// deno-lint-ignore no-explicit-any
export interface SupabaseRpcClient {
  rpc: (name: string, args?: Record<string, unknown>) => any;
}

// ============================================================
// Canonical event-types
// ============================================================

/**
 * Alla giltiga event_type-strings för booking_events-tabellen.
 *
 * VIKTIG: Nya events läggs till HÄR och nedan i EVENT_METADATA.
 * Alla EFs som loggar events MÅSTE använda denna typ (inte en
 * god-förhoppning-sträng).
 *
 * Kategorisering:
 *   - Livscykel: booking_created → cleaner_assigned → checkin → checkout →
 *     completed
 *   - Betalning: payment_received, payment_captured (escrow-Fas 8),
 *     escrow_released (Fas 8), refund_issued
 *   - Avbrott: cancelled_by_customer, cancelled_by_cleaner,
 *     cancelled_by_admin, noshow_reported
 *   - Dispute (Fas 8): dispute_opened, dispute_cleaner_responded,
 *     dispute_resolved
 *   - Kvalitet: review_submitted
 *   - Recurring (Fas 5): recurring_generated, recurring_skipped,
 *     recurring_paused, recurring_resumed, recurring_cancelled
 *   - Ändring: schedule_changed, cleaner_reassigned, cleaner_invited
 */
export type BookingEventType =
  // Livscykel
  | "booking_created"
  | "cleaner_assigned"
  | "cleaner_reassigned"
  | "cleaner_invited"        // team-invite (booking_team, Fas-Model-C)
  | "cleaner_declined"        // cleaner avvisar
  | "checkin"
  | "checkout"
  | "completed"
  // Betalning (Fas 1 + Fas 8)
  | "payment_received"        // Stripe charge.succeeded
  | "payment_captured"        // separate charges Fas 8
  | "escrow_held"             // Fas 8
  | "escrow_released"         // Fas 8: attest eller auto-release
  | "refund_issued"           // unified refund-EF
  // Avbrott
  | "cancelled_by_customer"
  | "cancelled_by_cleaner"
  | "cancelled_by_admin"
  | "noshow_reported"         // noshow-refund-EF
  // Dispute (Fas 8)
  | "dispute_opened"
  | "dispute_cleaner_responded"
  | "dispute_resolved"
  // Kvalitet
  | "review_submitted"        // betyg.html → ratings insert
  // Recurring (Fas 5)
  | "recurring_generated"
  | "recurring_skipped"
  | "recurring_paused"
  | "recurring_resumed"
  | "recurring_cancelled"
  // Ändring
  | "schedule_changed";

/**
 * Vem som utlöste eventet. `system` = cron/trigger/webhook utan explicit
 * user-context.
 */
export type ActorType =
  | "system"
  | "customer"
  | "cleaner"
  | "admin"
  | "company_owner";

// ============================================================
// Event-metadata-schema (referens för retrofit)
// ============================================================

/**
 * Förväntade metadata-nycklar per event-type. Strikt enforcement sker
 * INTE i runtime (metadata-fältet är öppen JSONB), men retrofit-EFs bör
 * följa dessa så event-timeline-UI kan rendera konsekvent.
 *
 * Regel #28: denna lista är single source of truth. Uppdateras när nya
 * events läggs till i BookingEventType ovan.
 */
export const EVENT_METADATA: Record<BookingEventType, string[]> = {
  // Livscykel
  booking_created: ["service", "total_price", "cleaner_id", "company_id"],
  cleaner_assigned: ["cleaner_id", "assigned_by", "delegation_route"],
  cleaner_reassigned: ["from_cleaner_id", "to_cleaner_id", "reason"],
  cleaner_invited: ["invited_cleaner_id", "invited_by_cleaner_id"],
  cleaner_declined: ["cleaner_id", "reason"],
  checkin: ["cleaner_id", "lat", "lng", "checkin_time"],
  checkout: ["cleaner_id", "checkout_time", "duration_minutes"],
  completed: ["cleaner_id", "completed_at"],
  // Betalning
  payment_received: ["stripe_payment_intent_id", "amount", "currency"],
  payment_captured: ["stripe_payment_intent_id", "amount"],
  escrow_held: ["stripe_payment_intent_id", "release_at"],
  escrow_released: ["stripe_transfer_id", "amount_to_cleaner", "release_reason"],
  refund_issued: ["stripe_refund_id", "amount", "reason", "initiated_by"],
  // Avbrott
  cancelled_by_customer: ["reason", "cancelled_at"],
  cancelled_by_cleaner: ["cleaner_id", "reason", "cancelled_at"],
  cancelled_by_admin: ["admin_id", "reason"],
  noshow_reported: ["reported_by", "evidence_urls"],
  // Dispute (Fas 8)
  dispute_opened: ["dispute_id", "reason", "evidence_count"],
  dispute_cleaner_responded: ["dispute_id", "response", "evidence_count"],
  dispute_resolved: ["dispute_id", "resolution", "refund_amount"],
  // Kvalitet
  review_submitted: ["rating", "cleaner_id", "has_comment"],
  // Recurring (Fas 5)
  recurring_generated: ["subscription_id", "series_position"],
  recurring_skipped: ["subscription_id", "skip_reason"],
  recurring_paused: ["subscription_id", "paused_by"],
  recurring_resumed: ["subscription_id", "resumed_by"],
  recurring_cancelled: ["subscription_id", "cancelled_by", "reason"],
  // Ändring
  schedule_changed: ["from_date", "from_time", "to_date", "to_time", "changed_by"],
};

// ============================================================
// Logging-wrapper
// ============================================================

/**
 * Logga ett event till booking_events-tabellen via log_booking_event RPC.
 *
 * FÖREDRAS över direkta supabase.from('booking_events').insert() eller
 * rpc('log_booking_event',...) så canonical event-types enforcas via
 * TypeScript compile-time.
 *
 * ERROR-HANDLING: Event-logging är best-effort. Om det fallerar ska EF-
 * logiken fortsätta (events är audit, inte kritisk path). Loggar warn
 * till konsol men kastar aldrig. EF-caller behöver INTE try/catch:a.
 *
 * @param supabase - Supabase-klient (service_role eller auth user med
 *                   skrivrättigheter till booking_events)
 * @param bookingId - UUID för bokningen
 * @param eventType - En canonical BookingEventType
 * @param options - Optional actor_type + metadata
 * @returns true om RPC lyckades, false vid fel (loggat till konsol)
 */
export async function logBookingEvent(
  supabase: SupabaseRpcClient,
  bookingId: string,
  eventType: BookingEventType,
  options: {
    actorType?: ActorType;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<boolean> {
  const { actorType = "system", metadata = {} } = options;

  // Minimal UUID-validering (undviker oavsiktliga bad-string-INSERTs).
  // Full validering sker via DB-schemat (booking_id UUID NOT NULL).
  if (!bookingId || typeof bookingId !== "string" || bookingId.length < 32) {
    console.warn(
      "[events] logBookingEvent: ogiltigt booking_id, hoppar över log",
      { bookingId, eventType },
    );
    return false;
  }

  try {
    const { data, error } = await supabase.rpc("log_booking_event", {
      p_booking_id: bookingId,
      p_event_type: eventType,
      p_actor_type: actorType,
      p_metadata: metadata,
    });

    if (error) {
      console.warn("[events] log_booking_event RPC-fel:", {
        bookingId,
        eventType,
        error: error.message,
      });
      return false;
    }

    // Fas 6.3 robustness (migration 20260427000003): RPC returnerar nu
    // uuid av insertad rad. Om data är null/undefined → INSERT failade
    // tyst (silent-failure-bug från d701d7b). Returnera false så callers
    // kan detektera + eventuellt retry.
    if (!data) {
      console.error("[events] log_booking_event returnerade no id — insert failade tyst", {
        bookingId,
        eventType,
      });
      return false;
    }

    return true;
  } catch (e) {
    // Nätverksfel, timeout, etc — best-effort, svälj
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[events] logBookingEvent oväntat fel:", {
      bookingId,
      eventType,
      error: msg,
    });
    return false;
  }
}

/**
 * Hjälp-funktion: bygg metadata med både arbiträra fält + event-type-
 * specifik subset. Används i retrofit-EFs för typ-hjälp.
 *
 * Exempel:
 *   await logBookingEvent(supabase, bid, "review_submitted", {
 *     actorType: "customer",
 *     metadata: buildEventMetadata("review_submitted", {
 *       rating: 5,
 *       cleaner_id: "abc-...",
 *       has_comment: true,
 *     }),
 *   });
 */
export function buildEventMetadata<T extends Record<string, unknown>>(
  eventType: BookingEventType,
  fields: T,
): T {
  // Framtida utvidgning: runtime-validering mot EVENT_METADATA[eventType].
  // Idag är detta en no-op som bara återger inputen — syftet är att ge
  // call-siten en tydlig compile-time-länk till canonical event-namnet.
  void eventType;
  return fields;
}
