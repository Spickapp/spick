/**
 * _shared/rut-xml-builder.ts — Fas 7.5 RUT XML-generator
 *
 * Genererar XML-fil enligt Skatteverkets schema V6 för uppladdning till
 * https://www7.skatteverket.se/portal/rotrut/begar-utbetalning/fil
 *
 * Primärkälla:
 *   - docs/skatteverket/xsd-v6/Begaran.xsd (huvudschema)
 *   - docs/skatteverket/xsd-v6/BegaranCOMPONENT.xsd (typer)
 *   - docs/skatteverket/xsd-v6/exempel_rut_3st.xml (sample)
 *
 * Validering görs både i TS (pre-export) och av SKV (post-upload).
 * Vi validerar ALLT vi kan innan export för att minska risken för
 * SKV-avslag som kostar tid att fixa.
 *
 * Rule #30: Alla regler är från SKV:s publika dokumentation:
 *   https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/schemalagerxml/rotochrutforetag/reglerforattimporterafiltillrotochrut.4.76a43be412206334b89800033198.html
 *
 * Namespace:
 *   ns1 = http://xmls.skatteverket.se/se/skatteverket/ht/begaran/6.0
 *   ns2 = http://xmls.skatteverket.se/se/skatteverket/ht/komponent/begaran/6.0
 */

export const RUT_XML_NS1 = "http://xmls.skatteverket.se/se/skatteverket/ht/begaran/6.0";
export const RUT_XML_NS2 = "http://xmls.skatteverket.se/se/skatteverket/ht/komponent/begaran/6.0";

// SKV-regler
export const MAX_BUYERS_PER_FILE = 100;
export const MAX_BATCH_NAME_LENGTH = 16;
export const MIN_BATCH_NAME_LENGTH = 1;
export const MIN_PAYMENT_DATE = "2009-07-01";
export const MIN_BUYER_AGE_YEARS = 18;

// Spicks egen orgnr — kund-PNR får inte vara denna
export const SPICK_ORG_NR = "559402-4522";

// ────────────────────────────────────────────────────────────────
// Typer
// ────────────────────────────────────────────────────────────────

/**
 * Arbetstyper inom RUT (från BegaranCOMPONENT.xsd HushallArendeTYPE).
 * Spick använder primärt "Stadning". Övriga listade för fullständighet.
 */
export type RutArbetstyp =
  | "Stadning"
  | "KladOchTextilvard"
  | "Snoskottning"
  | "Tradgardsarbete"
  | "Barnpassning"
  | "Personligomsorg"
  | "Flyttjanster"
  | "ItTjanster"
  | "ReparationAvVitvaror"
  | "Moblering"
  | "TillsynAvBostad";

/** Schablon-tjänster som använder <Utfort>true</Utfort> istället för timmar */
export type RutSchablonTjanst =
  | "TransportTillForsaljning"
  | "TvattVidTvattinrattning";

export type RutArbete = {
  typ: RutArbetstyp;
  antalTimmar: number;       // 0-999, krävs i praktiken
  materialkostnad: number;   // 0-9 999 999
};

export type RutSchablon = {
  typ: RutSchablonTjanst;
  utfort: boolean;
};

export type RutArende = {
  kopare: string;               // 12-siffrigt PNR
  betalningsDatum: string;      // YYYY-MM-DD
  prisForArbete: number;        // 2-99 999 999 999
  betaltBelopp: number;         // 0-99 999 999 999
  begartBelopp: number;         // 0-99 999 999 999
  fakturaNr?: string;           // Max 20 tecken, valfri
  ovrigkostnad?: number;        // 0-9 999 999, valfri (krävs om arbete angetts)
  utfortArbete: Array<RutArbete | RutSchablon>;
};

export type RutBegaran = {
  namnPaBegaran: string;        // 1-16 tecken
  arenden: RutArende[];         // 1-100 st
};

export type ValidationError = {
  path: string;
  message: string;
};

// ────────────────────────────────────────────────────────────────
// Validering
// ────────────────────────────────────────────────────────────────

/**
 * Validera att PNR har korrekt format (12 siffror) + Luhn-checksum.
 * Format: YYYYMMDDNNNC där C är kontrollsiffran (Luhn mod10).
 */
export function validatePNR(pnr: string): boolean {
  if (!/^\d{12}$/.test(pnr)) return false;
  // Luhn mod10 på sista 10 siffrorna (YYMMDD-NNNC)
  const last10 = pnr.slice(2);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = parseInt(last10[i], 10);
    const doubled = i % 2 === 0 ? digit * 2 : digit;
    sum += doubled >= 10 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/**
 * Validera att personen är ≥18 under betalningsåret.
 */
export function validateAge18(pnr: string, paymentDate: string): boolean {
  if (!validatePNR(pnr)) return false;
  const birthYear = parseInt(pnr.slice(0, 4), 10);
  const birthMonth = parseInt(pnr.slice(4, 6), 10);
  const birthDay = parseInt(pnr.slice(6, 8), 10);
  const birthDate = new Date(birthYear, birthMonth - 1, birthDay);
  const paymentDateObj = new Date(paymentDate);
  const age = paymentDateObj.getFullYear() - birthDate.getFullYear();
  const monthDiff = paymentDateObj.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && paymentDateObj.getDate() < birthDate.getDate())) {
    return age - 1 >= MIN_BUYER_AGE_YEARS;
  }
  return age >= MIN_BUYER_AGE_YEARS;
}

/**
 * Validera hela begäran mot SKV:s regler. Returnerar lista av fel.
 * Tom lista = giltig fil.
 */
export function validateBegaran(data: RutBegaran): ValidationError[] {
  const errors: ValidationError[] = [];

  // NamnPaBegaran
  if (!data.namnPaBegaran || data.namnPaBegaran.length < MIN_BATCH_NAME_LENGTH) {
    errors.push({ path: "namnPaBegaran", message: "Namn på begäran krävs" });
  } else if (data.namnPaBegaran.length > MAX_BATCH_NAME_LENGTH) {
    errors.push({
      path: "namnPaBegaran",
      message: `Namn får vara max ${MAX_BATCH_NAME_LENGTH} tecken (är ${data.namnPaBegaran.length})`,
    });
  }

  // Antal ärenden
  if (!data.arenden || data.arenden.length === 0) {
    errors.push({ path: "arenden", message: "Minst 1 ärende krävs" });
    return errors;
  }
  if (data.arenden.length > MAX_BUYERS_PER_FILE) {
    errors.push({
      path: "arenden",
      message: `Max ${MAX_BUYERS_PER_FILE} ärenden per fil (är ${data.arenden.length})`,
    });
  }

  // Alla BetalningsDatum inom samma kalenderår (SKV-regel)
  const years = new Set(
    data.arenden.map((a) => a.betalningsDatum?.slice(0, 4)).filter(Boolean),
  );
  if (years.size > 1) {
    errors.push({
      path: "arenden",
      message: `Alla betalningsdatum måste vara samma år (hittade ${Array.from(years).join(", ")})`,
    });
  }

  // Per ärende
  const todayStr = new Date().toISOString().slice(0, 10);
  data.arenden.forEach((a, idx) => {
    const p = `arenden[${idx}]`;

    // PNR-format + Luhn
    if (!validatePNR(a.kopare)) {
      errors.push({ path: `${p}.kopare`, message: `Ogiltigt PNR-format (12 siffror + Luhn): ${a.kopare}` });
    }

    // PNR ≠ Spick org-nr (utan streck)
    if (a.kopare === SPICK_ORG_NR.replace(/-/g, "")) {
      errors.push({ path: `${p}.kopare`, message: "Köparens PNR får inte vara Spicks orgnr" });
    }

    // BetalningsDatum
    if (!a.betalningsDatum || !/^\d{4}-\d{2}-\d{2}$/.test(a.betalningsDatum)) {
      errors.push({ path: `${p}.betalningsDatum`, message: "Format YYYY-MM-DD krävs" });
    } else {
      if (a.betalningsDatum < MIN_PAYMENT_DATE) {
        errors.push({
          path: `${p}.betalningsDatum`,
          message: `Får inte vara tidigare än ${MIN_PAYMENT_DATE}`,
        });
      }
      if (a.betalningsDatum > todayStr) {
        errors.push({
          path: `${p}.betalningsDatum`,
          message: "Får inte vara efter idag",
        });
      }
      // Ålders-check
      if (validatePNR(a.kopare) && !validateAge18(a.kopare, a.betalningsDatum)) {
        errors.push({
          path: `${p}.kopare`,
          message: "Köparen måste fylla minst 18 under betalningsåret",
        });
      }
    }

    // Belopp-validering
    if (a.prisForArbete < 2) {
      errors.push({ path: `${p}.prisForArbete`, message: "Minst 2 kr arbetskostnad" });
    }
    if (a.betaltBelopp < 0) {
      errors.push({ path: `${p}.betaltBelopp`, message: "Kan inte vara negativt" });
    }
    if (a.begartBelopp < 0) {
      errors.push({ path: `${p}.begartBelopp`, message: "Kan inte vara negativt" });
    }
    if (a.begartBelopp > a.betaltBelopp) {
      errors.push({
        path: `${p}.begartBelopp`,
        message: `Begärt belopp (${a.begartBelopp}) får inte överstiga betalt belopp (${a.betaltBelopp})`,
      });
    }
    const sumPaidAndRequested = a.betaltBelopp + a.begartBelopp;
    if (sumPaidAndRequested > a.prisForArbete) {
      errors.push({
        path: `${p}.begartBelopp`,
        message: `Betalt + begärt (${sumPaidAndRequested}) får inte överstiga arbetskostnad (${a.prisForArbete})`,
      });
    }

    // FakturaNr max 20 tecken
    if (a.fakturaNr && a.fakturaNr.length > 20) {
      errors.push({
        path: `${p}.fakturaNr`,
        message: `Max 20 tecken (är ${a.fakturaNr.length})`,
      });
    }

    // UtfortArbete: minst ett
    if (!a.utfortArbete || a.utfortArbete.length === 0) {
      errors.push({
        path: `${p}.utfortArbete`,
        message: "Minst ett arbetsområde krävs",
      });
    } else {
      a.utfortArbete.forEach((w, widx) => {
        const wp = `${p}.utfortArbete[${widx}]`;
        if ("utfort" in w) {
          // Schablon-tjänst
          if (!w.utfort) {
            errors.push({ path: `${wp}.utfort`, message: "Utfört måste vara true om tjänsten rapporteras" });
          }
        } else {
          // Arbete med timmar + material
          if (w.antalTimmar < 0 || w.antalTimmar > 999) {
            errors.push({ path: `${wp}.antalTimmar`, message: "0-999 tillåtet" });
          }
          if (w.materialkostnad < 0 || w.materialkostnad > 9_999_999) {
            errors.push({ path: `${wp}.materialkostnad`, message: "0-9 999 999 tillåtet" });
          }
          // SKV-regel: fastprisjobb ska ändå rapportera faktiska timmar
          if (w.antalTimmar === 0 && w.materialkostnad === 0) {
            errors.push({
              path: `${wp}`,
              message: "Både timmar och material 0 — rapportera faktiska timmar även vid fastpris",
            });
          }
        }
      });
    }
  });

  return errors;
}

// ────────────────────────────────────────────────────────────────
// XML-generering
// ────────────────────────────────────────────────────────────────

/**
 * Escape XML special characters.
 */
function xmlEscape(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Bygg XML-fil från validerad RutBegaran.
 * Returnerar XML-sträng (UTF-8) redo att sparas som .xml-fil.
 *
 * OBS: Validera FÖRST med validateBegaran(). Denna funktion gör ingen
 * validering själv — den antar indata är giltig.
 */
export function buildRutXml(data: RutBegaran): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<ns1:Begaran xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns1="${RUT_XML_NS1}" xmlns:ns2="${RUT_XML_NS2}">`,
  );
  lines.push(`\t<ns2:NamnPaBegaran>${xmlEscape(data.namnPaBegaran)}</ns2:NamnPaBegaran>`);
  lines.push(`\t<ns2:HushallBegaran>`);

  for (const a of data.arenden) {
    lines.push(`\t\t<ns2:Arenden>`);
    lines.push(`\t\t\t<ns2:Kopare>${xmlEscape(a.kopare)}</ns2:Kopare>`);
    lines.push(`\t\t\t<ns2:BetalningsDatum>${xmlEscape(a.betalningsDatum)}</ns2:BetalningsDatum>`);
    lines.push(`\t\t\t<ns2:PrisForArbete>${a.prisForArbete}</ns2:PrisForArbete>`);
    lines.push(`\t\t\t<ns2:BetaltBelopp>${a.betaltBelopp}</ns2:BetaltBelopp>`);
    lines.push(`\t\t\t<ns2:BegartBelopp>${a.begartBelopp}</ns2:BegartBelopp>`);
    if (a.fakturaNr) {
      lines.push(`\t\t\t<ns2:FakturaNr>${xmlEscape(a.fakturaNr)}</ns2:FakturaNr>`);
    }
    if (typeof a.ovrigkostnad === "number") {
      lines.push(`\t\t\t<ns2:Ovrigkostnad>${a.ovrigkostnad}</ns2:Ovrigkostnad>`);
    }
    lines.push(`\t\t\t<ns2:UtfortArbete>`);
    for (const w of a.utfortArbete) {
      if ("utfort" in w) {
        lines.push(`\t\t\t\t<ns2:${w.typ}>`);
        lines.push(`\t\t\t\t\t<ns2:Utfort>${w.utfort}</ns2:Utfort>`);
        lines.push(`\t\t\t\t</ns2:${w.typ}>`);
      } else {
        lines.push(`\t\t\t\t<ns2:${w.typ}>`);
        lines.push(`\t\t\t\t\t<ns2:AntalTimmar>${w.antalTimmar}</ns2:AntalTimmar>`);
        lines.push(`\t\t\t\t\t<ns2:Materialkostnad>${w.materialkostnad}</ns2:Materialkostnad>`);
        lines.push(`\t\t\t\t</ns2:${w.typ}>`);
      }
    }
    lines.push(`\t\t\t</ns2:UtfortArbete>`);
    lines.push(`\t\t</ns2:Arenden>`);
  }

  lines.push(`\t</ns2:HushallBegaran>`);
  lines.push(`</ns1:Begaran>`);
  return lines.join("\n") + "\n";
}

// ────────────────────────────────────────────────────────────────
// Mappning från Spick-booking till RutArende
// ────────────────────────────────────────────────────────────────

/**
 * Mappa Spick service_type → SKV RutArbetstyp.
 * RUT-berättigade städtjänster enligt docs/sanning/rut.md.
 */
export function mapSpickServiceToRutType(serviceType: string): RutArbetstyp | null {
  const map: Record<string, RutArbetstyp> = {
    "Hemstädning": "Stadning",
    "Storstädning": "Stadning",
    "Flyttstädning": "Flyttjanster",  // SKV separerar flytt från städning
    "Fönsterputs": "Stadning",
    "Trappstädning": "Stadning",
  };
  return map[serviceType] ?? null;
}

export type SpickBookingForRut = {
  id: string;
  booking_id?: string | null;       // Spick's booking_id-sträng (SP-2026-XXXX)
  customer_pnr: string;              // 12-siffrig
  completed_at?: string | null;
  booking_date: string;
  payment_marked_at?: string | null;
  service_type: string;
  total_price: number;              // Kundens nettopris efter RUT
  rut_amount: number;               // 50% av arbetskostnad
  actual_hours?: number | null;
  booking_hours: number;
  receipt_number?: string | null;
};

/**
 * Konvertera Spick-booking till en RutArende.
 *
 * Beräkningar (verifierade mot docs/sanning/rut.md + SKV-regler):
 *   - prisForArbete = total_price + rut_amount (brutto-arbetskostnad)
 *   - betaltBelopp = total_price (vad kunden faktiskt betalat)
 *   - begartBelopp = rut_amount (det Spick begär från SKV)
 *   - betalningsDatum = payment_marked_at || booking_date
 *   - antalTimmar = actual_hours || booking_hours (SKV kräver faktiska timmar)
 */
export function bookingToRutArende(b: SpickBookingForRut): RutArende | null {
  const arbetstyp = mapSpickServiceToRutType(b.service_type);
  if (!arbetstyp) return null;

  const prisForArbete = Math.round(b.total_price + b.rut_amount);
  const betaltBelopp = Math.round(b.total_price);
  const begartBelopp = Math.round(b.rut_amount);
  const antalTimmar = Math.round(Number(b.actual_hours ?? b.booking_hours ?? 0));

  const betalningsDatum = (b.payment_marked_at || b.completed_at || `${b.booking_date}T00:00:00Z`).slice(0, 10);

  return {
    kopare: b.customer_pnr,
    betalningsDatum,
    prisForArbete,
    betaltBelopp,
    begartBelopp,
    fakturaNr: (b.receipt_number || b.booking_id || "").slice(0, 20) || undefined,
    ovrigkostnad: 0,
    utfortArbete: [
      {
        typ: arbetstyp,
        antalTimmar,
        materialkostnad: 0,
      },
    ],
  };
}
