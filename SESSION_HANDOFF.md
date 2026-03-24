# Spick – Session Handoff
Skapad: 2026-03-24

## HUR MAN HITTAR CREDENTIALS
- GitHub token: github.com/settings/tokens (regenerera vid ny session)
- Supabase: supabase.com/dashboard/project/urjeijcncsyuletprydy/settings/api
- Resend: resend.com/api-keys
- Admin: spick.se/admin.html (lösenord i admin.html source, byt till ngt bättre)

## PUSH-METODIK (kör i konsolen på spickapp.github.io/spick/)
Ersätt TOKEN med din GitHub personal access token:

const T='TOKEN',R='Spickapp/spick';
window.push=async(f,html,msg)=>{
  const i=await fetch('https://api.github.com/repos/'+R+'/contents/'+f,{headers:{'Authorization':'token '+T}}).then(r=>r.json());
  const bytes=new TextEncoder().encode(html);let bin='';bytes.forEach(b=>bin+=String.fromCharCode(b));
  const body={message:msg,content:btoa(bin)};if(i.sha)body.sha=i.sha;
  const res=await fetch('https://api.github.com/repos/'+R+'/contents/'+f,{method:'PUT',headers:{'Authorization':'token '+T,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  return res.commit?.sha?.slice(0,7)||res.message;
};

## SYSTEMSTATUS (2026-03-24)
- Live: spick.se + spickapp.github.io/spick
- 34 sidor, 20 stader med landing pages
- 9 stadare i Supabase (alla saknar email = PRIO)
- BankID-verifiering, AI-chatt, admin-panel, betyg, fakturor, backup-workflows

## TODOS I PRIORITETSORDNING

### PRIO 1 – Resend DNS (5 min i Loopia)
Resend domain ID: db7d6b85-c927-4dfa-8de7-5ec2221da7be
Status: Domain skapad, DNS-poster EJ inlagda i Loopia an

Poster att lagga in pa Loopia (spick.se → DNS-hantering):
- TXT  resend._domainkey  [se resend.com/domains/...]
- MX   send               feedback-smtp.eu-west-1.amazonses.com (prio 10)
- TXT  send               v=spf1 include:amazonses.com ~all
- TXT  _dmarc             v=DMARC1; p=none;

Klicka "Verify DNS Records" pa Resend efter Loopia.

### PRIO 2 – GitHub Secrets (5 min)
URL: github.com/Spickapp/spick/settings/secrets/actions
Lagga till: ANTHROPIC_API_KEY och SUPABASE_ANON_KEY
(aktiverar: nattlig backup, Claude Code via Issues, manadsraktura)

### PRIO 3 – Stadares email (10 min)
spick.se/admin.html → Stadare-fliken
Fyll i email pa alla 9 stadare – utan detta nar ingen bokningsnotis fram

### PRIO 4 – Testbokning (10 min)
spick.se/stadare.html → Boka en stadare → kontrollera:
a) Bekraftelsemail till kunden
b) Admin-notis till hello@spick.se
c) Bokningen syns i admin-panelen

### PRIO 5 – Byt admin-losenord
Hardkodat i admin.html – byt till nagonting starkt och unikt

### PRIO 6 – Rotera GitHub token
Gor efter Prio 2 ar klart. github.com/settings/tokens

## AFFARSMODELL
350 kr/h x 3h = 1050 kr brutto
Spick 17% = 178 kr per bokning
50 bok/man = 8 900 kr | 200 = 35 600 kr | 500 = 89 000 kr

Noejdhetsgaranti: Stadaren gor returbesok gratis (ingaar i avtal).
Spick betalar 0 kr extra. Triggas vid betyg 1-2 stjarnor.

## NATIONELL EXPANSION
- Stockholm: Live, 9 stadare, redo
- Goteborg/Malmo/Uppsala/+16 stader: Vaentlista aktiv
- Naesta steg: Facebook-annons i Goteborg (ca 500 kr) → 5 stadare

## DATABAS
Supabase projekt: urjeijcncsyuletprydy
Tabeller: cleaners, bookings, ratings, notifications, invoices, guarantee_requests, cleaner_applications
Alla med RLS aktiverat

## GITHUB ACTIONS (aktiva workflows)
- backup.yml: nattlig backup 02:00 (kraever SUPABASE_ANON_KEY secret)
- claude.yml: Claude Code via Issues (kraever ANTHROPIC_API_KEY secret)
- monthly-invoices.yml: manadsraktura 1:a varje manad
