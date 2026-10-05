// Bridge between the popup (extension world) and main.js (page world).
// It only moves settings / diagnostics / memory between them — it never contacts YouTube.
// Made with the help of AI.
(function () {
    'use strict';
    const KEY = 'ytld_settings';
    const MEM = 'ytldMemory';
    const ORIGIN = location.origin;
    let SNAP = {};                                                 // storage mirror, kept via the change events
    const junkKey = function (k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; };

    function settingsOnly(all) {
        const s = {};
        for (const k in all) if (k !== MEM && !junkKey(k)) s[k] = all[k];   // the memory map is for the popup only; hostile prototype keys never get copied
        return s;
    }
    function push(all) {
        SNAP = all || {};
        const s = settingsOnly(SNAP);
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}      // main.js reads this instantly next page load
        try { window.postMessage({ __ytld: 'toPage', kind: 'settings', settings: s }, ORIGIN); } catch (e) {}
    }
    chrome.storage.local.get(null, push);
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes) return;
        let touched = false;
        for (const k in changes) {
            if (k === MEM) continue;                              // dashboard data alone: nothing to push
            if (junkKey(k)) { delete SNAP[k]; continue; }                        // never let a prototype key retarget the mirror
            touched = true;
            const nv = changes[k].newValue;
            if (nv === undefined) delete SNAP[k]; else SNAP[k] = nv;            // no re-fetch: the event carries the new value
        }
        if (touched) push(SNAP);
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
