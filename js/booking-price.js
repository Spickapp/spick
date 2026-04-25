/**
 * booking-price.js — Central helper för pris-display på booking-cards.
 *
 * SSOT-konsolidering av pricing-display fragmenterad på 14 ställen
 * (memory project_pricing_fragmented). Etablerar två varianter:
 *   - Kund-vy: vad kund betalade + brutto/RUT-breakdown (transparent)
 *   - Städar-vy: vad städaren tjänar (brutto × keepRate, alltså efter
 *     Spicks kommission)
 *
 * PRIMÄRKÄLLOR (rule #31):
 *   - docs/sanning/rut.md: total_price = NETTO efter RUT,
 *     rut_amount = RUT-avdraget,
 *     brutto = total_price + rut_amount.
 *   - docs/sanning/provision.md: 12% flat kommission,
 *     läses från platform_settings.commission_standard.
 *   - js/commission-helpers.js: getKeepRate() / getCommissionPct().
 *
 * REGLER (#28 SSOT, #30 inga regulator-antaganden, #31 primärkälla):
 *   Helper-funktionerna är SSOT för pris-display-logik. Konsumenter
 *   får INTE göra egna beräkningar som duplicerar logiken (t.ex.
 *   total_price * 0.5).
 *
 * ANVÄNDNING:
 *   <script src="js/config.js"></script>
 *   <script src="js/commission-helpers.js"></script>
 *   <script src="js/booking-price.js"></script>
 *   ...
 *   await window.SPICK_COMMISSION_READY;  // krävs för cleaner-helpern
 *   element.innerHTML = formatCustomerBookingPrice(booking);
 *
 * Inline-styling (ej class-baserad) för portabilitet — funkar i alla
 * sidor utan CSS-dependencies.
 */

(function (global) {
  'use strict';

  function safeNum(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Returnerar { net, rut, gross, hasRut } baserat på booking-data.
   * net = total_price (kundens netto efter RUT)
   * rut = rut_amount (RUT-avdraget, 0 om ej RUT-bokning)
   * gross = net + rut (brutto = vad SKV ser som arbetskostnad)
   * hasRut = rut > 0
   */
  function calcBookingPrice(booking) {
    var net = safeNum(booking && booking.total_price);
    var rut = safeNum(booking && booking.rut_amount);
    var hasRut = rut > 0;
    var gross = hasRut ? net + rut : net;
    return { net: net, rut: rut, gross: gross, hasRut: hasRut };
  }

  /**
   * Formatera kund-vy: vad kund betalade + brutto + RUT-breakdown.
   *
   * För RUT-bokning visas:
   *   "100 kr" (du betalade-badge)
   *   "Brutto 200 kr · RUT -100 kr"
   *
   * För B2B/utan RUT visas:
   *   "200 kr"
   *
   * @param {Object} booking - { total_price, rut_amount }
   * @returns {string} HTML-snippet säker för innerHTML (bara siffror,
   *                   inga användarsträngar inkluderade).
   */
  function formatCustomerBookingPrice(booking) {
    var p = calcBookingPrice(booking);
    var priceHtml = '<span style="font-family:\'Playfair Display\',serif;font-size:1.25rem;font-weight:700;color:#1C1C1A">'
      + Math.round(p.net) + ' kr</span>';

    if (p.hasRut) {
      return priceHtml
        + '<span style="font-size:.75rem;color:#0F6E56;background:#E1F5EE;padding:.2rem .625rem;border-radius:100px;margin-left:.5rem">du betalade</span>'
        + '<div style="font-size:.75rem;color:#6B6960;margin-top:4px">Brutto '
        + Math.round(p.gross) + ' kr · RUT -' + Math.round(p.rut) + ' kr</div>';
    }
    return priceHtml;
  }

  /**
   * Formatera städar-vy: vad städaren tjänar (brutto × keepRate).
   *
   * Beräkning: gross × keepRate (där keepRate = 1 - commission/100,
   * t.ex. 0.88 vid 12% kommission). Detta är vad städaren får på sin
   * Stripe Connect-konto efter Spicks kommission.
   *
   * KRÄVER: window.SPICK_COMMISSION_READY har resolved innan anrop.
   *
   * @param {Object} booking - { total_price, rut_amount }
   * @returns {string} HTML-snippet
   */
  function formatCleanerEarnings(booking) {
    var p = calcBookingPrice(booking);

    // Kräver commission-helpers.js — fallback bara om saknas (defensiv,
    // men i normal flow ska getKeepRate/getCommissionPct vara loaded).
    var keepRate;
    var commissionPct;
    try {
      keepRate = getKeepRate();
      commissionPct = getCommissionPct();
    } catch (_) {
      // Saknad commission-helpers eller ej awaited READY-promise.
      // Fallback till memory-default: 12% commission (per
      // docs/sanning/provision.md). I prod kommer detta INTE triggras
      // när READY-promise korrekt awaitats av caller.
      keepRate = 0.88;
      commissionPct = 12;
    }

    var earnings = p.gross * keepRate;
    return '<span style="font-family:\'Playfair Display\',serif;font-size:1.25rem;font-weight:700;color:#0F6E56">'
      + Math.round(earnings) + ' kr</span>'
      + '<div style="font-size:.75rem;color:#6B6960;margin-top:4px">efter '
      + commissionPct + '% Spick-provision (brutto '
      + Math.round(p.gross) + ' kr)</div>';
  }

  // Exponera på window — alla 3 helpers
  global.calcBookingPrice = calcBookingPrice;
  global.formatCustomerBookingPrice = formatCustomerBookingPrice;
  global.formatCleanerEarnings = formatCleanerEarnings;
})(window);
