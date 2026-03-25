// SPICK PWA v1.0
(function(){
'use strict';
const VAPID_PUBLIC='BFq-Saij81SXRzVsPmNgFBOLPD7CeokFSSszEKTKBFzs2rOzKHSpf9nNYMERDKAdXiNNm2PDNRFJnZtLWPnSdH4';
if('serviceWorker' in navigator){window.addEventListener('load',async()=>{try{const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});window._swRegistration=reg;}catch(e){}});}
let deferredPrompt;
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;setTimeout(()=>{if(!window.matchMedia('(display-mode: standalone)').matches){showInstallBanner();}},30000);});
function showInstallBanner(){if(document.getElementById('pwa-banner'))return;const b=document.createElement('div');b.id='pwa-banner';b.style.cssText='position:fixed;bottom:80px;left:16px;right:16px;background:#1C1C1A;color:white;border-radius:16px;padding:16px 20px;z-index:9998;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.3)';b.innerHTML='<span style="font-size:28px">🧹</span><div style="flex:1"><div style="font-weight:700;font-size:14px">Lägg till Spick på hemskärmen</div><div style="font-size:12px;opacity:.7">Snabbare + push-notiser</div></div><button onclick="window.spickInstall()" style="background:#0F6E56;color:white;border:none;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer">Installera</button><button onclick="document.getElementById('pwa-banner').remove()" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:20px;cursor:pointer">×</button>';document.body.appendChild(b);}
window.spickInstall=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();deferredPrompt=null;document.getElementById('pwa-banner')?.remove();};
window.addEventListener('online',()=>document.getElementById('offline-bar')?.remove());
window.addEventListener('offline',()=>{if(!document.getElementById('offline-bar')){const b=document.createElement('div');b.id='offline-bar';b.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#f57c00;color:white;padding:10px;text-align:center;font-size:13px;font-weight:600;z-index:9997';b.textContent='📵 Ingen anslutning – du är offline';document.body.appendChild(b);}});
})();