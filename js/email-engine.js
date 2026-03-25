
// Spick Email Engine - kallas från boka.html, betyg.html, admin.html
const RESEND_KEY='re_KxTTppVD_MZkRApNRrB236wNTFZ32vfdB';

async function sendEmail(to, subject, html){
  return fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':'Bearer '+RESEND_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:'Spick <hello@spick.se>',to,subject,html})
  }).then(r=>r.json());
}

// 1. Bokningsbekräftelse till kund
export async function sendBookingConfirmation(booking){
  const rutInfo=booking.rut?`<p style="background:#E1F5EE;padding:12px 16px;border-radius:8px;color:#0F6E56;font-size:14px;margin:16px 0">✓ <strong>RUT-avdrag aktivt</strong> – du betalar <strong>${booking.total_price?.toLocaleString('sv')} kr</strong> (50% rabatt)</p>`:'';
  return sendEmail(booking.email,'✅ Bokningsbekräftelse – Spick',`
    <div style="font-family:DM Sans,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#0F6E56;margin-bottom:24px">Spick</div>
      <h1 style="font-family:Georgia,serif;font-size:22px;color:#0E0E0E;margin-bottom:8px">Din bokning är bekräftad! 🎉</h1>
      <p style="color:#6B6960;margin-bottom:20px">Hej ${booking.name?.split(' ')[0]}! Vi har tagit emot din bokning och återkommer inom 2 timmar.</p>
      <div style="background:#F7F7F5;border-radius:12px;padding:20px;margin-bottom:20px">
        <table style="width:100%;font-size:14px"><tbody>
          <tr><td style="color:#6B6960;padding:6px 0">Tjänst</td><td style="font-weight:600;text-align:right">${booking.service}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Datum</td><td style="font-weight:600;text-align:right">${booking.date}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Tid</td><td style="font-weight:600;text-align:right">${booking.time}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Adress</td><td style="font-weight:600;text-align:right">${booking.address||'–'}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Timmar</td><td style="font-weight:600;text-align:right">${booking.hours} h</td></tr>
        </tbody></table>
      </div>
      ${rutInfo}
      <p style="font-size:13px;color:#9E9E99;margin-bottom:8px">Frågor? Maila <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
      <p style="font-size:12px;color:#C0C0BA">Spick AB · 559402-4522</p>
    </div>
  `);
}

// 2. Notis till städare vid ny bokning
export async function sendCleanerNotification(booking, cleanerEmail, cleanerName){
  if(!cleanerEmail)return {error:'Ingen email för städaren'};
  return sendEmail(cleanerEmail,'🔔 Ny bokningsförfrågan – Spick',`
    <div style="font-family:DM Sans,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#0F6E56;margin-bottom:24px">Spick</div>
      <h1 style="font-family:Georgia,serif;font-size:22px;color:#0E0E0E;margin-bottom:8px">Ny bokning, ${cleanerName?.split(' ')[0]}! 📅</h1>
      <p style="color:#6B6960;margin-bottom:20px">Du har fått en ny bokningsförfrågan. Bekräfta direkt med kunden.</p>
      <div style="background:#F7F7F5;border-radius:12px;padding:20px;margin-bottom:20px">
        <table style="width:100%;font-size:14px"><tbody>
          <tr><td style="color:#6B6960;padding:6px 0">Kund</td><td style="font-weight:600;text-align:right">${booking.name}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Tjänst</td><td style="font-weight:600;text-align:right">${booking.service}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Datum</td><td style="font-weight:600;text-align:right">${booking.date}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Tid</td><td style="font-weight:600;text-align:right">${booking.time}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Adress</td><td style="font-weight:600;text-align:right">${booking.address||'–'}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Timmar</td><td style="font-weight:600;text-align:right">${booking.hours} h</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Din provision (17%)</td><td style="color:#DC2626;font-weight:600;text-align:right">-${Math.round((booking.total_price||0)*2*0.17)} kr</td></tr>
          <tr><td style="color:#0F6E56;padding:6px 0;font-weight:600">Din intäkt</td><td style="color:#0F6E56;font-weight:700;text-align:right;font-size:16px">${Math.round((booking.total_price||0)*2*0.83)} kr</td></tr>
        </tbody></table>
      </div>
      <a href="mailto:${booking.email}" style="display:inline-block;padding:12px 24px;background:#0F6E56;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;margin-bottom:16px">Kontakta kunden →</a>
      <p style="font-size:12px;color:#C0C0BA">Spick AB · 559402-4522</p>
    </div>
  `);
}

// 3. Betygsättnings-email (skickas 24h efter städning)
export async function sendRatingRequest(booking){
  const ratingUrl=`https://spick.se/betyg.html?bid=${booking.id}&name=${encodeURIComponent(booking.name)}`;
  return sendEmail(booking.email,'⭐ Hur gick städningen? Betygsätt din städare',`
    <div style="font-family:DM Sans,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#0F6E56;margin-bottom:24px">Spick</div>
      <h1 style="font-family:Georgia,serif;font-size:22px;color:#0E0E0E;margin-bottom:8px">Hur gick städningen? ⭐</h1>
      <p style="color:#6B6960;margin-bottom:24px">Hej ${booking.name?.split(' ')[0]}! Din städning ${booking.date} är nu avklarad. Ta 30 sekunder och betygsätt din städare!</p>
      <div style="text-align:center;margin:24px 0">
        ${[1,2,3,4,5].map(n=>`<a href="${ratingUrl}&rating=${n}" style="display:inline-block;font-size:28px;text-decoration:none;margin:0 4px">⭐</a>`).join('')}
      </div>
      <div style="text-align:center">
        <a href="${ratingUrl}" style="display:inline-block;padding:14px 32px;background:#0F6E56;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px">Ge betyg nu →</a>
      </div>
      <p style="font-size:12px;color:#C0C0BA;margin-top:24px">Spick AB · 559402-4522</p>
    </div>
  `);
}

// 4. Nöjdhetsgaranti-trigger (skickas vid betyg ≤ 2)
export async function sendGuaranteeActivation(booking, rating){
  return sendEmail('hello@spick.se',`🚨 Nöjdhetsgaranti triggrad – ${booking.name}`,`
    <div style="font-family:DM Sans,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <h2 style="color:#DC2626">Garantiärende – ${rating}★</h2>
      <p>Kund <strong>${booking.name}</strong> (${booking.email}) har gett betyget <strong>${rating}/5</strong> på bokning ${booking.date}.</p>
      <p>Åtgärd krävs inom 24h: Kontakta kunden och erbjud kompletterande städning.</p>
      <a href="mailto:${booking.email}" style="display:inline-block;padding:12px 24px;background:#DC2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Kontakta kund →</a>
    </div>
  `);
}

// 5. Månadsvis provisionsfaktura
export async function sendMonthlyInvoice(cleaner, invoice){
  return sendEmail(cleaner.email,`📊 Spick – Provisionsfaktura ${invoice.period_start} – ${invoice.period_end}`,`
    <div style="font-family:DM Sans,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#0F6E56;margin-bottom:24px">Spick</div>
      <h1 style="font-family:Georgia,serif;font-size:22px;color:#0E0E0E;margin-bottom:8px">Provisionsfaktura</h1>
      <p style="color:#6B6960;margin-bottom:20px">Hej ${cleaner.full_name?.split(' ')[0]}! Här är din provisionsfaktura för perioden.</p>
      <div style="background:#F7F7F5;border-radius:12px;padding:20px;margin-bottom:20px">
        <table style="width:100%;font-size:14px"><tbody>
          <tr><td style="color:#6B6960;padding:6px 0">Period</td><td style="font-weight:600;text-align:right">${invoice.period_start} – ${invoice.period_end}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Antal städningar</td><td style="font-weight:600;text-align:right">${invoice.num_bookings}</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Total omsättning</td><td style="font-weight:600;text-align:right">${invoice.gross_amount?.toLocaleString('sv')} kr</td></tr>
          <tr><td style="color:#6B6960;padding:6px 0">Provision 17%</td><td style="color:#DC2626;font-weight:600;text-align:right">-${invoice.commission_amount?.toLocaleString('sv')} kr</td></tr>
          <tr><td style="color:#0F6E56;padding:6px 0;font-weight:700;font-size:15px">Du betalar Spick</td><td style="color:#0F6E56;font-weight:700;text-align:right;font-size:18px">${invoice.commission_amount?.toLocaleString('sv')} kr</td></tr>
        </tbody></table>
      </div>
      <p style="background:#FEF3C7;padding:12px 16px;border-radius:8px;font-size:14px;color:#92400E">💸 Betala via Swish till <strong>076 050 51 53</strong> (Spick AB) senast ${invoice.due_date}</p>
      <p style="font-size:12px;color:#C0C0BA;margin-top:20px">Spick AB · 559402-4522 · hello@spick.se</p>
    </div>
  `);
}
