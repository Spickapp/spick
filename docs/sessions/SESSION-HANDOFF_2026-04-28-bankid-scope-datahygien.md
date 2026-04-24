# Session handoff — 2026-04-28 (kväll: BankID-scope-lock + data-hygien + sanning-filer)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-28-massive-pm-session.md`
**Denna session:** 2026-04-28 (kväll, fortsättning)
**Status vid avslut:** BankID-scope smalt + 4 prod-SQL körda + 3 commits pushade + 2 nya sanning-filer. **Inget verifierat funktionellt** — tester pending Farhad (magic-link-cap återställd).

---

## 1. TL;DR

Farhad startade sessionen med "gå igenom alla faser". Sessionen utvecklades till projektchef-spec för BankID-implementation, kalibrerades om när Farhad avslöjade att han är juristutbildad (→ Claude blev dataleverantör istället för extern-jurist-eskalator), och avslutades med konkreta data-hygien-fixar + docs-leveranser.

**Nyckelbeslut:**

1. **Spick = utförare** (låst, A1)
2. **Betalningsmodell: efter-RUT + ensteg-payout + SKV-avslag → kund** (som Vardagsfrid)
3. **BankID-scope smalt:** Kund-flöde + Farhad-ombud kvar · städar-onboarding deferred
4. **TIC vald som leverantör** (redan integrerad i bankid-verify + bankid-webhook EFs)
5. **Avtalsutkast deferred** (tills konkret problem)

---

## 2. Prod-ändringar (körda av Farhad i Studio)

### 2.1 SQL körda

| # | Fix | Effekt | Verifierat av |
|---|---|---|---|
| 1 | Farhad-konto → Haghighi Consulting AB owner | `cleaners.company_id=10734714...` + `company_role='owner'` + `companies.owner_cleaner_id` omdirigerad | Farhad (Studio output) |
| 2 | Testkonton markering + frikoppling | `farrehagge+test7` + `farrehagge-test7`: `is_test_account=true`, `company_id=NULL`, `status='testdata'` | Farhad (Studio output) |
| 3 | Avstängda cleaners dataminimering (GDPR Art 5.1.c) | derin + Ahmad: `first_name='[blockerad]'`, PII=NULL, `is_blocked=true`, `is_active=false` | Farhad (Studio output) |
| 4 | Dölj Haghighi från matchning | `cleaners.owner_only=true` på Farhad-cleaner | Farhad (inget output-dump men bekräftade "Klart") |

### 2.2 Inga migrations körda

Ingen kod-migration körd. 0 nya kolumner i prod. Alla ändringar är UPDATE på befintliga rader.

---

## 3. Commits (3 pushade till origin/main)

| Sha | Meddelande | Verifierat |
|---|---|---|
| `47a6b94` | `docs(sanning): payment-model.md skapad + pnr-och-gdpr.md MVP-kontext` | ⏳ PENDING granskning av Farhad |
| `6055590` | `docs(sanning): f-skatt.md — SSOT-fragmentering dokumenterad` | ⏳ PENDING granskning av Farhad |
| `5b57f74` | `feat(f-pdf): kund-UI 'Ladda ner kvitto (PDF)' på min-bokning.html` | ⏳ PENDING browser-test (magic-link-cap återställd) |

**GitHub Pages-deploy:** utlöst automatiskt vid push. ⏳ PENDING verifikation att `min-bokning.html` byggdes + deployades korrekt.

---

## 4. Sanning-filer

### 4.1 Nya

- **`docs/sanning/payment-model.md`** — Betalningsmodell låst:
  - A1 Spick utförare (låst)
  - Efter-RUT fakturamodellen (Lag 2009:194)
  - Ensteg-payout via escrow v2 (Fas 8 LIVE)
  - SKV-avslag → kund faktureras (Vardagsfrid-paritet)
  - Klass A-frågor för Farhads interna bedömning (A3, A4, A5, A7, A8, A10, B1, C2)
  - MVP-status sektion (15 riktiga cleaners, 0 jobb utförda)

- **`docs/sanning/f-skatt.md`** — SSOT-fragmentering dokumenterad:
  - 3 kolumner på cleaners (`has_fskatt`, `f_skatt_verified`, `fskatt_needs_help`) utan SSOT
  - Saknad `companies.f_skatt_verified`
  - Prod-data verifierad 2026-04-28
  - Konsoliderings-plan (6-9h, Fas 7.5-scope)
  - Läsregel för kod tills konsolidering körs

### 4.2 Uppdaterade

- **`docs/sanning/pnr-och-gdpr.md`** — tillagt:
  - MVP-kontext (0 jobb utförda)
  - derin Bahram dubbelroll (kund + avstängd cleaner)
  - "Kräver jurist"-formuleringar ersatta ("Farhads bedömning")

---

## 5. Memory (utanför projekt-repot, i `~/.claude/projects/...`)

| Fil | Typ | Syfte |
|---|---|---|
| `user_role.md` | user | Farhad är juristutbildad → data-leverans, inte juridiska tolkningar |
| `project_bankid_scope_2026_04_28.md` | project | Städar-BankID + avtalsutkast deferred. Reaktiveras vid konkret problem. |
| `MEMORY.md` (index) | — | 2 nya pointers tillagda |

---

## 6. Scope-beslut — låsta denna session

| # | Beslut | Påverkan |
|---|---|---|
| A1 | Spick = utförare (inte förmedlare) | Hela RUT-modellen: Spick fakturerar kund, ansöker RUT i eget namn |
| Modell | **Ensteg-payout** till företag/enskild firma | Stripe Connect direkt efter escrow-fönster |
| RUT-risk | **Mot kund** vid SKV-avslag | Fas 7.5 behöver `rut-denial-invoice` EF + admin-UI |
| BankID-omfång | Kund + Farhad-ombud. Städare deferred | Minst 20h reducerad scope |
| Leverantör | **TIC** (redan integrerad) | Signicat/GrandID valdes bort |
| Avtalsutkast | Deferred | Reaktiveras när konkret problem |

Alla 6 dokumenterade i [payment-model.md §1](../sanning/payment-model.md) + [project_bankid_scope_2026_04_28.md](~/.claude/projects/.../memory/project_bankid_scope_2026_04_28.md).

---

## 7. Cleaner-flottan (verifierad prod 2026-04-28)

```
18 cleaners totalt i DB:
├── 3 testkonton (is_test_account=true)
│   ├── Test VD AB-konto (pre-existing)
│   ├── farrehagge+test7@gmail.com (Fix 2)
│   └── farrehagge-test7@gmail.com (Fix 2)
│
├── 2 avstängda + dataminimerade (GDPR Art 5.1.c)
│   ├── derin Bahram (Fix 3)
│   └── Ahmad Abboud (Fix 3)
│
└── 13 aktiva/onboarding-riktiga cleaners
    ├── 4 company owners (Farhad/Zivar/Rafael/Rudolf)
    └── 9 team members + solo-cleaners
```

**0 jobb utförda över hela flottan** (`total_jobs=0` för alla 18). Risk är **förebyggande**, inte retroaktiv.

---

## 8. Companies (verifierade prod 2026-04-28)

```
5 companies i DB:
├── Test VD AB (org 000000-0000, dummy) — pending testdata-markering
├── Haghighi Consulting AB (559402-4522) — Farhads, owner omritad till farrehagge@gmail.com
├── Solid Service Sverige AB (559537-7523) — Zivar Majid
├── Rafa Allservice AB (559499-3445) — Rafael Arellano
└── GoClean Nordic AB (559462-4115) — Rudolf Mamoka

Onboarding-status:
├── 4 pending_stripe (de 4 riktiga)
└── 1 complete (Test VD AB — dummy)

UA signerat: 0 av 4 (pending Farhads UA-utkast efter avtalsutkast-deferral lyfts)
DPA signerat: 0 av 4
Insurance verified: 0 av 4
employment_model: 'employed' för alla (members = anställda hos owner-bolaget)
```

---

## 9. ⏳ PENDING verifieringar (Farhads hand)

**OBS:** Inget av detta är klarmarkerat. Markera själv när testat/bekräftat.

### 9.1 Browser-tester (efter magic-link-cap återställd)

| # | Test | Hur |
|---|---|---|
| 1 | PDF-knapp fungerar på min-bokning.html | Logga in som riktig kund med paid booking → klicka "📄 Ladda ner kvitto (PDF)" → PDF ska laddas ner |
| 2 | Matching visar INTE Haghighi Consulting AB | boka.html → välj Hemstädning → scroll cleaners-listan → Haghighi ska INTE dyka upp |
| 3 | admin.html visar dig som owner av Haghighi Consulting AB | admin → cleaners → farrehagge@gmail.com → company_role='owner' ✓ |

### 9.2 GitHub Pages-deploy

| # | Check |
|---|---|
| 4 | Kolla Actions-tab på github.com/Spickapp/spick — senaste deploy efter `5b57f74` ska vara grön |
| 5 | Öppna `https://spick.se/min-bokning.html` (inkognito) → laddas filen utan 404? |

### 9.3 Kvarvarande mikro-beslut

| # | Beslut | Alternativ |
|---|---|---|
| 6 | Test VD AB (org 000000-0000) — markera som testdata? | (a) `is_test_account=true` + flagga (b) radera helt (c) låt vara |

### 9.4 Pushade commits — review

Läs igenom `git log` sedan `ab2e2cc` och bekräfta att inget oväntat finns.

---

## 10. Nästa session — rekommenderad start

1. **Verifiera** ⏳ pending-items i §9 (ca 10 min).
2. **Beslut på Test VD AB** (§9.3 punkt 6).
3. **Om verifieringar OK → markera klart i denna fil + farhad-action-items.md.**
4. **Om verifieringar avslöjar buggar → rollback/fix-sprint.**
5. Därefter: nästa prioritet från v3-phase1-progress.md — jag rekommenderar Rafa-pilot F-skatt-verifiering som första operativa steg (kontakta 3 company owners för F-skattebevis).

---

## 11. Regel-efterlevnad (#26-#31)

- **#26 (grep-före-edit):** Alla edits i sessionen föregicks av exakt-text-läsning. Enda str_replace-fel fångades omedelbart (UNION-typfel i SQL).
- **#27 (scope-respekt):** Farhads explicita mandat följdes vid varje steg. Städar-BankID + avtalsutkast EJ byggda efter deferral. Fas 4 migration + foretag-dashboard skippade pga risk utan test.
- **#28 (SSOT):** 3 sanning-filer skapade/uppdaterade. F-skatt-fragmentering explicit dokumenterad som känd skuld (inte dold). Memory-pointers lagda.
- **#29 (audit-först):** Sessionen startade med full läsning av primärkällor — audit, legal-research, todo-pnr, Fas 7.5 migration, v3-phase1-progress (första 500 rader), farhad-action-items.
- **#30 (regulator-gissning förbjuden):** Inga antaganden gjorda om SKV/IMY/BokfL/EU PWD-detaljer. Alla regulator-känsliga beslut flaggade för Farhads egen juristbedömning. Klass A/B/C-frågor listade med lagrum, inte tolkade.
- **#31 (primärkälla över memory):** 6 prod-verifieringar körda via Studio innan kod/SQL skrevs (cleaners-kolumner, bookings-kolumner, BankID-tabeller, F-skatt-fragmentering, team-struktur via join, companies-status). Schema-drift dokumenterad (3 BankID-EFs refererar icke-existerande kolumner).

---

## 12. Startpunkt för handoff-läsare

Om du bara läser en sak: **§9 Pending verifieringar** är vad du ska göra härnäst. §4.1 listar sanning-filerna som nu är primärkällor för betalningsmodellen + F-skatt-status.

Om du är en framtida Claude-session: läs `docs/sanning/payment-model.md` + `docs/sanning/f-skatt.md` i sin helhet innan du rör RUT- eller F-skatt-relaterad kod. Memory `user_role.md` är kritisk — Farhad är juristutbildad, data-leverans över juridiska tolkningar.
