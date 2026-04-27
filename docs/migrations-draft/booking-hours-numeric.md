# Permanent fix: booking_hours INTEGER → NUMERIC

**Status:** DRAFT — kräver manuell review + DROP+CREATE av 2 RPCs (~250 rader vardera).
**Bakgrund:** Prod-incident 2026-04-27 09:12 UTC. Kund kunde inte boka 2.5h-städ pga PostgreSQL "invalid input syntax for type integer: 2.5".

## Quick-fix deployad (commit `629a91e`)
matching-wrapper EF kör `Math.ceil(booking_hours)` innan RPC-anrop. 2.5 → 3.
Säkert (alltid stricter) men förlorar precision i matching.

## Permanent fix — kräver:

### 1. ALTER FUNCTION find_nearby_providers
- Param: `booking_hours integer DEFAULT NULL` → `booking_hours numeric DEFAULT NULL`
- Body-uppdatering på 1 ställe:
  ```sql
  -- FRÅN:
  av.end_time >= (find_nearby_providers.booking_time + make_interval(hours => find_nearby_providers.booking_hours))

  -- TILL (split hours+minutes):
  av.end_time >= (find_nearby_providers.booking_time
    + make_interval(
        hours => floor(find_nearby_providers.booking_hours)::int,
        mins  => round((find_nearby_providers.booking_hours - floor(find_nearby_providers.booking_hours)) * 60)::int
      ))
  ```

### 2. ALTER FUNCTION find_nearby_cleaners (v2)
Samma pattern. Plus extra ställe där `booking_hours * b.hourly_rate` används — fungerar oförändrat med NUMERIC.

### 3. Migration-template
```sql
-- Vid manuell deploy: kör BÅDA i samma transaktion
BEGIN;

-- Hämta nuvarande function-bodies med:
-- SELECT pg_get_functiondef('find_nearby_providers'::regproc);
-- SELECT pg_get_functiondef('find_nearby_cleaners'::regproc);

DROP FUNCTION IF EXISTS find_nearby_providers(...);
CREATE OR REPLACE FUNCTION find_nearby_providers(
  customer_lat numeric, customer_lng numeric,
  booking_date date DEFAULT NULL,
  booking_time time DEFAULT NULL,
  booking_hours numeric DEFAULT NULL,  -- ← CHANGED
  has_pets boolean DEFAULT NULL,
  has_elevator boolean DEFAULT NULL,
  booking_materials text DEFAULT NULL,
  customer_id uuid DEFAULT NULL,
  required_addons text[] DEFAULT NULL
) RETURNS ... AS $$
  -- Kopiera nuvarande body, ändra make_interval-anrop
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS find_nearby_cleaners(...);
-- Samma pattern

COMMIT;
```

### 4. Efter applied — ta bort Math.ceil från matching-wrapper EF
```ts
// Kan tas bort efter DB-migration:
if (typeof body.booking_hours === "number" && !Number.isInteger(body.booking_hours)) {
  body.booking_hours = Math.ceil(body.booking_hours);
}
```

### 5. Verifiering
```bash
curl -X POST .../matching-wrapper -d '{"customer_lat":59.33,"customer_lng":18.06,"booking_hours":2.5,...}'
# Förväntat: 200 OK + cleaners-array (utan Math.ceil-justering)
```

## Risk-analys
- **DROP FUNCTION** = nedtid för matching ~50ms vid swap
- **Body-rewrite** = risk för regression (250 rader, många edge cases)
- **Rekommendation:** kör i quiet-period (03:00 UTC), ha rollback-script redo:
  ```sql
  -- Rollback: re-skapa med booking_hours INTEGER
  -- (kräver att vi sparat originalbody från pg_get_functiondef innan DROP)
  ```

## När prioriteras
- Math.ceil-quick-fix räcker för nu (säkert + funktionellt)
- Permanent fix när matchning-precision blir prio (= cleaners med 2-3h slots inte missas för 2.5h-bokningar)
- Estimerat ~3% förlorade matches idag pga overshoot
