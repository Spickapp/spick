# TODO A: RUT Notification Transparency

**Prioritet:** HÖG (pre-Rafa-pilot)
**Estimat:** 2-4h
**Upptäckt:** 2026-04-22
**Status:** Scope klart, bygg pending

## Problem

Notifikationen till städaren visar bara "Din intjäning 83 kr" för en
RUT-berättigad hemstädning där totala intjäningen blir ~166 kr
(88 kr nu + 88 kr efter RUT-godkännande).

Detta är missvisande. Städare kan:
- Acceptera bokningar på falsk premiss
- Bli missnöjda med "liten utbetalning"
- Hävda "jag visste inte" vid framtida tvister

## Lösning (Nivå 1 – UI/kommunikation)

Ändra notifikationer att visa båda belopp + förklaring.

### Föreslaget format

```
Din intjäning: 83 kr nu + ~83 kr efter RUT
Totalt förväntat: ~166 kr

Den andra utbetalningen kommer när Skatteverket
godkänt RUT-ansökan. Om ansökan avslås utgår ingen
andra utbetalning.
```

### Platser att uppdatera

- Städarens e-post vid bokningsförfrågan (cleaner-booking-notification EF)
- Push-notifikation (om finns)
- Städarens dashboard (väntande bokningar)
- Stadare-uppdrag.html (bokningsdetaljer)

### Kräver verifiering innan bygg

1. Vilka notifikations-EFs existerar? Grep: `Select-String -Path "supabase/functions/**/*.ts" -Pattern "intjäning|earnings"`
2. Visar de total_price eller cleaner_payout redan? Vilken fältinformation används?
3. Hur räknas "del 1 nu" vs "del 2 senare" från booking-raden?
   - Del 1 = amount Stripe faktiskt tog = total_price × (1 - rut_pct/100)
   - Del 2 = RUT-beloppet = total_price × rut_pct/100
   - Städarens andel av varje = × 0.88 (eller kommission från platform_settings)

## Scope

Vad ingår:
- UI-uppdateringar (e-post + dashboard + uppdragssida)
- Beräknings-helper i frontend/EF för "del 1 + del 2"-format
- INGEN arkitekturändring av Money Layer
- INGEN andra Stripe-transfer (det är Todo B)

Vad ingår INTE:
- Full RUT-pipeline (Todo B)
- Ändring av Stripe-betalnings-flöde
- RUT-status-tracking (Todo B)
- Uppdragsavtal juridisk-uppdatering (separat uppgift)

## Uppdragsavtal-check

Innan bygg: verifiera att uppdragsavtalet (commit fea7f63) tydligt
beskriver:
- Två-stegs utbetalning
- RUT-avslag = ingen del 2
- Tidsram för Skatteverket-godkännande

Om inte: uppdatera avtal som separat PR innan Todo A tas i bruk.

## Acceptanskriterier

- [ ] Städaren ser båda belopp i e-post vid bokningsförfrågan
- [ ] Dashboard visar "väntande RUT-utbetalning" för godkända bokningar
- [ ] Beräkning är korrekt för alla RUT-typer (50% RUT, ej 100%)
- [ ] Ej-RUT-bokningar (kontorsstädning) visar fortfarande enkel intjäning
- [ ] Uppdragsavtal verifierat eller uppdaterat
