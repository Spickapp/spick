# Sanning: RUT-infrastruktur

**Senaste verifiering:** 2026-04-23 kväll (commit 4400245)
**Status:** AVSTÄNGD — full bygge planerat i Fas 7.5 (ej startad)

## Affärsstatus

RUT-ombud GODKÄNT av Skatteverket 13 april 2026 (SNI 81.210).

RUT-berättigade tjänster: Hemstädning, Storstädning, Flyttstädning, Fönsterputs, Trappstädning.
EJ RUT-berättigade: Kontorsstädning, Byggstädning.

## Teknisk status (låst AVSTÄNGD)

- `SKV_API_KEY` i PROD vault: **TOM** (får ALDRIG sättas innan Fas 7.5 är klar)
- `rut-claim` Edge Function: UNDEPLOYAD från prod (21 apr, commit d901cc1c)
- RUT-trigger i `stripe-webhook`: AVSTÄNGD (rad 518-521, kommentar pekar till audit)
- Rut-claim EF-kod: Arkiverad i `docs/archive/edge-functions/rut-claim/`
- RUT.1 datamodell (21 kolumner): Arkiverad i `docs/archive/migrations/rut-sprint-1-deferred-to-fas-7-5.sql`
- `RUT_PNR_ENCRYPTION_KEY` i PROD vault: Ligger kvar (UUID 86767fda-4dcf-44c6-8869-7e5b9a0145f1). Får EJ raderas förrän Fas 7.5 verifierat vilken nyckel krypterat de 56-tecken-PNR i DB.

## Vad som finns i prod trots avstängning

`bookings.customer_pnr` har 36 rader (varav 11 klartext). Se `docs/sanning/pnr-och-gdpr.md` för full kontext.

**Uppdaterat 2026-04-24 (rule #31 prod-verifiering):**
Tidigare påstående om `rut_amount = total_price` bugg är **föråldrat**. Prod-data + kodverifiering visar:
- `total_price` = kundens nettopris efter RUT-avdrag
- `rut_amount` = RUT-avdraget (50% av arbetskostnad)
- Brutto-arbetskostnad (för SKV) = `total_price + rut_amount`

Exempel: bokning SP-2026-0087 (2026-04-23): total_price=390, rut_amount=390 → arbetskostnad=780 kr ✓ korrekt.

Kvarvarande fix för Fas 7.5: separat kolumn `rut_gross_amount` för explicit arbetskostnad (idag beräknas on-the-fly). Föräldring: ingen blockerare.

## Primärkälla för alla framtida RUT-beslut

1. `docs/audits/2026-04-23-rut-infrastructure-decision.md` — original audit + post-mortem
2. `docs/planning/todo-pnr-infrastructure-2026-04-23.md` — 4-stegs åtgärdsplan
3. Skatteverkets API-spec 2026 — MÅSTE verifieras i §7.5.1 research innan någon bygger något

## Hårda låsningar (bryts ALDRIG utan Farhads uttryckliga samtycke)

- `SKV_API_KEY` får ALDRIG sättas i prod-vault innan Fas 7.5 är klar
- `rut-claim` EF får ALDRIG återdeploy:as utan full refaktor per Fas 7.5
- RUT.1-migrationen i `docs/archive/migrations/` får ALDRIG köras utan validering mot Skatteverkets API-spec 2026
- PNR-fältet i boka.html får INTE aktiveras på nytt utan att kryptering + ärlig text finns

## Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-23 | Fil skapad. Status AVSTÄNGD dokumenterad. | Farhad + Claude session |
