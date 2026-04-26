# Cleaner Onboarding Email-Drip — Sprint 1D

**Datum:** 2026-04-26
**Status:** Templates skrivna — väntar Farhad-review innan EF + cron byggs
**Mål:** Reducera cleaner-drop-off i kritiska första 30 dagarna

---

## Pipeline-översikt

| Trigger | Mail | Mål |
|---|---|---|
| Dag 1 (timme 1 efter approval) | "Välkommen — så får du din första bokning" | Aktivera + sätt förväntningar |
| Dag 3 | "Optimera din profil — 3 enkla tips" | Förbättra konvertering |
| Vecka 1 (dag 7) | "Marketing-tips — så delar du din profil-länk" | Aktivera viral-flow (1E-kit) |
| Månad 1 (dag 30) | "Recensions-strategi — så får du fler 5-stjärniga betyg" | Höj LTV |

---

## Mail 1 — Dag 1 (00:00-04:00 efter approval, alternativt 1h efter approval om dagtid)

**Subject:** Välkommen till Spick — så får du din första bokning 🎉
**From:** Spick <hello@spick.se>

```html
<h2>Välkommen till Spick, {{first_name}}!</h2>

<p>Din profil är godkänd och live. Du syns nu på <a href="https://spick.se/s/{{slug}}">spick.se/s/{{slug}}</a>.</p>

<p><strong>3 saker du gör NU för att få din första bokning inom 7 dagar:</strong></p>

<div class="card">
  <div class="row">
    <span class="lbl">1. Ladda upp profilbild</span>
    <span class="val">+47% bokningar</span>
  </div>
  <div class="row">
    <span class="lbl">2. Skriv 2-3 rader bio</span>
    <span class="val">+23% förtroende</span>
  </div>
  <div class="row">
    <span class="lbl">3. Markera ditt veckoschema</span>
    <span class="val">Krav för matching</span>
  </div>
</div>

<a href="https://spick.se/stadare-dashboard.html" class="btn">Klar 3 stegen i dashboard →</a>

<p style="margin-top:24px">Frågor? Svara bara på det här mejlet — Farhad svarar personligen inom 24h.</p>

<p>Lycka till!<br>
Farhad och Spick-teamet</p>
```

---

## Mail 2 — Dag 3

**Subject:** {{first_name}}, 3 enkla tips för att få fler bokningar 💪
**From:** Spick <hello@spick.se>

```html
<h2>Hej {{first_name}}, så optimerar du din profil</h2>

<p>Du har varit på Spick i 3 dagar. Här är vad de bästa städarna gör annorlunda:</p>

<div class="card">
  <p><strong>Tip 1: Före/efter-foton</strong></p>
  <p>Ladda upp bilder från städningar du gjort. Profiler med jobb-foton får 3x fler klick.</p>
</div>

<div class="card">
  <p><strong>Tip 2: Personlig bio</strong></p>
  <p>Skriv VARFÖR du gillar att städa, inte bara vad du gör. Exempel:<br>
  <em>"Jag älskar känslan av ett blanka kakelgolv. Jag är extra noggrann i kök och badrum eftersom det är där folk märker skillnaden mest."</em></p>
</div>

<div class="card">
  <p><strong>Tip 3: Sätt rätt pris</strong></p>
  <p>Branschmedelvärde för Hemstädning är 350-450 kr/h. Sätt 50 kr under medel första månaden för att samla recensioner snabbt.</p>
</div>

<a href="https://spick.se/stadare-dashboard.html" class="btn">Optimera din profil →</a>

<p style="margin-top:24px">Vi finns för dig. Svara på detta mejl om något är otydligt.</p>

<p>Hälsningar,<br>Farhad</p>
```

---

## Mail 3 — Vecka 1 (Dag 7)

**Subject:** Din egen profil-länk — så marknadsför du dig själv 📣
**From:** Spick <hello@spick.se>

```html
<h2>Du har en egen mini-hemsida på Spick — använd den!</h2>

<p>Visste du att du har en personlig länk som du kan dela var du vill?</p>

<div class="card" style="text-align:center">
  <p style="font-size:18px;margin:0"><strong>https://spick.se/s/{{slug}}</strong></p>
</div>

<p><strong>3 sätt att få bokningar genom din profil-länk:</strong></p>

<div class="card">
  <p><strong>1. Sociala medier</strong></p>
  <p>Lägg länken i Instagram-bio, Facebook-profil, TikTok-bio. Posta 1 story/vecka som leder till länken.</p>
</div>

<div class="card">
  <p><strong>2. Visitkort + dörrhängare</strong></p>
  <p>QR-koden i din dashboard (under "Min profil-länk") kan printas på visitkort. Dela ut i din lokal-area.</p>
</div>

<div class="card">
  <p><strong>3. Mejl-signatur</strong></p>
  <p>Lägg till "Boka mig på Spick: spick.se/s/{{slug}}" i din mejl-signatur.</p>
</div>

<p><strong>Varje bokning du driver in via din länk = du får 88% av jobb-priset.</strong> Spick tar bara 12%.</p>

<a href="https://spick.se/stadare-dashboard.html#tab-home" class="btn">Generera QR-kod →</a>

<p style="margin-top:24px">Bästa städarna får 5-10 nya kunder per månad bara genom egna kanaler.</p>

<p>/Farhad</p>
```

---

## Mail 4 — Månad 1 (Dag 30)

**Subject:** {{first_name}}, här är hur du får fler 5-stjärniga betyg ⭐
**From:** Spick <hello@spick.se>

```html
<h2>30 dagar på Spick — dags att bygga betygshistorik</h2>

<p>Hej {{first_name}}! Du har varit med oss en månad. Bra jobbat så här långt!</p>

<p>Recensioner är AVGÖRANDE för fler bokningar. En cleaner med 10+ betyg får 4x fler bokningar än en utan.</p>

<p><strong>3 saker som garanterar 5⭐:</strong></p>

<div class="card">
  <p><strong>1. Kommunicera FÖRE städningen</strong></p>
  <p>Skicka SMS dagen innan: "Hej! Jag kommer kl 10 imorgon. Något särskilt jag ska tänka på?" Bara att fråga visar professionalism.</p>
</div>

<div class="card">
  <p><strong>2. Foto efter avslutad städning</strong></p>
  <p>Skicka kund 2-3 foton av "after"-resultatet. Det skapar wow-effekt + bevis vid eventuell tvist.</p>
</div>

<div class="card">
  <p><strong>3. Be om betyg direkt på plats</strong></p>
  <p>När städningen är klar: "Tack för att du valde mig! Om allt såg bra ut, skulle du kunna betygsätta mig på Spick? Det hjälper mig enormt." 80% säger ja om du frågar då.</p>
</div>

<p><strong>Bonus:</strong> Spick skickar automatiskt påminnelse till kunden 2h efter städning (Sprint 5 — kommer snart). Men din direkta fråga gör 5x mer skillnad.</p>

<p>Vi tror på dig.<br>
Farhad och Spick-teamet</p>
```

---

## Implementation-plan (efter Farhad-godkännande)

### Migration
```sql
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS onboarding_emails_sent jsonb DEFAULT '{}';
-- Format: { "day_1": "2026-04-27T10:00:00Z", "day_3": null, ... }
CREATE INDEX IF NOT EXISTS idx_cleaners_onboarding_pending
  ON cleaners(approved_at)
  WHERE approved_at IS NOT NULL AND (onboarding_emails_sent->>'day_1' IS NULL
    OR onboarding_emails_sent->>'day_3' IS NULL
    OR onboarding_emails_sent->>'week_1' IS NULL
    OR onboarding_emails_sent->>'month_1' IS NULL);
```

### EF
`supabase/functions/cleaner-onboarding-emails/index.ts`:
- Cron-EF kör 1x/dag 09:00 CET
- Loopar approved cleaners
- För varje: kolla age + sent-status → skickar passande mail (eller skip om redan skickat)
- UPDATE cleaners SET onboarding_emails_sent = jsonb_set(..., '{day_X}', NOW())

### Workflow
`.github/workflows/cleaner-onboarding-emails.yml`:
- Schedule: dagligen 09:00 CET
- CRON_SECRET-auth (samma pattern som auto-remind)

---

## Vad du gör (Farhad)

1. **Läs igenom 4 mail-templates** — kommentera om något ska ändras (ton, exempel, CTA)
2. **Säg "godkänd"** → jag bygger migration + EF + cron-workflow + commit (~30 min)
3. **Verify Resend-domain** är OK för @spick.se sender (du har redan)

Tid till live efter godkännande: ~45 min.
