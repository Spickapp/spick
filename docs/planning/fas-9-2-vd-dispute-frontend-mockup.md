# Fas 9 §9.2 — VD-dispute frontend UI-mockup

**Status:** UI-skiss för Farhad-OK innan bygge (memory-feedback `validate_ui_before_backend`)
**Backend:** ✅ LIVE (`vd-dispute-decide` EF deployad, 292 rader, JWT-auth + 500 kr-cap + 10% admin-sampling)
**Skiss-tid:** 30 min
**Bygge-estimat efter OK:** 3-4h

---

## 1. Backend-sammanfattning (verifierat via EF-läsning)

`vd-dispute-decide` är wrapper-EF som:
- Tar VD JWT (cleaner WHERE `is_company_owner=true`)
- Verifierar att `booking.cleaner_id` tillhör VD:s företag
- Tillåter `decision='dismissed'` alltid
- Tillåter `decision='full_refund'` om `booking.total_price <= 500 kr`
- Forwardar till `dispute-admin-decide` (samma affärslogik som admin)
- 10% av VD-beslut samplas → admin-audit-alert
- `partial_refund` är **DEFERRED** (state-machine saknar `transfer_partial_refund`)

**Affärsregel:** VD kan stänga små tvister själv (≤500 kr) utan admin. Admin frigörs från trivia.

---

## 2. Integration-alternativ — välj A eller B

### Alternativ A — Egen sida `vd-disputes.html`

**Ascii-layout:**
```
┌─ vd-disputes.html ─────────────────────────────────────────┐
│  [Spick logo]                            VD: Anna Andersson│
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Tvister i mitt team                                       │
│  3 öppna · 1 över 500 kr (kräver admin)                   │
│                                                            │
│  ┌─────────────────────────────────────────────┐           │
│  │ SP-2026-0123  •  Hemstädning  •  390 kr     │           │
│  │ Maria → Lisa Lindqvist                       │           │
│  │ Öppnad 2 timmar sedan                       │           │
│  │                                              │           │
│  │ KUND-ANLEDNING:                              │           │
│  │ "Det luktade rök i köket efter städningen." │           │
│  │                                              │           │
│  │ STÄDARENS SVAR:                              │           │
│  │ "Inget rökt under min tid där."             │           │
│  │                                              │           │
│  │ EVIDENCE: 2 bilder från städaren            │           │
│  │ [📷 Bild 1] [📷 Bild 2]                     │           │
│  │                                              │           │
│  │ [✓ Avvisa]  [💸 Full återbet (390kr)]       │           │
│  │ [✗ Avbryt — eskalera till admin]            │           │
│  └─────────────────────────────────────────────┘           │
│                                                            │
│  ┌─────────────────────────────────────────────┐           │
│  │ SP-2026-0124  •  Storstädning  •  680 kr   │           │
│  │ ⚠ Över 500 kr — kräver admin-beslut         │           │
│  │ [Eskalera till admin]                       │           │
│  └─────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Tydlig URL (`/vd-disputes.html`) — bookmarks, deep-links
- Stand-alone — påverkar inte stadare-dashboard
- Cleaner separation av VD-only-funktioner

**Cons:**
- Ny sida (~280 rader baserat på admin-disputes.html-struktur)
- VD måste klicka från dashboard-länk för att hitta den
- Ny nav-rad i header för bara denna sida

---

### Alternativ B — "Tvister"-tab i stadare-dashboard.html (rekommenderat)

**Ascii-layout:**
```
┌─ stadare-dashboard.html ───────────────────────────────────┐
│  [Spick]  Hem | Bokningar | Kalender | Team | TVISTER ⚠3   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  TAB: Tvister                       (visas bara om VD)     │
│                                                            │
│  3 öppna i mitt team · 1 över 500 kr                      │
│                                                            │
│  ┌─────────────────────────────────────────────┐           │
│  │ [samma kort-design som Alt A]               │           │
│  │ [✓ Avvisa] [💸 Full återbet] [Eskalera]    │           │
│  └─────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Återbruk av existerande shell (auth, nav, layout)
- Kortare bygge: ~150 rader (bara tab-innehåll, inte header/footer/auth)
- VD ser tab automatiskt vid login → bättre discovery
- Notification-badge `⚠3` synlig i nav direkt
- En-fil-edit, ingen ny sida att underhålla

**Cons:**
- Klyftar `stadare-dashboard.html` ytterligare (filen är redan stor)
- Kan inte djup-länkas direkt (måste till dashboard först)

**Min rekommendation: B.** Mindre overhead, bättre UX (notification i nav), VD-rolled badge är synlig hint om feature-existens. Djup-länkning är edge case som inte är värt extra fil.

---

## 3. UI-states — flow

### State 1: Lista (`getDisputes()`)
```
Anrop: GET /rest/v1/disputes?status=eq.open&cleaner_company_id=eq.{VD_COMPANY}
Render: Kort per dispute med summary + actions
Tom: "Inga öppna tvister i ditt team. Inget att besluta."
```

### State 2: Beslut-bekräftelse (modal innan POST)
```
[Modal]
Är du säker?
  Avvisa tvist SP-2026-0123?
  → Kunden får inget tillbaka. Städaren får sin betalning.
  → Beslutet är slutgiltigt.

[Avbryt]  [Ja, avvisa]
```

### State 3: Loading + result (efter POST)
```
[Modal stängd, kort uppdateras inline]
✓ Beslut registrerat. Tvisten är stängd.
(kort försvinner från lista efter 2 sek)
```

### State 4: Error-handling
- 401 (token expired) → "Din session är slut. Logga in igen."
- 403 (booking inte i VD-team) → "Du kan bara besluta tvister för städare i ditt företag."
- 422 (over 500 kr) → "Detta belopp överskrider VD-gränsen (500 kr). Eskalerar till admin..."
- 500 → "Något gick fel. Försök igen om en stund."

---

## 4. Edge cases att hantera

| Case | UI-beteende |
|---|---|
| Kund har bifogat bilder | Visa thumbnail-grid, klick → lightbox |
| Städaren har svarat | Visa svaret i `quote-box` med label "Städarens svar" |
| Städaren har inte svarat än | Visa "Väntar på städarens svar (deadline: XX)" |
| Dispute > 500 kr | Visa rött "Över VD-gräns" + bara "Eskalera till admin"-knapp |
| 10% sampling triggar | Visa toast: "Detta beslut har valts för slumpvis admin-granskning. Inget extra steg krävs." |
| Booking redan stängd | Visa "Bokningen är redan stängd" — disable alla actions |

---

## 5. Konkreta frågor till Farhad innan bygge

1. **Alt A eller B?** (Min rekommendation: B)
2. **Notification-badge i nav** (`⚠3`) — visa antal eller bara prick?
3. **Eskalera till admin** — separat knapp eller automatisk vid >500 kr?
4. **Dispute-historik** — visa stängda tvister också (filter-tab) eller bara öppna?
5. **Cleaner-perspektiv** — ska VD se städarens egen `cleaner-disputes.html`-vy som "tittar-läge"? Eller bara summary-info?

---

## 6. Bygge-checklista (efter ditt OK)

- [ ] Lägg till "Tvister"-tab i stadare-dashboard.html (visas om `is_company_owner=true`)
- [ ] Funktion `loadVDDisputes()` — fetch via Supabase JS från disputes-tabellen med company-filter
- [ ] Render-funktion `renderDisputeCard(dispute)` — kort-layout, knappar
- [ ] `decideDispute(disputeId, decision)` — POST till `vd-dispute-decide` EF
- [ ] Modal-bekräftelse + loading-state + error-handling
- [ ] Notification-badge i nav (count)
- [ ] Polling/refresh efter beslut (eller invalidate cache)
- [ ] CSS: kort-design (kopia från admin-disputes.html, scope:ad till .vd-dispute-card)
- [ ] E2E-test: VD ser bara sina disputes, kan besluta ≤500 kr, blockas på >500 kr
- [ ] Auto-deploy via H18 (frontend pushes till GitHub Pages direkt)

**Bygge-estimat efter ditt OK:** 3-4h.

---

## 7. Rekommenderat svar-format till mig

Skriv något i stil med:

> **OK på Alt B.** Notification = bara prick (inte siffra). Eskalering = automatisk vid >500 kr (inte separat knapp). Bara öppna disputes (inte historik). VD ser ej cleaner-perspektiv.

Eller justera det du vill ändra. När jag har dina svar bygger jag.

---

## 8. Verifiering rule #29 + #31

- ✅ Backend `vd-dispute-decide` EF läst direkt (rad 1-80)
- ✅ admin-disputes.html struktur granskad för pattern
- ✅ stadare-dashboard.html grep för existing dispute-pattern (bara invoice-disputes, ingen booking-dispute-UI)
- ✅ Working defaults (500 kr, 10% sampling) verifierade i EF rad 51-52
- ⚠ `disputes`-tabell-schema ej curl-verifierat denna skiss — verifieras vid bygge
