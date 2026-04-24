-- Sprint F-RBAC (2026-04-28): cleaners.company_role for ledningshierarki
-- Primarkalla: projektchef-rapport 2026-04-28 (skalbarhet fraga #5 + #10)
--
-- Motivation: idag finns bara is_company_owner boolean - kan inte
-- ha arbetsledare mellan VD och manig. Nya company_role:
--   - 'owner' = VD/agare (1 per company, = is_company_owner=true)
--   - 'manager' = arbetsledare (flera mojliga per company)
--   - 'member' = vanlig anstalld (standard)
-- Backfill setter existing data via is_company_owner.
--
-- RLS-rights-matrix enforcement kommer i separat sprint. Denna migration
-- ar schema-only + backfill + admin-UI-bindning (dropdown).
--
-- Studio-kompatibel: inget BEGIN/COMMIT, ingen DO-block, ingen unicode.
-- Verifierat mot prod 2026-04-28: cleaners.company_role saknas (42703).

-- 1. Lagg till kolumn med CHECK-constraint
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS company_role text DEFAULT 'member'
    CHECK (company_role IN ('owner','manager','member'));

COMMENT ON COLUMN public.cleaners.company_role IS
  'Sprint F-RBAC: roll inom foretag. owner=VD, manager=arbetsledare, member=anstalld. Backfill: is_company_owner=true -> owner, annars member. Owner-role ar alltid 1:1 med is_company_owner=true (trigger enforce:ar detta). RLS-rights-matrix byggs separat.';

-- 2. Backfill: existing cleaners med is_company_owner=true -> owner
UPDATE public.cleaners
   SET company_role = 'owner'
 WHERE is_company_owner = true
   AND (company_role IS NULL OR company_role = 'member');

-- 3. Sync-trigger: om is_company_owner andras -> company_role synkas.
-- Detta halsen ihop existing boolean-kod med ny role-kolumn. Nya EFs/UIs
-- skriver till company_role direkt, men framtida flows som satter
-- is_company_owner fortsatter fungera.
CREATE OR REPLACE FUNCTION public.tg_cleaners_sync_company_role()
RETURNS trigger AS $fn$
BEGIN
  -- Om is_company_owner satts till true och role ar 'member' -> flytta till owner
  IF NEW.is_company_owner = true AND (NEW.company_role IS NULL OR NEW.company_role = 'member') THEN
    NEW.company_role := 'owner';
  END IF;
  -- Om is_company_owner satts till false och role ar 'owner' -> degradera till member
  -- (medveten default: arbetsledare-roll maste satta explicit)
  IF NEW.is_company_owner = false AND NEW.company_role = 'owner' THEN
    NEW.company_role := 'member';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleaners_sync_company_role ON public.cleaners;
CREATE TRIGGER trg_cleaners_sync_company_role
  BEFORE INSERT OR UPDATE OF is_company_owner, company_role ON public.cleaners
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_cleaners_sync_company_role();

-- 4. Index for role-lookup per company (for arbetsledare-listor)
CREATE INDEX IF NOT EXISTS idx_cleaners_company_role
  ON public.cleaners(company_id, company_role)
  WHERE company_id IS NOT NULL;
