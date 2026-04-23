# TODO — H7 Farhad-solo rate=100 cleanup

**Öppnat:** 2026-04-23 (session 27c-m4b)
**Prio:** LÅG — ingen prod-impact
**Status:** Flaggad, ej åtgärdad
**Relaterad hygien:** #7 från SESSION-HANDOFF 2026-04-27

## Problem

Cleaner-id `de4bec9b-10e0-40b8-93b3-5262f559822c` har `hourly_rate=100` vilket är testdata. Dyker upp i boka.html cleaner-listan (Farhad Haghighi, solo, Sundbyberg, 100 kr/h).

Även flaggat av Prof-5 commit: "Solo-cleaners-slug: Farhad-solo saknar slug → inte i sitemap."

## Beslut som behövs

Innan radering/uppdatering, Farhad måste avgöra:

1. **Används solo-raden i test-flöden?** (t.ex. Playwright E2E-tester som antar cleaner-id de4bec9b finns)
2. **Ska Farhad ha solo + VD-profil samtidigt?** (idag finns två Farhad: solo `de4bec9b` + VD `605fe29a` i Haghighi Consulting AB)
3. **Rate vid behåll:** 100 kr är testdata — uppdatera till riktigt värde (350 kr default) eller behåll?

## Åtgärdsalternativ

### Alt A: Radera solo-raden helt
```sql
-- BACKUP FIRST
DELETE FROM cleaners WHERE id = 'de4bec9b-10e0-40b8-93b3-5262f559822c';
```
Risk: bryter ev test-flöden. Befintliga bookings med cleaner_id=de4bec9b behåller sig själva (ingen CASCADE), men viewer (min-bokning etc) visar "cleaner saknas".

### Alt B: Uppdatera rate + lägg till slug (behåll som real Farhad)
```sql
UPDATE cleaners SET 
  hourly_rate = 350,
  slug = 'farhad-haghighi-solo',
  status = 'paused'  -- eller 'aktiv' om Farhad vill ta solo-bokningar
WHERE id = 'de4bec9b-10e0-40b8-93b3-5262f559822c';
```
Risk: Farhad visas dubbelt i boka.html (solo + VD-aggregat).

### Alt C: Behåll + pausa
```sql
UPDATE cleaners SET 
  status = 'pausad',
  is_active = false
WHERE id = 'de4bec9b-10e0-40b8-93b3-5262f559822c';
```
Gör så att raden finns för test-referens men inte syns för real customers. Minsta risk.

## Rekommendation

**Alt C** (pausa) — minsta risk, preserverar test-data, tar bort från prod-UI.

Om test-flöden behöver `hourly_rate=100` exakt, lämna det värdet. Bara status-ändring räcker.

## Verifiering efter åtgärd

```sql
-- Ska returnera 1 cleaner (VD) för Farhad i prod-matching
SELECT provider_type, display_name, team_size, min_hourly_rate 
FROM find_nearby_providers(59.3293, 18.0686);
-- Alt C: solo-rad försvinner eftersom find_nearby_providers filtrerar status=aktiv
```

## Regler

- **#27** scope: ej kritisk, skjut till passande commit
- **#31** primärkälla: `SELECT * FROM cleaners WHERE id = 'de4bec9b-...'` för aktuell state innan åtgärd
