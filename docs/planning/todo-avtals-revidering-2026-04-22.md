# TODO: Avtals-revidering (upptäckt 2026-04-22)

**Status:** Scope klart, bygg pending + juristgranskning rekommenderad
**Estimat:** 1-2h revidering + juristtid (~1500-3000 kr)
**Blockerar:** Todo A (RUT-transparens) kan inte byggas förrän avtal är klart
**Målbild:** PR som uppdaterar [uppdragsavtal.html](../../uppdragsavtal.html), granskad av jurist innan release

## Bakgrund

Under verifiering av uppdragsavtalet mot Todo A-kraven (commit `6d27e7c`,
audit [docs/audits/2026-04-22-uppdragsavtal-vs-todo-a.md](../audits/2026-04-22-uppdragsavtal-vs-todo-a.md))
upptäcktes fler avtalsluckor än förväntat. Istället för fragmentariska
patches samlas alla öppna frågor här och fixas i en revideringsrunda.

## Fyra öppna avtalsfrågor

### Fråga 1: Commission-läckage (KRITISK)

**Problem:** [uppdragsavtal.html:65-66](../../uppdragsavtal.html:65) säger:
- Privatuppdrag: 17 % provision
- Företagsuppdrag: 12 % provision

Men prod kör **12 % flat** (verifierat SQL 2026-04-22 i `platform_settings.commission_standard`).
Om städaren idag registrerar sig och läser 17 %, accepterar, och sen får
12 % dragning — **avtalsbrott-situation**.

**Farhads beslut 22 apr:** 12 % flat gäller oavsett bokningstyp.

**Föreslagen textändring (§5.1):**

```
Spick tar en förmedlingsavgift (provision) om 12 % av jobbvärdet
på varje genomfört uppdrag, oavsett om uppdraget är privat eller
företagsbaserat.

Ändring av provisionssats meddelas skriftligen minst 30 dagar i
förväg enligt §13.
```

**Allvarlighet:** Fixa INNAN nästa städare registrerar sig. Kan inte
vänta till Rafa-pilot — registrerings-flödet är öppet redan.

### Fråga 2: §5.7 RUT-avslag saknas (HÖG)

**Problem:** avtalet (§5.6) beskriver två-stegs utbetalning men aldrig
scenariot "Skatteverket avslår RUT-ansökan". Tyst avtalspunkt =
juridisk osäkerhet.

**Farhads policy-beslut pending.** Tre alternativ beskrivs i
audit-rapporten:
- **Hård:** ingen kompensation
- **Mellanväg:** Spick kan frivilligt kompensera vid administrativt fel
- **Mild:** Spick efterfrågar kunden för kompensation

**Rekommendation:** Mellanväg som balanserad startpunkt. Men beslut är
Farhads + bör diskuteras med jurist.

**Platshållare för textändring** (mellanväg):

```
§5.7 RUT-avslag

Om Skatteverket avslår kundens RUT-ansökan för ett genomfört uppdrag,
utgår ingen andra utbetalning till Underleverantören. Spick kan i
särskilda fall, exempelvis när avslaget beror på administrativt fel
från Spicks sida, besluta om frivillig kompensation. Sådant beslut
fattas av Spick och skapar ingen rätt till kompensation för
Underleverantören.

Spick strävar efter att minimera avslagsrisken genom korrekt
rapportering till Skatteverket och korrekt insamling av
kund-personuppgifter.
```

### Fråga 3: Prisändringsrätt tyst/svag (MEDIUM)

**Problem:** avtalet §5.1 och §13 säger "ändringar meddelas 30 dagar
i förväg" men anger inte uttryckligen att Spick HAR rätt att ändra
unilateralt. Passiv konstruktion = juridiskt tunt vid tvist.

**Risk:** Om Spick senare höjer provision från 12 % → 15 % och en städare
bestrider, kan avtalet inte entydigt genomdriva ändringen.

**Föreslagen textändring (§13):**

```
§13 Ändringar

Spick har rätt att ensidigt ändra provisionssats, avgifter och andra
avtalsvillkor med minst 30 dagars skriftlig förvarning till
Underleverantören via e-post.

Fortsatt användning av plattformen efter ikraftträdandedatumet utgör
Underleverantörens acceptans av ändringen.

Om Underleverantören inte accepterar ändringen kan avtalet sägas upp
enligt §11 utan uppsägningstid.
```

**Allvarlighet:** Inte akut idag, men kritiskt när Spick skalar.
Bättre inkludera i denna revidering än göra om senare.

### Fråga 4: Signatur utan DB-logg (MEDIUM, teknisk)

**Problem:** [registrera-stadare.html:660](../../registrera-stadare.html:660) har checkbox för avtals-acceptans
men databasen loggar INTE:
- `terms_accepted_at` (tidpunkt för acceptans)
- `terms_version` (vilken version av avtalet städaren accepterade)

**Juridisk risk vid tvist:** Två år senare vid konflikt — Spick kan inte
bevisa vilken exakt version av avtalet städaren accepterade när.

**Fix-scope (separat från textändringar 1-3):**
- DB-migration: lägg till kolumner `terms_accepted_at TIMESTAMP`,
  `terms_version TEXT` i `cleaners` eller `cleaner_applications`
- Kod-ändring i registrera-stadare.html: fylla i `terms_accepted_at = NOW()`
  + aktuell version-sträng
- Versionera avtalstexten framöver (t.ex. "v2026.04.22" i filhuvudet)

**Allvarlighet:** Fas 13 GA-readiness-scope eller tidigare om kapacitet
finns. 2-3h arbete.

## Rekommenderat arbetsflöde (för imorgon)

1. **Farhad beslutar §5.7-policy** (hård/mellanväg/mild, ~15 min reflektion)

2. **Jurist-konsultation** (1500-3000 kr, ~1h):
   - Läser utkast med alla 4 ändringar
   - Validerar §13-formulering för ensidig ändringsrätt
   - Kontrollerar att §5.7 inte bryter mot Avtalslag 36§ (oskälig-villkor)
   - Bedömer om fler luckor finns

3. **Bygg PR 1: textändringar** (30-60 min, EFTER juristgranskning):
   - Fråga 1 + 2 + 3 i samma commit
   - Bump avtals-version till v2026.04.23 (eller vad dagens datum blir)
   - Uppdatera audit-fil med "resolved" status per fråga

4. **Bygg PR 2: signatur-DB-logg** (2-3h, kan göras parallellt eller senare):
   - Migration + frontend-ändring
   - Fyll i befintliga rader med "v2026.04.22" som default-version

5. **Sedan Todo A:** UI-transparens-bygge kan starta (2-4h)

## Beroendeschema

```
Farhad §5.7-beslut → Jurist-granskning → PR 1 textändringar → Todo A UI-bygge
                                                            ↓ (parallell)
                                        PR 2 signatur-DB-logg (Fas 13 eller nu)
```

## Referenser

- Audit: [docs/audits/2026-04-22-uppdragsavtal-vs-todo-a.md](../audits/2026-04-22-uppdragsavtal-vs-todo-a.md)
- Fas-kontext: [docs/v3-phase1-progress.md](../v3-phase1-progress.md) "## TODOs (post-Fas-1-upptäckter)"
- Original Todo A: [docs/planning/todo-a-rut-notification-transparency.md](todo-a-rut-notification-transparency.md)
- Original Todo B: [docs/planning/todo-b-rut-two-step-payout.md](todo-b-rut-two-step-payout.md)
