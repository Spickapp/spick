# Team-bokning — Komplett specifikation
**Beslutad:** 9 april 2026
**Status:** Dokumenterad, byggs vid behov
**Bakgrund:** Städföretag (t.ex. Rafaels Rafa Allservice) behöver ibland ta med en kollega på större jobb. Kunden måste godkänna vem som kommer in i deras hem och kunna betygsätta båda.

---

## Principer

1. Priset ändras INTE — kunden betalar samma totalpris
2. Spick tar provision (17% privat / 12% företag) på hela beloppet
3. Utbetalning går till företagets Stripe-konto (redan byggt i stripe-connect)
4. Företaget fördelar intäkten internt — Spick blandar sig inte
5. Kunden har vetorätt — ingen extra person utan kundens uttryckliga OK
6. Funktionen är BARA tillgänglig för städare med company_id (teammedlemmar)

---

## Fullständigt flöde

### Steg 1: Städaren bjuder in kollega
- **Var:** stadare-uppdrag.html (bokningsdetaljer) eller stadare-dashboard.html
- **Villkor:** Bokningen måste ha status 'confirmed'. Städaren måste ha company_id.
- **Knapp:** "Lägg till kollega till detta jobb"
- **Visar:** Alla städare med samma company_id som är is_active=true och is_approved=true (exklusive sig själv)
- **Begränsning Fas 1:** Max 1 extra städare per bokning
- **Resultat:** Skapar rad i booking_team med status='invited'

### Steg 2: Kollegan svarar
- **Notis:** Mejl + SMS (via notify edge function, ny typ 'team_invite_colleague')
- **Mejltext:** "[Namn] vill att du hjälper till med ett städjobb [datum] kl [tid] på [adress]. [Acceptera] [Neka]"
- **Acceptera:** booking_team.status → 'accepted', gå vidare till steg 3
- **Neka:** booking_team.status → 'declined', primärstädaren får notis "Kollegan tackade nej", kan bjuda in en annan
- **Timeout:** Om inget svar inom 24h → status='expired', primärstädaren notifieras
- **Max inbjudningar:** 2 per bokning (förhindra spam)

### Steg 3: Kunden godkänner
- **Notis:** Mejl + SMS (ny typ 'team_invite_customer')
- **Mejltext:** "Hej [Kundnamn]! Din städare [Namn] vill ta med kollegan [Kollegans namn] på ditt jobb [datum]. [Kollegans namn] är verifierad på Spick. [Godkänn] [Neka]"
- **Länk:** Godkänn/neka via en signerad URL (t.ex. /team-approve?token=JWT)
- **Godkänn:** booking_team.customer_approved → true, båda städare notifieras
- **Neka:** booking_team.customer_approved → false, primärstädaren notifieras "Kunden godkände inte"
- **Timeout:** Om kunden inte svarar inom 48h → tolkas som nej, primärstädaren notifieras

### Steg 4: Jobbet utförs
- **min-bokning.html** visar: "Dina städare: [Primär] + [Kollega]" med avatar, namn, betyg för båda
- **GPS check-in:** Varje städare checkar in individuellt via stadare-uppdrag.html
- **Kunden ser:** "Maria checkade in 08:58" och "Sofia checkade in 09:02"

### Steg 5: Betygsättning
- **betyg.html** visar EN stjärnrad per städare (inte en gemensam)
- **Varje review** sparas i reviews-tabellen med respektive cleaner_id
- **Båda städare** bygger sin egen rating individuellt
- **Kommentarfält:** Ett per städare, eller ett gemensamt (TBD vid implementation)

### Steg 6: Betalning
- INGEN förändring i betalningsflödet
- Kunden betalade redan via Stripe Checkout vid bokning
- Utbetalning (stripe-connect, action: payout_booking) går till companies.stripe_account_id
- Redan implementerat: rad 106-112 i stripe-connect/index.ts kontrollerar company_id

---

## Edge cases

### Bokning avbokas medan invite är pending
- booking-cancel-v2 ska automatiskt sätta alla booking_team-rader till status='cancelled'
- Kollegan får notis: "Bokningen har avbokats"

### Primärstädaren avbokar men kollegan har accepterat
- Kollegan kan INTE utföra jobbet ensam (kunden bokade en specifik städare)
- Hela bokningen avbokas, kunden får återbetalning enligt vanlig policy
- Alla booking_team-rader sätts till 'cancelled'

### Kollegan dyker inte upp
- Primärstädaren ansvarar — det är företagets interna ansvar
- Kunden betygsätter båda, frånvarande kollega får 1 stjärna
- Admin notifieras om kollega har checkin_time = NULL efter jobbets sluttid

### Kunden nekar
- Primärstädaren får notis: "Kunden godkände inte extra städare på detta jobb"
- Städaren kan: (a) bjuda in en annan kollega (om < 2 försök), (b) hantera jobbet ensam, (c) kontakta Spick om jobbet är för stort ensam
- Max 2 inbjudningsförsök per bokning totalt

### Vem kan bjuda in?
- Alla teammedlemmar i samma company_id kan bjuda in varandra (inte bara owner)
- Dock kan man bara bjuda in från EGET company_id (inte externa städare)

---

## Ansvarsförsäkring — juridisk TODO

Nuvarande uppdragsavtal (uppdragsavtal.html) säger:
- "Vid skada i kundens hem ansvarar Städaren i första hand"
- "Krav på ansvarsförsäkring" (rad 65-66)

Men nämner INGET om team-uppdrag. Innan denna feature lanseras MÅSTE uppdragsavtalet uppdateras med:
- Företagets ägare (company_owner) ansvarar solidariskt för alla teammedlemmar på jobbet
- Alla teammedlemmar måste ha giltig ansvarsförsäkring ELLER omfattas av företagets försäkring
- Kunden ska kunna rikta krav mot företaget, inte behöva identifiera vilken städare som orsakade skadan

**BLOCKERARE:** Lansera INTE team-bokning utan uppdaterat uppdragsavtal.

---

## Databasschema

```sql
CREATE TABLE booking_team (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  cleaner_id uuid REFERENCES cleaners(id) NOT NULL,
  invited_by uuid REFERENCES cleaners(id) NOT NULL,
  status text DEFAULT 'invited' NOT NULL,
  -- status: invited → accepted/declined/expired → cancelled
  customer_approved boolean DEFAULT null,
  -- null = ej tillfrågad ännu, true = godkänd, false = nekad
  invite_sent_at timestamptz DEFAULT now(),
  colleague_responded_at timestamptz,
  customer_responded_at timestamptz,
  checkin_lat double precision,
  checkin_lng double precision,
  checkin_time timestamptz,
  checkout_time timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(booking_id, cleaner_id)
);
CREATE INDEX idx_booking_team_booking ON booking_team(booking_id);
CREATE INDEX idx_booking_team_cleaner ON booking_team(cleaner_id);
CREATE INDEX idx_booking_team_status ON booking_team(status);

-- RLS: städare ser bara rader där de är cleaner_id eller invited_by
ALTER TABLE booking_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_team_select ON booking_team FOR SELECT
  USING (cleaner_id = auth.uid() OR invited_by = auth.uid());
CREATE POLICY booking_team_insert ON booking_team FOR INSERT
  WITH CHECK (invited_by = auth.uid());
```

---

## Filer som påverkas vid implementation

| Fil | Ändring |
|---|---|
| SQL | CREATE TABLE booking_team + RLS |
| stadare-uppdrag.html | "Lägg till kollega"-knapp, visa teammedlemmar |
| stadare-dashboard.html | Visa kollegainfo på bokningar |
| notify/index.ts | Nya typer: team_invite_colleague, team_invite_customer, team_invite_result |
| min-bokning.html | Visa alla städare på jobbet |
| betyg.html | Stjärnrad per städare |
| admin.html | Visa team-info på bokningsdetaljer |
| booking-cancel-v2/index.ts | Cascada cancel till booking_team-rader |
| uppdragsavtal.html | Juridisk klausul om solidariskt ansvar vid team-uppdrag |

---

## Manuell lösning (Fas 1 — nu)

Tills denna feature byggs hanteras team-jobb manuellt:

1. Städaren ringer Farhad: "Jag behöver ta med Sofia på jobbet den 15:e"
2. Farhad mejlar kunden: "Din städare Maria vill ta med kollegan Sofia. Här är hennes profil: spick.se/s/sofia-eriksson. Är det okej?"
3. Kunden svarar ja/nej
4. Om ja: Farhad noterar i admin_notes på bokningen: "Team: Maria + Sofia (godkänt av kund)"
5. Utbetalning går till företagskontot automatiskt

---

## Bygg när (alla tre kriterier ska vara uppfyllda)

1. Minst 1 företag med 2+ aktiva godkända teammedlemmar (båda med Stripe)
2. Minst 3 bokningar som har krävt extra städare och lösts manuellt
3. Uppdragsavtalet uppdaterat med solidariskt ansvar-klausul
