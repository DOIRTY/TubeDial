// Bridge between the popup (extension world) and main.js (page world).
// It only moves settings / diagnostics / memory between them — it never contacts YouTube.
(function () {
    'use strict';
    const KEY = 'ytld_settings';
    const MEM = 'ytldMemory';
    const ORIGIN = location.origin;

    function settingsOnly(all) {
        const s = Object.assign({}, all || {});
        delete s[MEM];
        return s;
    }
    function push(all) {
        const s = settingsOnly(all);
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}      // main.js reads this instantly next page load
        window.postMessage({ __ytld: 'toPage', kind: 'settings', settings: s }, ORIGIN);
    }
    chrome.storage.local.get(null, push);
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (Object.keys(changes).some(function (k) { return k !== MEM; })) chrome.storage.local.get(null, push);
    });

    let seq = 0;
    const pending = new Map();
    window.addEventListener('message', function (e) {
        if (e.source !== window || !e.data || e.data.__ytld !== 'toExt') return;
        if (e.data.kind === 'memory') {                                          // for the dashboard
            if (window.top === window && e.data.data && typeof e.data.data === 'object') {
                try { chrome.storage.local.set({ [MEM]: e.data.data }); } catch (err) {}
            }
            return;
        }
        const cb = pending.get(e.data.id);
        if (cb) { pending.delete(e.data.id); try { cb(e.data.data); } catch (err) {} }
    });

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (window.top !== window || !msg || !msg.kind) return;
        const id = ++seq;
        pending.set(id, sendResponse);
        window.postMessage({ __ytld: 'toPage', kind: msg.kind, id: id, data: msg.data || null }, ORIGIN);
        setTimeout(function () { if (pending.has(id)) { pending.delete(id); try { sendResponse(null); } catch (e) {} } }, 1500);
        return true;
    });
})();
