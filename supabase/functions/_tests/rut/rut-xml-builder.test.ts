/**
 * Tester för _shared/rut-xml-builder.ts (Fas 7.5)
 *
 * Verifierar:
 *  - PNR-validering (Luhn + format)
 *  - Åldersvalidering (≥18 vid betalningsår)
 *  - SKV-regelvalidering (max 100, samma år, belopp-relationer, etc.)
 *  - XML-generering enligt V6-schema
 *  - Spick booking → RutArende-mappning
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert@1";
import {
  validatePNR,
  validateAge18,
  validateBegaran,
  buildRutXml,
  mapSpickServiceToRutType,
  bookingToRutArende,
  type RutBegaran,
  type SpickBookingForRut,
} from "../../_shared/rut-xml-builder.ts";

// ════════════════════════════════════════════════════
// PNR-validering
// ════════════════════════════════════════════════════

Deno.test("validatePNR: giltig PNR (från SKV sample)", () => {
  // Från exempel_rut_3st.xml — dessa bör vara giltiga
  assertEquals(validatePNR("199604102393"), true);
  assertEquals(validatePNR("199701052384"), true);
  assertEquals(validatePNR("199611142390"), true);
});

Deno.test("validatePNR: fel längd", () => {
  assertEquals(validatePNR("19960410239"), false);
  assertEquals(validatePNR("1996041023939"), false);
  assertEquals(validatePNR(""), false);
});

Deno.test("validatePNR: icke-numeriskt", () => {
  assertEquals(validatePNR("19960410-239X"), false);
  assertEquals(validatePNR("abcdefghijkl"), false);
});

Deno.test("validatePNR: fel Luhn-checksum", () => {
  // Ta giltig PNR och ändra sista siffran
  assertEquals(validatePNR("199604102391"), false);
  assertEquals(validatePNR("199604102392"), false);
});

// ════════════════════════════════════════════════════
// Åldersvalidering
// ════════════════════════════════════════════════════

Deno.test("validateAge18: vuxen (≥18)", () => {
  // 199604102393 = född 1996-04-10, betalning 2022-01-03 → ålder 25
  assertEquals(validateAge18("199604102393", "2022-01-03"), true);
});

Deno.test("validateAge18: precis 18 på betalningsdatum", () => {
  // Hitta ett fungerande exempel — svårt utan Luhn-check så använd sample
  // Låt vara för nu — validateAge18 testas indirekt via validateBegaran
  assertEquals(validateAge18("199604102393", "2014-04-10"), true);  // 18 år exakt
  assertEquals(validateAge18("199604102393", "2014-04-09"), false); // 1 dag innan 18
});

// ════════════════════════════════════════════════════
// Begaran-validering (hela filen)
// ════════════════════════════════════════════════════

function validBegaran(): RutBegaran {
  return {
    namnPaBegaran: "Spick 2026-04",
    arenden: [
      {
        kopare: "199604102393",
        betalningsDatum: "2026-04-15",
        prisForArbete: 1200,
        betaltBelopp: 600,
        begartBelopp: 600,
        fakturaNr: "SP-2026-0001",
        ovrigkostnad: 0,
        utfortArbete: [
          { typ: "Stadning", antalTimmar: 4, materialkostnad: 0 },
        ],
      },
    ],
  };
}

Deno.test("validateBegaran: giltig minimalfil", () => {
  const errors = validateBegaran(validBegaran());
  assertEquals(errors.length, 0, `Förväntade inga fel men fick: ${JSON.stringify(errors)}`);
});

Deno.test("validateBegaran: tomt namn", () => {
  const b = validBegaran();
  b.namnPaBegaran = "";
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path === "namnPaBegaran"));
});

Deno.test("validateBegaran: namn för långt", () => {
  const b = validBegaran();
  b.namnPaBegaran = "A".repeat(17);
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path === "namnPaBegaran"));
});

Deno.test("validateBegaran: 0 ärenden", () => {
  const b = validBegaran();
  b.arenden = [];
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path === "arenden"));
});

Deno.test("validateBegaran: >100 ärenden", () => {
  const b = validBegaran();
  const one = b.arenden[0];
  b.arenden = Array.from({ length: 101 }, () => ({ ...one }));
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("Max 100")));
});

Deno.test("validateBegaran: olika betalningsår", () => {
  const b = validBegaran();
  b.arenden.push({
    ...b.arenden[0],
    betalningsDatum: "2025-12-15",
  });
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("samma år")));
});

Deno.test("validateBegaran: ogiltigt PNR", () => {
  const b = validBegaran();
  b.arenden[0].kopare = "199604102391";  // fel Luhn
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path.includes("kopare")));
});

Deno.test("validateBegaran: köpare = Spicks orgnr", () => {
  const b = validBegaran();
  b.arenden[0].kopare = "559402045220"; // Spicks orgnr som PNR (ogiltig ändå)
  const errors = validateBegaran(b);
  // Ska fånga EITHER PNR-format-fel EITHER Spick-nr-fel
  assert(errors.some((e) => e.path.includes("kopare")));
});

Deno.test("validateBegaran: begärt > betalt", () => {
  const b = validBegaran();
  b.arenden[0].begartBelopp = 700;
  b.arenden[0].betaltBelopp = 600;
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("Begärt belopp") && e.message.includes("betalt belopp")));
});

Deno.test("validateBegaran: betalt + begärt > arbetskostnad", () => {
  const b = validBegaran();
  b.arenden[0].betaltBelopp = 800;
  b.arenden[0].begartBelopp = 800;
  b.arenden[0].prisForArbete = 1200;  // 800+800=1600 > 1200
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("överstiga arbetskostnad")));
});

Deno.test("validateBegaran: prisForArbete < 2", () => {
  const b = validBegaran();
  b.arenden[0].prisForArbete = 1;
  b.arenden[0].betaltBelopp = 0;
  b.arenden[0].begartBelopp = 0;
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path.includes("prisForArbete")));
});

Deno.test("validateBegaran: fakturaNr > 20 tecken", () => {
  const b = validBegaran();
  b.arenden[0].fakturaNr = "A".repeat(21);
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path.includes("fakturaNr")));
});

Deno.test("validateBegaran: inget arbete", () => {
  const b = validBegaran();
  b.arenden[0].utfortArbete = [];
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.path.includes("utfortArbete")));
});

Deno.test("validateBegaran: både timmar och material 0", () => {
  const b = validBegaran();
  b.arenden[0].utfortArbete = [
    { typ: "Stadning", antalTimmar: 0, materialkostnad: 0 },
  ];
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("faktiska timmar")));
});

Deno.test("validateBegaran: datum före 2009-07-01", () => {
  const b = validBegaran();
  b.arenden[0].betalningsDatum = "2009-06-30";
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("2009-07-01")));
});

Deno.test("validateBegaran: datum i framtiden", () => {
  const b = validBegaran();
  b.arenden[0].betalningsDatum = "2099-12-31";
  const errors = validateBegaran(b);
  assert(errors.some((e) => e.message.includes("efter idag")));
});

// ════════════════════════════════════════════════════
// XML-generering
// ════════════════════════════════════════════════════

Deno.test("buildRutXml: giltig fil producerar korrekt XML", () => {
  const xml = buildRutXml(validBegaran());
  assert(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert(xml.includes("<ns1:Begaran"));
  assert(xml.includes("xmlns:ns1=\"http://xmls.skatteverket.se/se/skatteverket/ht/begaran/6.0\""));
  assert(xml.includes("xmlns:ns2=\"http://xmls.skatteverket.se/se/skatteverket/ht/komponent/begaran/6.0\""));
  assert(xml.includes("<ns2:NamnPaBegaran>Spick 2026-04</ns2:NamnPaBegaran>"));
  assert(xml.includes("<ns2:HushallBegaran>"));
  assert(xml.includes("<ns2:Kopare>199604102393</ns2:Kopare>"));
  assert(xml.includes("<ns2:BetalningsDatum>2026-04-15</ns2:BetalningsDatum>"));
  assert(xml.includes("<ns2:PrisForArbete>1200</ns2:PrisForArbete>"));
  assert(xml.includes("<ns2:BetaltBelopp>600</ns2:BetaltBelopp>"));
  assert(xml.includes("<ns2:BegartBelopp>600</ns2:BegartBelopp>"));
  assert(xml.includes("<ns2:FakturaNr>SP-2026-0001</ns2:FakturaNr>"));
  assert(xml.includes("<ns2:Stadning>"));
  assert(xml.includes("<ns2:AntalTimmar>4</ns2:AntalTimmar>"));
  assert(xml.includes("<ns2:Materialkostnad>0</ns2:Materialkostnad>"));
  assert(xml.endsWith("</ns1:Begaran>\n"));
});

Deno.test("buildRutXml: XML-escape av special-tecken", () => {
  const b = validBegaran();
  b.namnPaBegaran = "Spick & Co";
  b.arenden[0].fakturaNr = "SP-<2026>";
  const xml = buildRutXml(b);
  assert(xml.includes("Spick &amp; Co"));
  assert(xml.includes("SP-&lt;2026&gt;"));
});

Deno.test("buildRutXml: schablon-tjänst (Utfort=true)", () => {
  const b = validBegaran();
  b.arenden[0].utfortArbete = [
    { typ: "TvattVidTvattinrattning", utfort: true },
  ];
  const xml = buildRutXml(b);
  assert(xml.includes("<ns2:TvattVidTvattinrattning>"));
  assert(xml.includes("<ns2:Utfort>true</ns2:Utfort>"));
});

Deno.test("buildRutXml: Ovrigkostnad utelämnad om undefined", () => {
  const b = validBegaran();
  delete b.arenden[0].ovrigkostnad;
  const xml = buildRutXml(b);
  assert(!xml.includes("<ns2:Ovrigkostnad>"));
});

// ════════════════════════════════════════════════════
// Service-mappning
// ════════════════════════════════════════════════════

Deno.test("mapSpickServiceToRutType: Hemstädning → Stadning", () => {
  assertEquals(mapSpickServiceToRutType("Hemstädning"), "Stadning");
});

Deno.test("mapSpickServiceToRutType: Flyttstädning → Flyttjanster", () => {
  assertEquals(mapSpickServiceToRutType("Flyttstädning"), "Flyttjanster");
});

Deno.test("mapSpickServiceToRutType: Fönsterputs → Stadning", () => {
  assertEquals(mapSpickServiceToRutType("Fönsterputs"), "Stadning");
});

Deno.test("mapSpickServiceToRutType: Kontorsstädning → null (ej RUT)", () => {
  assertEquals(mapSpickServiceToRutType("Kontorsstädning"), null);
});

Deno.test("mapSpickServiceToRutType: okänd service → null", () => {
  assertEquals(mapSpickServiceToRutType("Fönstertvätt 3000"), null);
});

// ════════════════════════════════════════════════════
// Booking → RutArende
// ════════════════════════════════════════════════════

Deno.test("bookingToRutArende: standard RUT-bokning", () => {
  const booking: SpickBookingForRut = {
    id: "abc-123",
    booking_id: "SP-2026-0087",
    customer_pnr: "199604102393",
    completed_at: "2026-04-15T14:30:00Z",
    booking_date: "2026-04-15",
    payment_marked_at: "2026-04-15T10:00:00Z",
    service_type: "Hemstädning",
    total_price: 390,     // Kundens nettopris
    rut_amount: 390,      // RUT-avdrag (50% av arbetskostnad)
    actual_hours: 2,
    booking_hours: 2,
    receipt_number: "R-2026-0087",
  };

  const arende = bookingToRutArende(booking);
  assertExists(arende);
  assertEquals(arende!.kopare, "199604102393");
  assertEquals(arende!.betalningsDatum, "2026-04-15");
  assertEquals(arende!.prisForArbete, 780);  // total_price + rut_amount
  assertEquals(arende!.betaltBelopp, 390);
  assertEquals(arende!.begartBelopp, 390);
  assertEquals(arende!.fakturaNr, "R-2026-0087");
  assertEquals(arende!.ovrigkostnad, 0);
  assertEquals(arende!.utfortArbete.length, 1);
  const arbete = arende!.utfortArbete[0];
  assert("antalTimmar" in arbete);
  assertEquals(arbete.typ, "Stadning");
  assertEquals(arbete.antalTimmar, 2);
});

Deno.test("bookingToRutArende: non-RUT service returnerar null", () => {
  const booking: SpickBookingForRut = {
    id: "abc-123",
    customer_pnr: "199604102393",
    booking_date: "2026-04-15",
    service_type: "Kontorsstädning",
    total_price: 390,
    rut_amount: 0,
    booking_hours: 2,
  };

  assertEquals(bookingToRutArende(booking), null);
});

Deno.test("bookingToRutArende: använder actual_hours över booking_hours", () => {
  const booking: SpickBookingForRut = {
    id: "abc-123",
    customer_pnr: "199604102393",
    booking_date: "2026-04-15",
    service_type: "Hemstädning",
    total_price: 500,
    rut_amount: 500,
    actual_hours: 3,   // Faktisk tid
    booking_hours: 2,  // Bokad tid
  };

  const arende = bookingToRutArende(booking);
  assertExists(arende);
  const arbete = arende!.utfortArbete[0];
  assert("antalTimmar" in arbete);
  assertEquals(arbete.antalTimmar, 3);  // Ska använda actual_hours
});

Deno.test("bookingToRutArende: fakturaNr trunkeras till 20 tecken", () => {
  const booking: SpickBookingForRut = {
    id: "abc-123",
    customer_pnr: "199604102393",
    booking_date: "2026-04-15",
    service_type: "Hemstädning",
    total_price: 500,
    rut_amount: 500,
    booking_hours: 2,
    receipt_number: "A".repeat(30),  // > 20 tecken
  };

  const arende = bookingToRutArende(booking);
  assertExists(arende);
  assertEquals(arende!.fakturaNr!.length, 20);
});

// ════════════════════════════════════════════════════
// End-to-end integration
// ════════════════════════════════════════════════════

Deno.test("e2e: booking → arende → valid XML", () => {
  const booking: SpickBookingForRut = {
    id: "abc-123",
    booking_id: "SP-2026-0087",
    customer_pnr: "199604102393",
    booking_date: "2026-04-15",
    payment_marked_at: "2026-04-15T10:00:00Z",
    service_type: "Hemstädning",
    total_price: 390,
    rut_amount: 390,
    actual_hours: 2,
    booking_hours: 2,
    receipt_number: "R-2026-0087",
  };

  const arende = bookingToRutArende(booking);
  assertExists(arende);

  const begaran: RutBegaran = {
    namnPaBegaran: "Spick test",
    arenden: [arende!],
  };

  const errors = validateBegaran(begaran);
  assertEquals(errors.length, 0, `Validation errors: ${JSON.stringify(errors)}`);

  const xml = buildRutXml(begaran);
  assert(xml.includes("<ns2:Kopare>199604102393</ns2:Kopare>"));
  assert(xml.includes("<ns2:PrisForArbete>780</ns2:PrisForArbete>"));
  assert(xml.includes("<ns2:BegartBelopp>390</ns2:BegartBelopp>"));
});
