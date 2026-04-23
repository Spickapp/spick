# TODO — log_booking_event silent-failure robusthet

**Öppnat:** 2026-04-23 (under Fas 6.3 smoke-test)
**Prio:** MEDIUM — audit-data-förlust-risk, påverkar Fas 8 PWD-compliance
**Status:** Bug dokumenterad, ej åtgärdad (separat session)

## Bekräftade fakta

Under smoke-test av save-booking-event EF (commit `a35505d`):

| Call | Tid | Response | DB-rad skapades |
|---|---|---|---|
| #1 (via EF) | 11:15:00 | `{"success":true,"logged_at":"..."}` | ❌ **NEJ** |
| #2 (via EF, debug-tag) | 11:20:34 | 200 OK | ✅ ja |
| #3 (direkt anon RPC, probe-tag) | 11:20:47 | 204 No Content | ✅ ja |

**Bug-pattern:** Call #1 (första efter deploy) returnerade success men skrev inte. #2-#3 fungerade fint. 1 av 4 total failure-rate = ~25%.

## Hypoteser (inga verifierade — rule #26)

1. **Cold-start-race:** Första EF-invocation efter deploy kan ha TLS-handshake-timing issue där RPC-POST lyckades HTTP-status men DB-commit aldrig körde
2. **supabase-js error-swallowing:** `rpc()` kan returnera `{data: null, error: null}` för fel som inte klassas som error internt
3. **Supabase transaction isolation:** RPC körs i separate transaction som rullade tillbaka efter HTTP-svar
4. **Network blip:** transient connectivity-issue mid-call

Ingen av dessa är verifierade. Behöver reproducera för att avgöra.

## Konsekvens för audit

**Legitim risk:** Om customer-review failar tyst via betyg.html (samma flöde):
- ratings-tabell får rad (direkt INSERT)
- booking_events får INTE rad
- Fas 8 dispute-process kan ej bevisa review existerar
- EU PWD audit-trail luckor

**Ekonomisk risk:** Låg nu (0 real reviews). Växer med customer-volym.

## Åtgärdsförslag

### Alt A: RETURNING-verifiering (minimum viable fix)

Ändra `log_booking_event` RPC att `RETURNS uuid` (id) istället för `void`:

```sql
CREATE OR REPLACE FUNCTION log_booking_event(
  p_booking_id UUID,
  p_event_type TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_metadata JSONB DEFAULT '{}'
) RETURNS uuid  -- ändrad från void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO booking_events (booking_id, event_type, actor_type, metadata)
  VALUES (p_booking_id, p_event_type, p_actor_type, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
```

Uppdatera `_shared/events.ts::logBookingEvent`:

```ts
const { data, error } = await supabase.rpc("log_booking_event", {...});
if (error) {
  console.warn("[events] RPC-fel:", error.message);
  return false;
}
if (!data) {
  console.error("[events] RPC returned no id — insert failed silently");
  return false;
}
return true;
```

**Estimat:** 30 min migration + 15 min events.ts-update + tester.

### Alt B: Retry-logik med exponential backoff

Lägg till 1x retry vid silent-failure-detection:

```ts
async function logBookingEventWithRetry(...) {
  const first = await tryLog(...);
  if (first === true) return true;
  await new Promise(r => setTimeout(r, 500));
  return await tryLog(...);
}
```

Kombineras med Alt A. **Estimat:** +15 min ovanpå Alt A.

### Alt C: Observability (Fas 10-integration)

Slack-alert när `logBookingEvent` returnerar false mer än X gånger/timme. Kräver Fas 10 notify-dispatcher.

**Rekommendation:** Alt A omedelbart (30-45 min). Alt B + C senare.

## Regler

- **#26** grep-före-edit: verifiera current log_booking_event + alla 7 retrofittade EFs som anropar det
- **#27** scope: bara RPC + events.ts wrapper, inga EF-ändringar (retrofits fortsätter använda samma signature)
- **#30** ej aktuellt (inte regulator, men PÅVERKAR PWD-compliance)
- **#31** primärkälla: migration 20260401181153 för current RPC-definition innan CREATE OR REPLACE

## Beroende

- Blockerar ej omedelbar Fas-progress
- Påverkar Fas 8 audit-trail-kvalitet (måste fixas INNAN Fas 8 live)
- Påverkar Fas 10 observability-mätningar

## Verifiering efter fix

```sql
-- Kör via save-booking-event EF 10 gånger
-- Sen: kolla alla 10 rader syns
SELECT COUNT(*) FROM booking_events
WHERE metadata->>'_probe' = 'robustness-test';
-- Förväntat: 10
```
