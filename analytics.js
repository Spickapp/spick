// SPICK ANALYTICS v1.0 – Använder SPICK.SUPA_URL och SPICK.SUPA_KEY från js/config.js
(function(){
'use strict';
if (typeof SPICK === 'undefined') { console.warn('analytics: config.js ej laddad'); return; }
let sid=sessionStorage.getItem('spick_sid');
if(!sid){sid='s_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);sessionStorage.setItem('spick_sid',sid);}
const t0=Date.now();
const pages=JSON.parse(sessionStorage.getItem('pages')||'[]');
pages.push(location.pathname);
sessionStorage.setItem('pages',JSON.stringify(pages));
function getUTM(){const p=new URLSearchParams(location.search);return{utm_source:p.get('utm_source')||sessionStorage.getItem('utm_source'),utm_medium:p.get('utm_medium')||sessionStorage.getItem('utm_medium'),utm_campaign:p.get('utm_campaign')||sessionStorage.getItem('utm_campaign')};}
function getDevice(){const ua=navigator.userAgent;return{device_type:/iPhone|Android|iPad/i.test(ua)?'mobile':'desktop',browser:ua.includes('Chrome')?'Chrome':ua.includes('Firefox')?'Firefox':'Other'};}
async function track(type,props={}){const consent=localStorage.getItem('spick-cookie-consent');if(consent==='necessary')return;const payload={event_type:type,session_id:sid,customer_email:localStorage.getItem('spick_customer_email')||null,page:location.pathname,referrer:document.referrer||null,properties:{...props,...getDevice(),...getUTM()},device_type:getDevice().device_type,created_at:new Date().toISOString()};navigator.sendBeacon?navigator.sendBeacon(SPICK.SUPA_URL+'/rest/v1/analytics_events',new Blob([JSON.stringify(payload)],{type:'application/json'})):fetch(SPICK.SUPA_URL+'/rest/v1/analytics_events',{method:'POST',headers:{'Content-Type':'application/json',apikey:SPICK.SUPA_KEY,Authorization:'Bearer '+SPICK.SUPA_KEY,Prefer:'return=minimal'},body:JSON.stringify(payload),keepalive:true}).catch(()=>{});}
track('page_view',{title:document.title,pages:pages.length,returning:!!localStorage.getItem('spick_visited')});
localStorage.setItem('spick_visited','true');
let maxScroll=0;
window.addEventListener('scroll',()=>{const pct=Math.round((window.scrollY+window.innerHeight)/document.body.scrollHeight*100);if(pct>maxScroll){maxScroll=pct;}},{passive:true});
window.addEventListener('beforeunload',()=>track('page_exit',{time:Math.round((Date.now()-t0)/1000),scroll:maxScroll}));
window.spickTrack={bookingStarted:(s)=>track('booking_started',{service:s}),bookingCompleted:(d)=>{track('booking_completed',d);localStorage.setItem('spick_customer_email',d.email||'');},reviewSubmitted:(r)=>track('review_submitted',{rating:r}),pwaInstalled:()=>track('pwa_installed'),pushSubscribed:()=>track('push_subscribed')};
})();