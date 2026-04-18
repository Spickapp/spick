# Solid Service-teamet är osynligt för kunder tills onboarding → aktiv

**Datum upptäckt:** 2026-04-18 kväll (under Fas 0.5-verifiering)
**Berör:** Zivar-möte söndag 19 april 12:30
**Status:** Dokumenterat, åtgärd på mötet

---

## Symptom

Solid Service Sverige AB:s 5 cleaners (Zivar + 4 team) är alla `status='onboarding'`. I boka.html filter-flöde ([rad 1945](../../boka.html:1945)) blockerar `info.status !== 'aktiv'` alla icke-aktiva cleaners. Zivar syns inte för kunder oavsett Stripe-status.

---

## Rotorsak (verifierad via kod + SQL)

[boka.html:1921-1955](../../boka.html:1921) implementerar "Payment readiness"-filter som kräver:

1. `info.status === 'aktiv'` (annars bort)
2. För company-cleaner: VD:ns `stripe_onboarding_status === 'complete'`
3. För solo: egen `stripe_onboarding_status === 'complete'`

Dessutom returnerar RPC `find_nearby_cleaners` bara cleaners där `company_id IS NULL OR is_company_owner = true`. Team-medlemmar (Dildora / Nasiba / Nilufar / Odilov) är alltid osynliga för kunder i employed-modellen — by design, kund bokar VD som delegerar internt.

---

## Konsekvens för Zivar-mötet

Zivar måste genomgå TVÅ steg på mötet för att bli synlig för kunder:

1. **BankID → Stripe Connect** → `stripe_onboarding_status = 'complete'`
2. **Admin-åtgärd:** ändra Zivars `cleaners.status` från `onboarding` till `aktiv` (manuellt eller via admin.html)

Teamet förblir osynligt oavsett status (filter i RPC). Detta är korrekt för `employment_model='employed'`.

---

## SQL som admin kör efter Stripe Connect på mötet

```sql
UPDATE cleaners
   SET status = 'aktiv'
 WHERE id = '0bf8ec72-3560-421f-a7a5-acc87b50bc30';

-- Verifiera att hon nu är matchbar:
SELECT id, full_name, status, stripe_onboarding_status, home_lat, home_lng
  FROM cleaners
 WHERE id = '0bf8ec72-3560-421f-a7a5-acc87b50bc30';
```

---

## Backlog-flagga

[boka.html:1945](../../boka.html:1945)-filtret är strikt. Om vi vill låta `onboarding`-cleaners visas under en "soft-launch"-period (med en "Ny städare"-badge) behöver detta filter refaktoreras. Flaggas för Fas 1 eller senare.
