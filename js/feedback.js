(function() {
  'use strict';

  // Toast container
  var container = document.createElement('div');
  container.id = 'spick-toast-container';
  container.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:90vw;';
  document.body.appendChild(container);

  window.spickToast = function(message, type, duration) {
    type = type || 'success';
    duration = duration || 4000;
    var colors = {
      success: { bg:'#065F46', icon:'\u2705' },
      error:   { bg:'#991B1B', icon:'\u274C' },
      info:    { bg:'#1E40AF', icon:'\u2139\uFE0F' },
      warning: { bg:'#92400E', icon:'\u26A0\uFE0F' },
    };
    var c = colors[type] || colors.success;
    var toast = document.createElement('div');
    toast.style.cssText = 'background:'+c.bg+';color:#fff;padding:12px 20px;border-radius:12px;font-size:.88rem;font-weight:500;font-family:"DM Sans",sans-serif;display:flex;align-items:center;gap:8px;pointer-events:auto;opacity:0;transform:translateY(16px);transition:all .3s ease;box-shadow:0 8px 32px rgba(0,0,0,.2);max-width:400px;';
    toast.innerHTML = '<span>'+c.icon+'</span><span>'+message+'</span>';
    container.appendChild(toast);
    requestAnimationFrame(function() {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
    toast.onclick = function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    };
  };

  // Knapp-loading
  window.spickBtnLoading = function(btn, message) {
    if (!btn) return;
    btn._origHTML = btn.innerHTML;
    btn._origDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = '<span class="spick-spin"></span> ' + (message || 'Sparar...');
    btn.style.opacity = '0.7';
  };

  window.spickBtnReset = function(btn) {
    if (!btn) return;
    btn.disabled = btn._origDisabled || false;
    btn.innerHTML = btn._origHTML || 'Spara';
    btn.style.opacity = '1';
  };

  // Inline fältfel
  window.spickFieldError = function(inputId, message) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var existing = input.parentElement.querySelector('.spick-field-error');
    if (existing) existing.remove();
    input.style.borderColor = '#DC2626';
    input.style.boxShadow = '0 0 0 3px rgba(220,38,38,.1)';
    var msg = document.createElement('div');
    msg.className = 'spick-field-error';
    msg.style.cssText = 'color:#DC2626;font-size:.78rem;margin-top:4px;font-weight:500';
    msg.textContent = message;
    input.insertAdjacentElement('afterend', msg);
    input.addEventListener('input', function clear() {
      input.style.borderColor = '';
      input.style.boxShadow = '';
      msg.remove();
      input.removeEventListener('input', clear);
    }, { once: true });
  };

  // Spinner CSS
  var style = document.createElement('style');
  style.textContent = '.spick-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spick-sp .6s linear infinite;display:inline-block;vertical-align:middle}@keyframes spick-sp{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  // Bakåtkompatibel showToast alias
  window.showToast = function(msg) {
    var type = (msg.indexOf('\u274C') >= 0 || msg.indexOf('Fel') >= 0) ? 'error'
             : (msg.indexOf('\u26A0\uFE0F') >= 0) ? 'warning' : 'success';
    spickToast(msg, type);
  };
})();
