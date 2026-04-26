# §3.8 admin matching-dashboard — UI-mockup

**Status:** Mockup för Farhad-OK
**Bygge-estimat:** 4-6h

---

## Syfte

Ge **admin (du som plattform-ägare)** observability över matching-algoritmen:
- Vilka cleaners visas oftast i kund-sökresultat?
- Vilka cleaners "glöms bort" trots att de är aktiva?
- Vad är distance/rating/score-distributionen?
- Är providers-shadow-loggen rimlig (Modell B vs v2-jämförelse)?

---

## UX — ny sida `admin-matching.html` (eller tab i admin.html)

### Sektion 1 — Top 20 mest visade cleaners (senaste 30 dagarna)

```
┌─ Cleaners — visningsfrekvens i sökresultat ──────────┐
│  Cleaner                Visningar   Avg score   Bokn │
│  ────────────────────────────────────────────────────│
│  Zivar Majid (Solid)         48      0.78       0    │
│  Daniella Ruz Ramos          42      0.71       3    │
│  Dildora Kenjaeva (Solid)    37      0.74       0    │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

**Källa:** `matching_shadow_log`-tabell (per CLAUDE.md, populeras vid varje matching-anrop).

### Sektion 2 — "Glömda" cleaners (aktiva men 0 visningar)

```
┌─ Cleaners som inte syns i resultat ──────────────────┐
│  Cleaner          Status    Anledning (förslag)      │
│  ──────────────────────────────────────────────────── │
│  Maria Avendaño   aktiv    home_lat=NULL ❌          │
│  John Doe         aktiv    Inga matchande tider     │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

→ Klick på rad → visar exakt vilket hard-filter som blockerar.

### Sektion 3 — Score-distribution (histogram)

```
Match-score-distribution (senaste 100 anrop):
0.0-0.2  ▓▓
0.2-0.4  ▓▓▓▓▓
0.4-0.6  ▓▓▓▓▓▓▓▓▓▓▓▓
0.6-0.8  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
0.8-1.0  ▓▓▓▓▓▓▓▓▓
```

→ Säkerställer att algorithmen inte är degenererad (alla = samma score).

### Sektion 4 — Modell-jämförelse (providers vs v2)

```
┌─ Algorithm-jämförelse (senaste 7 dagar) ─────────────┐
│                                                      │
│  Match-rank-skillnad mellan providers och v2:        │
│  Same rank top-3:    78% av anropen ✓               │
│  Top-3 rotated:      18% av anropen                  │
│  Top-3 different:    4% av anropen ⚠               │
│                                                      │
│  → Tryggt att aktivera providers som primary?       │
│    JA om rotation < 5%. Idag: 4% — OK.              │
└──────────────────────────────────────────────────────┘
```

### Sektion 5 — RPC-performance

```
┌─ find_nearby_cleaners — performance ─────────────────┐
│  P50 latency:    34 ms  ✓                            │
│  P95 latency:   142 ms  ✓                            │
│  P99 latency:   587 ms  ⚠ kollas                    │
│  Genomsnitt cleaners returnerade: 4.2                │
│  Anrop senaste 24h:  87                              │
└──────────────────────────────────────────────────────┘
```

---

## Backend — ny EF `admin-matching-stats`

**Aggregerar från:**
- `matching_shadow_log` (visningar per cleaner)
- `bookings` (faktiska bokningar för konvertering)
- Pg_stat_statements (RPC-latency — kräver service-role)
- `cleaners` (för "glömda"-listan)

**Auth:** admin-only (samma pattern som admin-dispute-decide-wrapper).

**JSON-respons:** ~150 rader struktur med 5 sektioner ovan.

---

## 4 frågor till Farhad innan bygge

1. **Sida vs tab:** ny `admin-matching.html` eller integrerat i existing admin.html?
2. **Refresh-frekvens:** real-time (var 30 sek) eller manuell refresh-knapp?
3. **Export:** CSV-knapp för score-distribution (för djupare analys i Excel)?
4. **Alerter:** auto-alert till dig om "glömda cleaners > 10" eller P99 latency > 1000ms?

---

## Säg en bokstav

- **OK** — bygg som beskrivet
- **Justera X** — säg vad
- **Vänta** — diskutera mer först

(Lägre prio än kalender + villkor — kan vänta.)
