/**
 * commission.js - Spick Smart Trappstege
 * Visar provisionsnivå, progress till nästa steg, och aktuell procent.
 * 
 * Tiers: new (17%) → established (15%) → professional (13%) → elite (12%)
 * Thresholds: 0, 20, 50, 100 completed bookings
 * 
 * Usage: 
 *   <div id="commission-widget"></div>
 *   <script src="js/commission.js"></script>
 *   renderCommissionWidget('commission-widget', cleaner);
 */

const COMMISSION_TIERS = [
  { id: 'new',          label: 'Ny',        rate: 0.17, keep: 0.83, threshold: 0,   color: '#6B7280' },
  { id: 'established',  label: 'Silver',    rate: 0.15, keep: 0.85, threshold: 20,  color: '#3B82F6' },
  { id: 'professional', label: 'Gold',      rate: 0.13, keep: 0.87, threshold: 50,  color: '#F59E0B' },
  { id: 'elite',        label: 'Platinum',  rate: 0.12, keep: 0.88, threshold: 100, color: '#8B5CF6' },
];

function getCommissionTier(completedBookings) {
  let tier = COMMISSION_TIERS[0];
  for (const t of COMMISSION_TIERS) {
    if (completedBookings >= t.threshold) tier = t;
  }
  return tier;
}

function getNextTier(currentTierId) {
  const idx = COMMISSION_TIERS.findIndex(t => t.id === currentTierId);
  return idx < COMMISSION_TIERS.length - 1 ? COMMISSION_TIERS[idx + 1] : null;
}

function getKeepRate(cleaner) {
  if (!cleaner) return 0.83;
  const tier = cleaner.commission_tier || cleaner.tier || 'new';
  const found = COMMISSION_TIERS.find(t => t.id === tier);
  return found ? found.keep : 0.83;
}

function renderCommissionWidget(containerId, cleaner) {
  const el = document.getElementById(containerId);
  if (!el || !cleaner) return;

  const completed = cleaner.total_jobs || cleaner.completed_bookings || 0;
  const tier = getCommissionTier(completed);
  const next = getNextTier(tier.id);
  
  const progressPct = next 
    ? Math.min(100, Math.round(((completed - tier.threshold) / (next.threshold - tier.threshold)) * 100))
    : 100;
  
  const remainingJobs = next ? next.threshold - completed : 0;

  el.innerHTML = `
    <div style="background:#fff;border-radius:16px;border:1px solid #E8E8E4;padding:20px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B6960;margin-bottom:4px">Min provisionsnivå</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:.82rem;font-weight:700;background:${tier.color}18;color:${tier.color}">${tier.label}</span>
            <span style="font-size:.85rem;color:#1C1C1A;font-weight:600">${Math.round(tier.rate * 100)}% provision</span>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1.4rem;font-weight:700;color:#0F6E56">${Math.round(tier.keep * 100)}%</div>
          <div style="font-size:.7rem;color:#6B6960">du behåller</div>
        </div>
      </div>

      ${next ? `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:.75rem;color:#6B6960;margin-bottom:4px">
          <span>${completed} av ${next.threshold} uppdrag</span>
          <span>${remainingJobs} kvar till ${next.label} (${Math.round(next.rate * 100)}%)</span>
        </div>
        <div style="background:#F3F4F6;border-radius:6px;height:8px;overflow:hidden">
          <div style="background:${next.color};height:100%;width:${progressPct}%;border-radius:6px;transition:width .5s"></div>
        </div>
      </div>
      ` : `<div style="font-size:.82rem;color:#0F6E56;font-weight:600;text-align:center;padding:8px;background:#E1F5EE;border-radius:8px">🏆 Du har nått högsta nivån!</div>`}

      <div style="display:flex;gap:4px;margin-top:12px">
        ${COMMISSION_TIERS.map(t => `
          <div style="flex:1;text-align:center;padding:6px 2px;border-radius:8px;font-size:.68rem;font-weight:600;
            ${t.id === tier.id ? `background:${t.color}18;color:${t.color};border:1.5px solid ${t.color}` : `background:#F7F7F5;color:#9CA3AF;border:1.5px solid transparent`}">
            ${t.label}<br><span style="font-weight:400">${Math.round(t.rate * 100)}%</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

// Expose globally
window.COMMISSION_TIERS = COMMISSION_TIERS;
window.getCommissionTier = getCommissionTier;
window.getNextTier = getNextTier;
window.getKeepRate = getKeepRate;
window.renderCommissionWidget = renderCommissionWidget;
