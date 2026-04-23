# TODO — Rate-limit-migration 20260327300001 inte applicerad i prod

**Öppnat:** 2026-04-23 (under smoke-test av save-booking-event rate-limit)
**Prio:** HÖG — säkerhets-gap, 4 RLS-policies antas skydda men gör det INTE
**Status:** Rot-orsak identifierad, behöver deploy-beslut

## Fakta (rule #31 primärkälla)

Smoke-test mot `check_rate_limit` RPC:
```
curl POST /rest/v1/rpc/check_rate_limit ...
→ {"code":"PGRST202","message":"Could not find the function
   public.check_rate_limit(p_key, p_max, p_window_minutes) in the
   schema cache"}
```

RPC finns inte i prod. Migration `20260327300001_rate_limiting_email_queue.sql` (i repo) har inte körts.

## Påverkan

### 1. save-booking-event rate-limit är NO-OP

Commit `60330ed` adderar `check_rate_limit`-anrop i save-booking-event med fail-open-logik vid RPC-error. Eftersom RPC saknas → `rlErr` sätts → fail-open → **alla requests passerar**.

Smoke-test: 25 anrop i sekvens = 25/25 success (förväntat 20/25).

### 2. RLS-policies på bookings/applications/reviews/messages antas fungera men gör inte det

Migration 20260327300001 skapar 4 policies som referensar `check_rate_limit`. Om migration inte är applicerad → dessa policies finns INTE → default anon INSERT-beteende (andra policies från tidigare migrations).

**Kräver verifiering:**
```sql
-- Kör i Studio SQL
SELECT tablename, policyname
FROM pg_policies
WHERE policyname LIKE 'Rate limited%';
-- Förväntat om migration applicerad: 4 rader
-- Om 0 rader: migration INTE applicerad
```

## Åtgärds-alternativ

### Alt A: Applicera migration 20260327300001 i prod (REKOMMENDERAD)

**Steg:**
1. Kör hela innehåll av `supabase/migrations/20260327300001_rate_limiting_email_queue.sql` i Studio SQL
2. Migration gör:
   - CREATE TABLE rate_limits
   - CREATE FUNCTION check_rate_limit
   - CREATE FUNCTION cleanup_rate_limits
   - DROP POLICY "Public insert X" (4 tabeller)
   - CREATE POLICY "Rate limited insert X" (4 tabeller)
   - ALTER TABLE rate_limits ENABLE RLS

**Risk:** Låg om existing policies "Public insert X" inte har beroenden. Hög om någon anon-insert-path förlitar sig på existing policies med annan logik än check_rate_limit.

**Verifiering före apply:**
```sql
-- Lista existing policies på dessa tabeller
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('bookings','cleaner_applications','reviews','messages')
  AND cmd = 'INSERT';
```

Om flera policies finns per tabell → förstå vilka som DROP:as + vilka som består.

### Alt B: Ny minimal migration BARA för save-booking-event

Skapa `check_rate_limit` + `rate_limits` utan RLS-policy-ändringar:

```sql
-- supabase/migrations/20260427000004_fas6_rate_limits_minimal.sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT, p_max INT DEFAULT 10, p_window_minutes INT DEFAULT 60
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
... (identisk med 20260327300001 rad 15-33)
$$;

GRANT EXECUTE ON FUNCTION check_rate_limit(text, int, int) TO anon, authenticated, service_role;
```

**Risk:** Rule #28 (single source) — duplicerar existing migration-innehåll. Om någon senare applicerar 20260327300001 får vi konflikt (CREATE OR REPLACE hanterar funktion, men TABLE IF NOT EXISTS hanterar tabell).

### Alt C: Rollback rate-limit-kod (ärlig)

Revertera `60330ed`-delen som lägger till rate-limit i save-booking-event. Erkänn att infrastruktur saknas.

**Risk:** Säkerhets-gap förblir. save-booking-event öppet för spam.

## Rekommendation

**Alt A** är bästa långsiktiga vägen — aktiverar säkerhet på 4 tabeller + save-booking-event samtidigt. Farhad behöver:

1. Kör verifierings-SQL ovan för att se existing policies
2. Om OK (inga kritiska existing policies som skulle brytas):
   - Kör hela 20260327300001-migrationen i Studio
   - Smoke-test save-booking-event (25 calls, förvänta 429 efter 20)
3. Om policies ser kritiska ut:
   - Går till Alt B (separat minimal migration)

## Lärdom (rule #31-förstärkning)

Mitt antagande att migration-fil = prod-deployad är **3:e rule #31-brottet denna session**. Samma pattern som:
- `bookings.company_id` antaget (kolumn saknas)
- `subscriptions.favorite_cleaner_email` antaget (schema-drift)
- `check_rate_limit` antaget (migration ej applicerad)

**Framtida regel:** Innan ANY RPC-call i ny kod, verifiera via:
```bash
curl -X POST .../rest/v1/rpc/<function_name> -d '{}'
# Förvänta: antingen 200/204 (RPC finns) eller PGRST202 (finns ej)
```

Uppdatera CLAUDE.md rule #31-sektion med denna verifieringspraxis.

## Regler för denna TODO

- **#26** grep (verifierat migration-filen existerar i repo + alla callers av check_rate_limit)
- **#27** scope (TODO only, 0 kod-ändringar)
- **#28** flaggat Alt B som rule #28-brott (duplicering)
- **#31** primärkälla (PGRST202-response är ovedersägligt bevis att RPC saknas)
