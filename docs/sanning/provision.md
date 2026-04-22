# Sanning: Provision

**Senaste verifiering:** 2026-04-23 kväll (commit 4400245)
**Verifierad av:** Farhad + Claude, mot PROD Studio SQL Editor
**Ändras genom:** commit som uppdaterar denna fil + uppdaterar DB (om relevant)

## Affärsbeslut (låst)

**12% flat för alla städare.** Trappsystemet (new/established/professional/elite) är AVSKAFFAT.

**Strategisk not (INTERN — får aldrig kommuniceras utåt):** 12% under uppbyggnad, kan höjas framtida när marknadsposition är stark. Ingen städarfacing-text får antyda framtida höjning.

## Primärkälla (single source of truth)

`platform_settings.commission_standard = 12` (uppdaterad 2026-04-17)
`platform_settings.commission_top = 12` (uppdaterad 2026-04-17)

Verifiera med:
```sql
SELECT key, value, updated_at FROM platform_settings 
WHERE key LIKE '%commission%';
```

## Legacy (läs ALDRIG för affärslogik)

- `cleaners.commission_rate` — blandat format (0, 0.17, 12, 17). Droppas i Fas 1.10.
- `companies.commission_rate` — legacy. Droppas i Fas 1.10.
- `bookings.commission_pct` — snapshot vid bokningstillfälle. Bara för historisk audit, inte aktuell provision.

## Koden som läser provision

Centraliserad via `_shared/money.ts::getCommission()`. Frontend använder `js/commission-helpers.js::getCommissionRate()` / `getKeepRate()` / `getCommissionPct()`.

Båda läser från `platform_settings` — aldrig från cleaners/companies.

## Drift (känd men inte pilot-blockerande)

33 HTML-ställen hade "17%" vid beslutstillfället 23 apr. 14 synkade ikväll (commits 5613acc, edabde0). ~25 kvar inkl:
- `villkor-stadare.html:126` (JURIDIK — kräver jurist innan ändring)
- `utbildning-stadare.html` rader 320/327/333 (somaliska, polska, engelska — kräver översättning)
- `bli-stadare.html` trappsystem-narrativ (kräver nytt marknadsbudskap)
- `admin.html:3750, 3763, 3878` trappmapp
- `marknadsanalys.html`, `skatt-utbetalningar.html`, blogg, intern dokumentation

Full lista i `docs/sessions/SESSION-HANDOFF_2026-04-23-kvall.md` under "Öppen sprint: Provision-centralisering".

## Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-23 | Fil skapad. 12% flat låst. DB-verifiering. | Farhad + Claude session |
