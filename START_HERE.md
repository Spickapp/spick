# START HERE — Spick-sessionslagring

**Ny Claude-session? Läs denna fil FÖRST. Tvingande.**

---

## Session-start-prompt (för Farhad att paste:a i ny chatt)

Kopiera allt nedanför "### PROMPT BÖRJAR" och paste:a som första meddelande i ny Claude-chatt. Sen din faktiska fråga som uppföljningsmeddelande.

### PROMPT BÖRJAR

Innan du svarar på något: kör startsekvensen.

1. Öppna och läs `START_HERE.md` i repo-roten (C:\Users\farha\spick\START_HERE.md).
2. Följ dess instruktioner i ordning.
3. När du har läst alla filer START_HERE.md pekar på, svara i exakt detta format:

Assistant: SETUP läst. Sammanfattning:
- Provision: [värde från docs/sanning/provision.md]
- RUT-status: [värde från docs/sanning/rut.md]
- PNR-status: [värde från docs/sanning/pnr-och-gdpr.md]
- Aktiv Fas (från docs/v3-phase1-progress.md): [fas och status]
- Viktigaste regel idag: [valfri från regelbank]

Farhad, vad vill du göra idag?

Bekräfta att du läst innan du tar emot nästa meddelande.

### PROMPT SLUTAR

---

## Vad du (Claude) ska läsa nu

Läs dessa filer i EXAKT denna ordning. Ingen skippning.

### A. Sanningsfiler (3 min)

1. `docs/sanning/provision.md` — aktuell provisionsnivå. Auth: DB-värde i platform_settings.commission_standard.
2. `docs/sanning/rut.md` — RUT-infrastruktur, vad är av/på, vad är pausat.
3. `docs/sanning/pnr-och-gdpr.md` — PNR-fynd, klartext-kunder, GDPR-status.

### B. Projektorientering (5 min)

4. `CLAUDE.md` — projektkontext.
5. `docs/v3-phase1-progress.md` — aktuellt fas-läge, öppna TODOs.
6. `docs/sessions/SESSION-HANDOFF_2026-04-23-kvall.md` — senaste handoff (läs SENASTE om det finns nyare).

### C. Audits-läsning vid behov (ej obligatorisk)

- `docs/audits/2026-04-23-rut-infrastructure-decision.md` — om frågan gäller RUT/PNR/Fas 7.5.
- `docs/audits/` allmänt — om frågan gäller något som audit finns för.

---

## Kärn-konvention: Primärkälla > Memory > Hypotes

**Regel #31 (bekräftad 23 apr kväll):** När du saknar säkerhet om ett tekniskt faktum, gå till primärkällan:

| Fråga | Primärkälla |
|---|---|
| Provision, pricing, config-värden | `docs/sanning/provision.md` + `platform_settings`-tabellen |
| Schema, kolumner, index | `prod-schema.sql` eller `supabase db diff` |
| Aktuella rader/data | `supabase_admin`-query i Studio |
| RUT-status | `docs/sanning/rut.md` |
| GDPR/PNR-status | `docs/sanning/pnr-och-gdpr.md` |
| Fas-status, TODO-prio | `docs/v3-phase1-progress.md` |

**Memory är INTE primärkälla.** Auto-memory innehåller gissningar och tidsspecifika antaganden. Använd memory som kontext, men verifiera mot primärkälla innan du bygger på den.

---

## Regler som ofta bryts (hotspots)

- **#26 (Grep-before-edit):** Läs exakt text innan str_replace. Rapportera om indentation/omringande text avviker.
- **#27 (Scope-respekt):** Gör det du blev ombedd om, inget mer. Flagga relaterade observationer istället för att agera på dem.
- **#28 (Pricing-konsolidering):** Provision ska läsas från ETT ställe (platform_settings). Skapa inte fler fragmenteringspunkter.
- **#29 (Audit-först):** Läs hela audit-filen innan du agerar på "audit säger X". Research-steg är inte formalia.
- **#30 (Ingen regulator-gissning):** Skatteverket, GDPR, BokfL, Stripe-regler får aldrig gissas. Verifiera mot spec eller fråga Farhad.
- **#31 (Primärkälla över memory):** Schema/data är sanning. Memory och tidigare audit-antaganden är hypoteser.

---

## När du är klar med läsning

Svara enligt det exakta formatet i prompten ovan. Ingen utfyllnad, inga extra rader. Farhad vet då att SETUP är läst.

Sen lyssnar du på hans faktiska fråga.
