# TODO B: RUT Two-Step Payout Pipeline

**Prioritet:** MEDIUM
**Estimat:** 10-15h
**Upptäckt:** 2026-04-22
**Status:** Scope-beslut pending (§1.11 vs Fas 8 vs standalone)

## Problem

Todo A (UI-transparens) löser kommunikations-problemet men systemet
hanterar fortfarande bara första utbetalningen. Andra utbetalningen
sker aldrig automatiskt.

Resultat: städare får del 1 automatiskt, del 2 kräver manuell
Stripe-trigger av admin (troligen Farhad) när RUT-ansökan godkänns.

Fungerar för pilot-volym men skalar inte.

## Lösning (Nivå 2 – full pipeline)

Bygg automatisk andra-utbetalning triggad av RUT-godkännande.

### Komponenter

1. **Schema:**
   - bookings.rut_status ENUM (pending / applied / approved / rejected)
   - bookings.rut_payout_1_transfer_id (Stripe transfer ID, del 1)
   - bookings.rut_payout_2_transfer_id (Stripe transfer ID, del 2)
   - bookings.rut_approved_at TIMESTAMP
   - Migration i supabase/migrations/

2. **Money Layer-utökning:**
   - ny helper: triggerSecondStripeTransfer() i _shared/money.ts
   - utöka calculatePayout() till att returnera {payout_1, payout_2}
   - platform_settings.rut_payout_trigger_mode (manual / auto)

3. **Skatteverket-integration:**
   - Hur triggar vi RUT-godkännande? Manuell admin-knapp först, senare
     API om Skatteverket erbjuder sådant

4. **Edge Function:**
   - ny EF: trigger-rut-payout (admin-triggered initially)
   - senare: webhook från Skatteverkets system om möjligt

5. **Städar-dashboard:**
   - Real-time uppdatering när del 2 trigg:ats
   - Historik: "RUT-utbetalning mottagen" notifikation

6. **Admin-panel:**
   - Lista bokningar med väntande RUT-del-2
   - Knapp "trigger RUT-utbetalning" per bokning
   - Bulk-trigger efter Skatteverket-deklaration

## Scope-alternativ

### Alt A: Standalone §1.11 (Fas 1-tillägg)
- Ligger naturligt efter §1.10
- Tematiskt i Money Layer
- Estimat: 10-15h
- Kan göras när Rafa-piloten har första riktiga bokning

### Alt B: Integrera i Fas 8 (Escrow+Dispute)
- Båda hanterar multi-stegs-utbetalningar
- Fas 8 är vecka 16-21 (långt fram)
- Risk: månader av manuellt arbete med Todo A-baseline

### Alt C: Mini-§1.11 nu (bara andra-transfer-triggern) + full i Fas 8
- 4-6h för minimal "trigger andra utbetalning"-knapp i admin
- Full automation (Skatteverket-webhook etc) i Fas 8
- Pragmatisk mellanväg

## Beroenden

- Todo A KLAR (UI-transparens måste finnas innan pipeline)
- Juridisk: uppdragsavtal reflekterar två-stegs-modellen
- Stripe-accountkonfiguration: kan Connect-account ta emot andra transfer
  på samma ursprungliga betalning? (Kräver research)

## Acceptanskriterier

- [ ] Admin kan trigga del 2 via UI
- [ ] Städaren får notifikation när del 2 anländer
- [ ] booking.rut_status uppdateras korrekt
- [ ] Audit log loggar båda transferrar
- [ ] Stripe-fees hanteras korrekt för andra transfer
- [ ] Tests: både "approved" och "rejected" RUT-paths
