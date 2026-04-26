# §9.9 underleverantörsavtal-UI — UI-mockup

**Status:** Mockup för Farhad-OK före bygge
**Backend:** ✅ Item 1 BankID-bunden signering deployad (5 commits, denna session)
**Bygge-estimat efter OK:** 4-6h

---

## Syfte

Ge **VD (Zivar)** en plats där hen kan:
- Se vilka avtal som gäller för hens företag
- Granska avtal-PDF i ny flik
- Se accept-status per teammedlem (vem har signerat, vem inte)
- Trigga "påminn-att-signera"-mejl till team-medlemmar
- Ladda ner **signerings-bevis** (audit för Spick-tvister)

---

## UX-flow

Ny tab i `stadare-dashboard.html` → **"📋 Avtal"** (visas bara för is_company_owner).

### Sektion 1 — Mina avtal (kort per avtals-typ)

```
┌─ Underleverantörsavtal v1.0 ─────────────────────────┐
│  📅 Senaste version: 2026-XX-XX                      │
│  ✅ Signerat av dig: 2026-XX-XX (BankID-bunden)      │
│  📄 [Granska] [Ladda ner PDF] [Ladda ner signerings-bevis] │
└──────────────────────────────────────────────────────┘

┌─ B2B-tillägg företag v1.0 ───────────────────────────┐
│  📅 Senaste version: 2026-XX-XX                      │
│  ✅ Signerat av dig som firmatecknare: 2026-XX-XX    │
│  📄 [Granska] [Ladda ner PDF]                        │
└──────────────────────────────────────────────────────┘

┌─ Code of Conduct v1.0 ───────────────────────────────┐
│  ⚠ Inte signerat ännu                                │
│  📄 [Granska] [Signera med BankID →]                 │
└──────────────────────────────────────────────────────┘
```

### Sektion 2 — Team-medlemmars status (tabell)

```
┌─ Team-signering-status ──────────────────────────────┐
│                                                      │
│  Cleaner                Signerat        Påminnelse  │
│  ────────────────────────────────────────────────────│
│  Dildora Kenjaeva       ✅ 2026-04-30   —            │
│  Nilufar Kholdorova     ❌ Aldrig       [Påminn]     │
│  Nasiba Kenjaeva        ⚠ v0.9 (gammal) [Påminn]     │
│  Odilov Firdavsiy       ❌ Aldrig       [Påminn]     │
│                                                      │
│  Status:  3 av 4 team-medlemmar saknar aktuell accept│
└──────────────────────────────────────────────────────┘
```

→ Klick på "Påminn" → bakgrunds-EF skickar SMS+email till cleaner med BankID-länk till accept-flow.

### Sektion 3 — Avtals-uppdaterings-historik (chronologisk)

```
┌─ Avtal-historik (för audit) ─────────────────────────┐
│                                                      │
│  2026-XX-XX  Underleverantörsavtal v1.0 publicerad   │
│              Ändringar: Initial bindande version    │
│              [Ändringar] [Före/efter-jämförelse →]   │
│                                                      │
│  ... (framtida versions hamnar här)                 │
└──────────────────────────────────────────────────────┘
```

---

## Teknisk implementation (efter OK)

### Backend — utökar existing
- **Reuse:** `check-terms-acceptance` (Item 1, denna session) — utöka med `subject_type=company` + lista alla i samma company
- **Ny EF:** `admin-remind-team-terms` (mejl/SMS-trigger)
- **Reuse:** `register-bankid-init/-status` (Item 1) för faktisk signerings-flow
- **Reuse:** `avtal_versioner` schema för PDF-länkar

### Frontend — ny tab i stadare-dashboard.html
- Nav-knapp "Avtal" (visas via `permissions.terms_management` eller `is_company_owner`)
- 3 sektioner ovan, render via `loadTermsManagementTab()`
- Modal för signera-direkt-flow

---

## 5 frågor till Farhad innan bygge

1. **Påminn-frekvens:** auto-påminnelse efter 7 dagar om aldrig-signerat? Eller bara manuell?
2. **Ladda-ner-bevis:** PDF med BankID-bevis (datum, namn, hashad PNR-bevis, version, IP-stamp)?
3. **Avtal-historik visning:** ska gamla v0.9-versioner finnas tillgängliga för granskning eller bara aktuell binding?
4. **Eskaleringsflow vid icke-signering:** när ska VD kunna avstänga team-medlem som vägrar signera?
5. **Notifikation till VD vid teammedlem-signerar:** email/SMS eller bara dashboard-notif?

---

## Bygge-checklista (efter OK)

- [ ] Lägg till nav-knapp "Avtal" i stadare-dashboard.html
- [ ] Skapa tab-content med 3 sektioner
- [ ] JS: `loadTermsManagementTab()` — fetchar accept-status per company-medlem
- [ ] JS: `signTermsWithBankid(avtalTyp)` — startar BankID-flow för VD
- [ ] JS: `remindTeamMember(cleanerId)` — anropar admin-remind-team-terms
- [ ] Skapa EF `admin-remind-team-terms` (~50 rader)
- [ ] Audit-PDF-generation (kan använda existing pdf-lib från Fas 8 generate-receipt-pdf)
- [ ] E2E-test: VD signerar B2B-tillägg → teammedlem ser status uppdaterad

**Estimat:** 4-6h backend + frontend.

---

## Säg en bokstav

- **OK** — bygg som beskrivet
- **Justera X** — säg vad
- **Vänta** — diskutera mer först

(Detta är icke-tidskritisk feature — kan vänta tills villkor-paket är jurist-OK och Item 1 är aktiverat med `terms_signing_required=true`.)
