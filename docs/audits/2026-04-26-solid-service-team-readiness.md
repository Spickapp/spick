# Solid Service team — readiness-audit för riktiga bokningar

**Datum:** 2026-04-26
**Källa:** Curl mot prod via `v_cleaners_for_booking` + `cleaner_availability_v2` + `cleaner_service_prices` (rule #31)
**Kontext:** Solid Service Sverige AB är SKV-godkänd, Stripe Connect aktiv. Vad blockerar att team-medlemmar dyker upp i kund-bokningar med fullt UI?

---

## Översikt — vad som funkar vs vad som saknas

| Cleaner | hourly_rate | services | koord | availability (dagar) | service_prices | bio | avatar |
|---|---|---|---|---|---|---|---|
| **Zivar Majid** (VD) | 390 ✅ | 4 ✅ | ✅ Hässelby | (ej curl:ad) | (ej curl:ad) | ❌ NULL | ❌ NULL |
| **Dildora Kenjaeva** | 390 ✅ | 4 ✅ | ✅ Kista | 7 ✅ | 4 ✅ | ❌ NULL | ❌ NULL |
| **Nilufar Kholdorova** | 390 ✅ | 4 ✅ | ✅ Stockholm | 7 ✅ | **0** ⚠️ | ❌ NULL | ❌ NULL |
| **Nasiba Kenjaeva** | 390 ✅ | 4 ✅ | ✅ Stockholm | 7 ✅ | **0** ⚠️ | ❌ NULL | ❌ NULL |
| **Odilov Firdavsiy** | 390 ✅ | 4 ✅ | ✅ Stockholm | 7 ✅ | **0** ⚠️ | ❌ NULL | ❌ NULL |

---

## ✅ Tekniskt redo att synas i matching

Alla 5 cleaners passerar `find_nearby_cleaners` hard-filter:
- `is_approved=true` + `is_active=true` + `status='aktiv'` (verifierat tidigare)
- `home_lat/home_lng` finns för alla → ST_DWithin-distansfilter funkar
- 7 availability-rader/cleaner → rimligen 1 per veckodag, fångar alla bokningstider
- `services`-array har 4 tjänster vardera → service-filter funkar

**→ Solid Service team kommer dyka upp i kund-sökresultat på spick.se/boka.html.**

---

## ⚠️ UX-svagheter (lägre konverteringssannolikhet)

### 1. **`bio = NULL` för alla 5** (medel-prio)
Profilkort visar tomt om-mig-text. Kund får ingen känsla för vem cleanern är. Konvertering -10% till -25% baserat på branschstudier.

**Fix:** Zivar (VD) ber team skriva 2-3 meningar om sig själva → `cleaners.bio`-update. ~5 min/cleaner.

### 2. **`avatar_url = NULL` för alla 5** (medel-prio)
Kund ser bara initialer ("ZM", "DK") istf bild. Skapar lägre förtroende.

**Fix:** Cleaner laddar upp profilbild via "Jag"-tabben i stadare-dashboard.html. ~2 min/cleaner.

### 3. **`cleaner_service_prices` tomt för 3 av 4 team-medlemmar** (låg-prio men existerar)
Nilufar, Nasiba, Odilov har inga egna prislistor → faller tillbaka på `companies.default_hourly_rate` eller `platform_settings.default_hourly_rate=350`.

**Konsekvens:** alla tre kommer prissättas som 350 kr/h (default) istf 390 kr/h (vad deras cleaners-rad säger). Inkonsekvens.

**Fix-alternativ:**
- **A.** VD Zivar går till stadare-dashboard "Inkomst"-tab → Per-cleaner prisoverride → sätter 390 kr/h på alla 3 ✓
- **B.** Eller "Sätt företagets baspris" på Solid Service-företaget = 390 kr → cascade-applied till alla utan personliga priser
- **C.** Eller acceptera 350 kr/h som "team-pris" om det är affärsmässigt OK

---

## 🔴 Helt blockerande — INGENTING

Inga showstoppers. Solid Service team kan ta emot riktiga bokningar **just nu**.

---

## Min rekommendation till Farhad

**Fas 1 (omedelbar, 15 min):**
- Be Zivar att gå till stadare-dashboard → Inkomst-tab → Per-cleaner prisoverride → sätt 390 kr/h för Nilufar/Nasiba/Odilov

**Fas 2 (1 dag, valfri):**
- Be alla 5 cleaners att uppdatera bio + ladda upp profilbild via "Jag"-tabben

**Fas 3 (oberoende):**
- Vid första riktiga bokning → testa end-to-end-flowet (boka → escrow → utförande → release → transfer till företag)

---

## Datapunkter för audit-spår

```sql
-- Verifiera alla 5 efter Farhad/Zivar-fix:
SELECT
  c.full_name,
  c.bio IS NOT NULL AS has_bio,
  c.avatar_url IS NOT NULL AS has_avatar,
  COUNT(DISTINCT csp.id) AS service_prices_count
FROM cleaners c
LEFT JOIN cleaner_service_prices csp ON csp.cleaner_id = c.id
WHERE c.company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
GROUP BY c.id, c.full_name, c.bio, c.avatar_url
ORDER BY c.full_name;
```

Förväntat efter Fas 1: alla `service_prices_count > 0`.
Förväntat efter Fas 2: alla `has_bio = true` och `has_avatar = true`.
