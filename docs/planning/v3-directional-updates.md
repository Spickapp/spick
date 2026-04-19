# v3 Directional Updates ? 2026-04-19 (sent kv?llsanteckning)

Dessa beslut togs i slutet av en l?ng byggsession (F1 Dag 2 komplett).
De ?r **anteckningar**, inte formell plan-uppdatering. Formell integration
i arkitekturplan-v3.md g?rs i fokuserad session senare.

## Beslut 1: Full Matching ?r core feature, inte v4

**Vision:** Uber-modell f?r st?dning. St?dare och firmor anger preferenser.
Kunder anger preferenser. Matchningssystemet parar automatiskt.

**Scope "full matching" (10 dimensioner):**
1. Tid/tillg?nglighet (recurring + eng?ngs)
2. Pris (st?dar-rate + kund-budget)
3. Kommunikationsspr?k
4. Husdjur (st?dare pet_pref finns, kund saknar)
5. Service addons (f?nster/ugn/kyl ? F1 Dag 1 grundlagt)
6. K?n (juridiskt k?nsligt ? kr?ver juristkonsult)
7. Erfarenhet/kvalitet (rating, review_count, completed_jobs)
8. Preferred cleaner (?terkommande kund-st?dare-relation)
9. RUT-ber?ttigande (filter)
10. F-skatt f?r B2B

**Status per dimension idag:**
- Klart: Geografi (PostGIS), tj?nst-matchning, kvalitetsdata
- Halvklart: Tid (Smart Instant Book), husdjur (bara st?dar-sida), addons
- Saknas helt: Spr?k, budget, k?n, preferred cleaner

**Estimerad scope:** 8-12 veckor + schema-?ndringar ?ver hela plattformen
+ ny UI p? b?de kund- och st?dar-sida + viktad scoring-algoritm.

**F?reslagen placering i v3:** Ny fas F14 "Matching & Preferences"
efter GA-kandidat 1 nov 2026. Deadline ej satt, sannolikt Q1 2027.

**F?rberedande arbete INNAN F14** (ska bakas in i existerande faser):
- F1 services-tabell: s?kerst?ll JSONB metadata-kolumn finns (klar via ui_config)
- F3 pricing: strukturera cleaner_service_prices f?r availability_window
- F-N kunder: l?gg till preferences JSONB-kolumn i customer-tabellen tidigt
- All ny data-modellering ska designas med matching-expansion i ?tanke

## Beslut 2: Admin = full CRUD + overblick

**Vision:** Admin har total kontroll. Kan g?ra precis vad som helst
i plattformen. Inkluderar:
- Manuell tilldelning av tj?nster till st?dare (admin.html:3719 ?r FEATURE)
- Override av matching-resultat om beh?vs
- Redigera kundprofil, st?darprofil, bokning, pris, allt
- Se alla tabeller, alla vyer, hela historiken

**Konsekvens:** Admin-edit-paths p? alla grunddata ska inte bara finnas
utan aktivt utvecklas och underh?llas. N?r v3-faser introducerar nya
tabeller, ska admin-UI f?r dessa byggas i samma fas (ej separat).

## Beslut 3: Pilot-scope under v3-bygge

Farhad hanterar sj?lv 1-2 st?dfirmor tillsvidare under bygge-fas.
Verifierar att plattformen fungerar med riktiga f?retag innan
bredare rollout. Rafael Arellano + Fazli (Solid Service) ?r
pilot-st?dfirmor.

Pilot-krav INNAN full launch:
- Mattreng?ring-backfill (0 st?dare har den idag)
- H?rdkodade RUT_SERVICES i stadare-dashboard:2230 + stadare-profil:301
  m?ste elimineras (dynamisk fr?n services-tabell)
- Services-v?rldens tre parallella modeller konsolideras (cleaners.services
  JSONB, cleaner_service_prices, nya services-tabellen)

## ?ppna spec-fr?gor (att besvara i n?sta fokuserade session)

1. Matching-algoritm: h?rd-filter vs viktad scoring vs hybrid?
2. Kund-preferens-UI: progressive disclosure vid bokning?
3. K?n-preferens: lagligt i Sverige? Jurist-konsultation beh?vs.
4. Preferred cleaner: hur hanteras n?r preferred ej tillg?nglig?
5. B2B vs B2C: olika matching-logik eller samma?
6. Matching-overrides: admin ska kunna "force-match" ? hur loggas det?

## N?sta steg

Formell v3-uppdatering (spec-dokument + fas F14-plan) g?rs i separat
session. Uppskattad tid: 2-3 timmar fokuserat arbete.

Prioritet-ordning efter dagens session:
1. F1 Dag 3 (admin + dashboard sync till services-tabellen) ? kritiskt
   innan full pilot-launch
2. Mattreng?ring-backfill eller soft-delete
3. Formell v3-matching-fas design
4. Forts?tt v3 i planerad fas-ordning (F2, F3, etc)

---

Skapad: 2026-04-19 00:15
Session: F1 Dag 2 komplett + matching-vision etablerad
Farhad-beslut dokumenterat utan att ?ndra kod eller formell plan.
