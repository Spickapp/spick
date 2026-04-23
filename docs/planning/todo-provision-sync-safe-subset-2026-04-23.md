# TODO — Provision-sync för safe HTML subset (17%→12%)

**Öppnat:** 2026-04-23 (session 27c-m4b slutfas)
**Prio:** LÅG — pre-launch kosmetisk, ingen blockerare
**Status:** Flaggad, ej påbörjad
**Primärkälla:** [docs/sanning/provision.md](../sanning/provision.md)

## Bakgrund

Provision ändrades 17% → 12% flat 2026-04-17. ~25 HTML-filer säger fortfarande "17%". Safe subset (non-juridik, non-translation) kan uppdateras.

## Scope per filkategori

### 🟢 SAFE (kan uppdateras) — kräver matematik-omräkning

| Fil | Rader med "17%" | Matematik att räkna om |
|---|---|---|
| `marknadsanalys.html` | 8 | ja — kr-belopp måste räknas om (12% av 350 = 42 kr, inte 60 kr). Rad 572, 929, 934 har exempel. |
| `skatt-utbetalningar.html` | 4 | ja — rad 469 "17% × 25% = 4.25%" blir "12% × 25% = 3%" |

Estimat: 2-3h noggrann per-rad-omräkning + preview-test + commit.

### 🟡 STRATEGISKT (kräver business-beslut)

- **`bli-stadare.html`** trappsystem-narrativ: kräver nytt marknadsbudskap. Tidigare "17% för nya, 12% för toppcleaners" är borta — nu är det 12% flat. Vad kommuniceras istället?
- **`admin.html:3750, 3763, 3878`** trappmapp-UI: referera till historisk data om bakåtkompat krävs, eller ta bort helt?

### 🔴 BLOCKERAT (kräver tredje-part)

| Fil | Blockerare |
|---|---|
| `villkor-stadare.html:126` | **Jurist** (juridisk text om provisionssats) |
| `uppdragsavtal.html` | **Jurist** (avtalsvillkor) |
| `utbildning-stadare.html` rader 320, 327, 333 | **Översättare** (somaliska, polska, engelska) |
| Blog-posts (diverse) | Marketing-review av SEO-exponering |

### ⚪ INTERNAL (låg prio)

- `docs/` internal documentation — uppdateras löpande när avsnitt berörs

## Strategisk not från sanning/provision.md

> **INTERN — får aldrig kommuniceras utåt:** 12% under uppbyggnad, kan höjas framtida när marknadsposition är stark. **Ingen städarfacing-text får antyda framtida höjning.**

Konsekvens: marknadsanalys.html (intern/partner-sida) kan visa 12% som default. bli-stadare.html (städarfacing) måste noggrant formuleras att INTE antyda att 12% är tillfälligt.

## Åtgärdsplan (när aktualiseras)

1. Farhad godkänner marknadsbudskap för bli-stadare.html trappsystem-narrativ (30 min)
2. Räkna om marknadsanalys.html + skatt-utbetalningar.html (2-3h)
3. Ta beslut om admin.html trappmapp-UI (behåll historisk / ta bort) (30 min)
4. **Boka jurist-möte** för villkor-stadare + uppdragsavtal (separat spår)
5. **Boka översättare** för utbildning-stadare (separat spår)

## Regler

- **#27** scope: ej aktuellt nu, separat session när business-narrative är klart
- **#28** provision = single source i `platform_settings.commission_standard=12`. Alla HTML-texter är kommunikation av detta värde.
- **#30** juridik-filer får INTE ändras utan jurist (villkor-stadare, uppdragsavtal)
