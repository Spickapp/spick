// patch-min.js — navigator.locks polyfill for Supabase SDK deadlock prevention
// Load this BEFORE @supabase/supabase-js on pages using Supabase auth
;(function () {
  if (typeof navigator === 'undefined') return;
  // Always override — native navigator.locks causes deadlock in Supabase SDK
  var queue = {};
  navigator.locks = {
    request: function (name, optionsOrCb, cb) {
      var fn = typeof optionsOrCb === 'function' ? optionsOrCb : cb;
      var p = (queue[name] || Promise.resolve()).then(function () {
        return fn({ name: name, mode: 'exclusive' });
      });
      queue[name] = p.catch(function () {});
      return p;
    },
    query: function () {
      return Promise.resolve({ held: [], pending: [] });
    }
  };
})();
