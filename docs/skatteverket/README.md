# Skatteverket — primärkälla för RUT-integration

**Syfte:** Officiella Skatteverket-dokument och schema som Spick bygger RUT-XML-export mot (Fas 7.5).

**Hämtat:** 2026-04-24 från `xmls.skatteverket.se` (publikt, ingen auth).

## Innehåll

| Fil | Syfte | SKV URL |
|---|---|---|
| `xsd-v6/Begaran.xsd` | Huvudschema | http://xmls.skatteverket.se/se/skatteverket/ht/begaran/V6/Begaran.xsd |
| `xsd-v6/BegaranCOMPONENT.xsd` | Komponentschema (typer) | http://xmls.skatteverket.se/se/skatteverket/ht/komponent/V6/BegaranCOMPONENT.xsd |
| `xsd-v6/exempel_rut_3st.xml` | SKV:s sample för RUT | http://xmls.skatteverket.se/se/skatteverket/ht/begaran/exempel_rut_3st.xml |
| `xsd-v6/exempel_rot_3st.xml` | SKV:s sample för ROT | http://xmls.skatteverket.se/se/skatteverket/ht/begaran/exempel_rot_3st.xml |

## Användning

**Spicks kod läser INTE dessa filer i runtime.** De ligger här som:
1. Primärkälla för jurist-granskning
2. Referens för XSD-validering i CI/tester
3. Dokumentation för framtida underhåll

## Versioning

**Aktuell version: V6** (gäller fr.o.m. 2021-01-01).
När SKV släpper V7:
1. Hämta ny XSD + samples
2. Uppdatera `_shared/rut-xml-builder.ts` namespace + eventuella nya fält
3. Testa mot nya sample-XML
4. Uppdatera denna README

## Regler för giltig fil (från SKV e-tjänst)

- Max 100 köpare per fil
- ROT och RUT får **INTE** blandas i samma fil
- Alla `BetalningsDatum` i filen måste vara inom **samma kalenderår**
- Köparens PNR formellt korrekt (Luhn + ≥18 år)
- Köparens PNR ≠ utförarens orgnr (Spick 559402-4522)
- `BetalningsDatum` ≥ 2009-07-01, ≤ ansökningsdatum
- `BegartBelopp` ≤ `BetaltBelopp`
- `BegartBelopp + BetaltBelopp` ≤ `PrisForArbete` (+ ev. tidigare begärt för samma jobb)
- Timmar + materialkostnad för minst ett arbetsområde (fastpris måste rapportera faktiska timmar)

## Portal för manuell uppladdning

https://www7.skatteverket.se/portal/rotrut/begar-utbetalning/fil

Farhad loggar in som ombud för Haghighi Consulting AB (559402-4522) och laddar upp filen.

## Officiell dokumentation

- [Schemalager (XML) översikt](https://skatteverket.se/foretag/etjansterochblanketter/allaetjanster/schemalagerxml.4.dfe345a107ebcc9baf80006452.html)
- [Rot och rut — företag XML-schema](https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/schemalagerxml/rotochrutforetag.4.71004e4c133e23bf6db800063583.html)
- [Regler för att importera fil](https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/schemalagerxml/rotochrutforetag/reglerforattimporterafiltillrotochrut.4.76a43be412206334b89800033198.html)

## Rule #30 + #31 statement

All implementation i `supabase/functions/rut-batch-export-xml/` och `_shared/rut-xml-builder.ts` bygger på:
- XSD V6 ovan (primärkälla, inte antagande)
- SKV:s publika valideringsregler (citerade i kod-kommentarer)
- Inga tolkningar av regler utöver vad SKV dokumenterar publikt

Vid regel-osäkerhet → fråga Skatteverket direkt, uppdatera denna README.
