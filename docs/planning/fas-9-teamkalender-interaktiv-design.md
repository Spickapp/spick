# Teamkalender — interaktiv uppgradering (design)

**Datum:** 2026-04-26
**Trigger:** Farhad-fråga: "Skulle vi inte ordna en drag-and-drop? Även dra i kalendern själva tiden, sen öppnar man jobb, eller alternativ markera ledig/sjuk/annan? En grym interaktiv kalender."

**Nuvarande state (verifierat):**
- `gantt-event.dragging` CSS finns → drag-grund delvis implementerad
- `gantt-sick-btn` "Sjukanmäl"-knapp per cleaner-rad i Gantt-vy
- "Spärrade datum (sjukdom, semester, privat)"-input i profil
- "+ Jobb"-knapp öppnar `openManualBooking()`-modal
- Vy: Gantt-stil (4 cleaners × 24 timmar) — Dag/Vecka-toggle

---

## Föreslagen interaktiv uppgradering — 6 features

### F1 — **Drag-and-drop för bokningar mellan cleaners**
**Beskrivning:** VD drar en bokning från Dildora till Nasiba i samma timme. Bokningen UPDATE:ar `cleaner_id` + `cleaner_name`. Notifikation skickas till båda.

**Backend:** EF `booking-reassign` finns redan (auto-deploy). Frontend behöver bara hook till HTML5 drag/drop.

**UX:**
- Kund-namn + tjänst stannar samma
- Visuell ghost-block under drag
- Drop på annan cleaner-rad → confirm-modal "Omfördela till Nasiba?"
- Status: ✅ EF finns, ~3-4h frontend-impl

### F2 — **Drag-och-skapa nytt jobb (rita på kalender)**
**Beskrivning:** Klick + drag på tom yta i cleaners rad → markerar tidsperiod (t.ex. 10:00-13:00). Modal öppnas med pre-fyllt: cleaner, datum, starttid, hours.

**Backend:** `openManualBooking()` finns. Frontend lägger till mouse-event-handlers på Gantt-grid.

**UX:**
- Ghost-block visar drag-omfång
- Släpp → öppnar manualBooking-modal med pre-fyllt
- Backup för "+Jobb"-knapp som finns idag
- Status: ✅ Modal finns, ~2-3h frontend-impl

### F3 — **Markera ledig/sjuk/annan via right-click eller höger-meny**
**Beskrivning:** VD klickar på cleaner-rad eller specifik tidsperiod → context-meny:
- ❤️ Ledig (semester) — heldag
- 🤒 Sjuk — engångs eller flera dagar
- 🚫 Privat — block utan kommentar
- ✏️ Lägg till anteckning

**Backend:** `cleaner_blocked_dates`-tabell finns (per migration grep). Frontend behöver UI.

**UX:**
- Hover på cleaner-rad → "..."-knapp
- Klick → dropdown-meny med 4 options + datumväljare
- Spara → blockerar i `cleaner_blocked_dates` + cascadeas till `cleaner_availability_v2.is_active=false` för dagen
- Visualisering i Gantt: rosa/grå överlay med ikon
- Status: ✅ Schema finns, ~3-4h frontend-impl

### F4 — **Resize-handle på bokning för att ändra duration**
**Beskrivning:** VD drar i bokning-blockets högra kant → 2h → 3h. UPDATE:ar `bookings.booking_hours` + `total_price` rekalkuleras.

**Backend:** Behöver ny EF `booking-resize` (eller utöka existing booking-update).

**UX:**
- Hover på bokningsblock → cursor: ew-resize på högra kanten
- Drag → realtime-uppdatering av duration-label
- Släpp → confirm med ny pris
- Status: ⚠️ EF saknas, ~5-6h backend + frontend

### F5 — **Visualisering av RUT-status per bokning** (färgkodning)
**Beskrivning:** Bokningsblock får färg-kant beroende på RUT-status:
- Grön = `safe_to_apply=true` (allt klart)
- Gul = `has_pnr=false` (väntar BankID)
- Orange = `has_attest=false` (kund har inte godkänt)
- Röd = `dispute_open=true`

**Backend:** Data finns redan i `v_rut_pending_queue`-vy (verifierat).

**UX:**
- Tunn 3px-färgkant runt bokningsblock
- Hover → tooltip förklarar status
- Status: ✅ Data finns, ~2h frontend-impl

### F6 — **Kalender-statistik per period (live)**
**Beskrivning:** Toppraden visar redan: BOKADE TIMMAR / KAPACITET / BELÄGGNING / INTÄKT. Lägg till:
- "Sjuk-frekvens denna månad" (% jobb avbokade pga sjukdom)
- "Genomsnittlig beläggning per cleaner"
- "Top-cleaner denna månad" (mest bokade timmar)

**Backend:** Beräknas client-side från existing data.

**UX:**
- Expanderbar "Visa mer statistik"-knapp under stats-rad
- Status: ✅ Allt data finns, ~1h frontend-impl

---

## Bonus-features (lägre prio)

### F7 — **Multi-select bokningar via shift+klick**
För batch-actions: omfördela 5 bokningar till en cleaner samtidigt.

### F8 — **Heat-map per veckodag (utbildnings-värde för VD)**
"Tisdagar är våra bästa dagar — 87% beläggning. Söndagar är dåliga (12%)."
→ Hjälper VD att marknadsföra mer på dåliga dagar.

### F9 — **Tidigare/nästa-period-svep på touch (mobil)**
För VD som checkar dashboarden i bilen.

### F10 — **Auto-suggestions vid drag-and-skapa**
"Senaste 3 bokningar för denna kund: Hemstädning 3h kl 10:00. Pre-fyll?"

---

## Implementations-ordning (om OK)

| Steg | Feature | Tid | Värde |
|---|---|---|---|
| 1 | F1 Drag-omfördela bokningar | 3-4h | Hög (löser team-administration) |
| 2 | F3 Markera sjuk/ledig via meny | 3-4h | Hög (idag krävs separat profil-edit) |
| 3 | F2 Drag-och-skapa nytt jobb | 2-3h | Medel (replicerar +Jobb-knapp men snabbare) |
| 4 | F5 RUT-status-färgkant | 2h | Medel (transparens för VD) |
| 5 | F6 Utökad statistik | 1h | Låg (nice-to-have) |
| 6 | F4 Resize för duration | 5-6h | Låg (kräver ny EF, edge-case) |
| **Total Fas 1** | F1+F2+F3+F5+F6 | **~12h** | Solid uppgradering |
| **Total Fas 2** | F4 + F7-F10 | **~15h** | Polish |

---

## 5 frågor till Farhad innan bygge

1. **Drag-omfördela:** ska kund få notifikation att städaren bytts? Eller bara internt för VD?
2. **Sjukanmälan:** ska auto-mejl skickas till påverkade kunder, eller bara intern markering?
3. **Resize-bokning:** kunden måste godkänna prishöjning vid förlängning — modal eller email?
4. **Mobil-vy:** är Teamkalender-tab använd på mobil? Eller bara desktop? (påverkar UX-design)
5. **F1+F2+F3 i en sprint** eller en åt gången?

---

## Säg en bokstav

- **F1+F2+F3+F5+F6 (Fas 1, ~12h)** — bygg interaktiv kalender komplett
- **Bara F1+F3 (~6-8h)** — minimal uppgradering, lägsta risk
- **Vänta** — diskutera mer först
- **Justera** — säg vad

(Per #27: ingen bygge utan din OK på scope. Per #30: inga regulator-claims i kalender-flow.)
