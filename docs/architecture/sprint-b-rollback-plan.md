# Sprint B — Rollback-plan

Detta dokument beskriver hur man rullar tillbaka Sprint B-funktionalitet 
om kritiska buggar upptäcks i produktion.

**Sprint B består av 6 dagars arbete (Dag 1-6).** Varje dag kan rullas 
tillbaka oberoende av de andra — de är inte byggda som hårt kopplade.

---

## Dag 1: Stripe Connect Webhook + refresh_account_link

### Symptom som motiverar rollback
- Stripe webhook kraschar och förhindrar att cleaners markeras som `complete`
- refresh_account_link skapar duplikat-Stripe-konton

### Rollback-steg
1. **Stripe Dashboard:** Inaktivera webhooken "Spick Connect webhook"
2. **Git revert:**
   ```
   git revert c23dde1
   git push origin main
   ```
3. Redeploy stripe-connect (för att återställa `onboard_cleaner` utan refresh_account_link-ändringar):
   ```
   npx supabase functions deploy stripe-connect --no-verify-jwt --project-ref urjeijcncsyuletprydy
   ```

### Data-återställning
Ingen data-migration behövs. Befintliga `cleaners.stripe_onboarding_status`-rader är säkra.

---

## Dag 2: DB-migration + commission-fix

### Symptom
- Commission-beräkning blir fel
- Ny kolumn `self_signup` läses av admin.html på fel sätt

### Rollback
1. **EF:**
   ```
   git revert 015031c
   git push origin main
   npx supabase functions deploy admin-approve-cleaner --project-ref urjeijcncsyuletprydy
   ```
2. **DB:** Kolumnerna kan stanna kvar (nullable, inga constraints). Om strikt rollback krävs:
   ```sql
   ALTER TABLE companies DROP COLUMN IF EXISTS self_signup;
   ALTER TABLE companies DROP COLUMN IF EXISTS onboarding_status;
   ALTER TABLE companies DROP COLUMN IF EXISTS logo_url;
   ALTER TABLE companies DROP COLUMN IF EXISTS onboarding_completed_at;
   ALTER TABLE companies DROP COLUMN IF EXISTS updated_at;
   ALTER TABLE cleaner_applications DROP COLUMN IF EXISTS invited_via_magic_code;
   ALTER TABLE cleaner_applications DROP COLUMN IF EXISTS invited_phone;
   ALTER TABLE cleaner_applications DROP COLUMN IF EXISTS bankid_verified_at;
   ALTER TABLE cleaner_applications DROP COLUMN IF EXISTS bankid_personnummer_hash;
   DROP FUNCTION IF EXISTS get_company_onboarding_status(uuid);
   UPDATE companies SET commission_rate = 17 WHERE commission_rate = 12 AND name IN (/* original list */);
   ```

---

## Dag 3: Self-service företagsregistrering

### Symptom
- company-self-signup skapar inkompleta rader i DB
- bli-foretag.html eller registrera-foretag.html visar fel data

### Rollback
1. **Stäng av publik EF:**
   ```
   npx supabase functions deploy company-self-signup --no-verify-jwt --project-ref urjeijcncsyuletprydy --force
   ```
   (Eller radera EF:n helt i Supabase Dashboard)
2. **Git revert:**
   ```
   git revert 52fa206 93eca15 e43aa40
   git push origin main
   ```
3. **Ta bort nav-länk "Bli partner"** för att förhindra nya registreringar
4. **Maila befintliga self-signup-användare** om nedtagningen (hämta lista):
   ```sql
   SELECT c.name, co.email, co.full_name 
     FROM companies c 
     JOIN cleaners co ON c.owner_cleaner_id = co.id 
    WHERE c.self_signup = true;
   ```

### Data-rensning (aggressiv — bara om nödvändigt)
```sql
BEGIN;
-- Lista alla self-signup-företag
SELECT id, name, created_at FROM companies WHERE self_signup = true;

-- Om du vill radera ALLA:
UPDATE companies SET owner_cleaner_id = NULL WHERE self_signup = true;
DELETE FROM cleaner_applications 
 WHERE email IN (SELECT email FROM cleaners WHERE company_id IN (SELECT id FROM companies WHERE self_signup = true));
DELETE FROM cleaners WHERE company_id IN (SELECT id FROM companies WHERE self_signup = true);
DELETE FROM companies WHERE self_signup = true;
COMMIT;
```

---

## Dag 4: Team-invitations

### Symptom
- company-invite-member skickar SMS men cleaner_applications skapas inte
- join-team.html kraschar eller kan inte ladda invitation
- company-accept-invite skapar dubletter

### Rollback
1. **EFs:**
   ```
   git revert 951cccc
   git push origin main
   ```
2. **Publik URL-skyddshjälp:** Om join-team.html läckt till publika endpoint, ta bort:
   ```
   git rm join-team.html
   git commit -m "temporarily remove join-team.html during rollback"
   git push origin main
   ```
3. **Befintliga invites:** Gå till DB och markera pending invites som expired:
   ```sql
   UPDATE cleaner_applications 
      SET status = 'expired' 
    WHERE status = 'invited' 
      AND invited_by_company_id IS NOT NULL;
   ```

---

## Dag 5: Admin approve/reject

### Symptom
- admin-approve-company sätter fel värden
- admin.html-sektionen kraschar

### Rollback
```
git revert b3fd431
git push origin main
```

Inga data-ändringar behövs — de uppdaterar bara `onboarding_status` på befintliga företag.

**Manuell kompensation om felaktiga approvals redan gjorts:**
```sql
-- Gör företag pending igen
UPDATE companies 
   SET onboarding_status = 'pending_admin_verify', 
       onboarding_completed_at = NULL
 WHERE id IN ('<list-of-wrongly-approved-ids>');
```

---

## Dag 6: Cron + expire-invitations

### Symptom
- poll-stripe-onboarding-status spammer Stripe API
- expire-team-invitations markerar aktiva invites som expired

### Rollback
1. **Unschedule cron-jobb OMEDELBART:**
   ```sql
   SELECT cron.unschedule('poll-stripe-onboarding-status');
   SELECT cron.unschedule('expire-team-invitations');
   ```
2. **Git revert:**
   ```
   git revert <dag-6-commit-hash>
   git push origin main
   ```
3. **Återställ felaktigt expirerade invites:**
   ```sql
   UPDATE cleaner_applications 
      SET status = 'invited', 
          onboarding_phase = 'invited'
    WHERE status = 'expired' 
      AND created_at > now() - interval '14 days';
   ```

---

## Globalt "nödstopp" — hela Sprint B

Om alla 6 dagar måste rullas tillbaka samtidigt (säker produktion ska återställas):

```bash
# 1. Unschedule ALLA nya cron-jobb
psql <connection-string> -c "SELECT cron.unschedule('poll-stripe-onboarding-status'); SELECT cron.unschedule('expire-team-invitations');"

# 2. Revert alla Sprint B-commits (LÄS listan först!)
git log --oneline --since="2026-04-19 00:00" --until="2026-04-20 23:59" -- supabase/functions/ admin.html js/components.js bli-foretag.html registrera-foretag.html join-team.html foretag-dashboard.html

# 3. Revert i omvänd ordning (nyaste först)
git revert <dag-6-hash> <b3fd431> <951cccc> <52fa206> <93eca15> <e43aa40> <565afd4> <015031c> <c23dde1>

# 4. Redeploy alla berörda EFs
for fn in stripe-connect stripe-connect-webhook admin-approve-cleaner admin-create-company; do
  npx supabase functions deploy $fn --no-verify-jwt --project-ref urjeijcncsyuletprydy
done

# 5. Ta bort nya EFs
for fn in company-self-signup company-invite-member company-accept-invite admin-approve-company admin-reject-company poll-stripe-onboarding-status expire-team-invitations; do
  # Radera i Supabase Dashboard > Edge Functions > [fn] > Delete
done

# 6. Push
git push origin main
```

---

## Monitoring

Efter Sprint B-deploy — övervaka dessa i 48 timmar:

1. **Supabase logs:** Leta efter errors i nya EFs
   - https://supabase.com/dashboard/project/urjeijcncsyuletprydy/functions/*/logs
2. **Stripe Dashboard:** Events-tab — kolla att webhookar levereras (200 OK)
3. **DB query för stale invites:**
   ```sql
   SELECT COUNT(*) FROM cleaner_applications 
    WHERE status = 'invited' AND created_at < now() - interval '8 days';
   -- Borde vara 0 om expire-team-invitations körs korrekt
   ```
4. **DB query för pending companies:**
   ```sql
   SELECT COUNT(*) AS pending, MAX(created_at) AS oldest FROM companies 
    WHERE onboarding_status IN ('pending_stripe','pending_team','pending_admin_verify');
   -- Om oldest > 7d: admin har glömt att granska
   ```

---

## Relaterade dokument

- `docs/architecture/00-design-sprint-b.md` — Sprint B design-spec
- `docs/architecture/sprint-b-e2e-test-checklist.md` — Manual test-scenarios
- `docs/architecture/sprint-b-summary.md` — Slutrapport Sprint B
