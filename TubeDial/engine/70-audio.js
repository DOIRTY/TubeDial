// STAGE: audio — the sound chain for the main player. Three small stages, each ONE Web Audio
// node pair, connected in the ORDER your settings say:
//   clean      — a soft gate: tones quieter than a threshold fade toward silence, so the hiss
//                between speech drops. Honest label: a gate, not AI noise removal.
//   stabilize  — a compressor with makeup: quiet parts come up, loud parts come down.
//   boost      — gain into a limiter: more loudness on weak audio, without the clipping.
// The graph is created lazily (only once the chain is actually ON) and there is exactly one
// owner per <video> element — if another tool already took it, we leave it alone instead of
// fighting over it. Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const st = K.rt.audio = { on: false, err: null, els: 0 };          // visible state (diagnostics + tests)
    if (!AC) { st.err = 'no-audio-context'; K.svc.audio = st; return; }

    const taken = new WeakSet();                  // one owner per element, ever
    const failed = new WeakSet();                 // grabbing it failed (someone else owns it): never hammer
    let ctx = null, src = null, el = null, nodes = null;

    function mainVideo() {
        try {
            const p = K.player.el();
            const v = p && p.querySelector && p.querySelector('video');
            return (v && v instanceof HTMLVideoElement) ? v : null;
        } catch (e) { return null; }
    }
    // gate curve: below the threshold everything fades to ~5% — with a ramp, so it never clicks
    function gateCurve() {
        const n = 2048, thr = 0.035, floor = 0.05, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
            curve[i] = a < thr ? x * (floor + (1 - floor) * (a / thr)) : x;
        }
        return curve;
    }
    function build() {
        const A = K.S.audio, o = {};
        o.clean = (function () { const w = ctx.createWaveShaper(); try { w.curve = gateCurve(); w.oversample = '4x'; } catch (e) {} return { in: w, out: w }; })();
        o.stabilize = (function () {
            const c = ctx.createDynamicsCompressor();
            try { c.threshold.value = -26; c.knee.value = 12; c.ratio.value = 3.2; c.attack.value = 0.01; c.release.value = 0.35; c.makeupGain.value = 1.6; } catch (e) {}
            return { in: c, out: c };
        })();
        o.boost = (function () {
            const g = ctx.createGain();
            try { g.gain.value = Math.pow(10, Math.min(20, Math.max(0, +A.boostDb || 0)) / 20); } catch (e) {}
            const lim = ctx.createDynamicsCompressor();
            try { lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; } catch (e) {}
            g.connect(lim);
            return { in: g, out: lim };
        })();
        return o;
    }
    function chain(A) {                                          // enabled stages in the saved order
        const list = [];
        (A.order || []).forEach(function (n) {
            if (n === 'clean' && A.gate) list.push('clean');
            else if (n === 'stabilize' && A.stab) list.push('stabilize');
            else if (n === 'boost' && (+A.boostDb || 0) > 0) list.push('boost');
        });
        return list;
    }
    function teardown() {
        try { if (src) src.disconnect(); } catch (e) {}
        if (nodes) for (const k in nodes) { try { nodes[k].in.disconnect(); if (nodes[k].out !== nodes[k].in) nodes[k].out.disconnect(); } catch (e) {} }
        nodes = null;
    }
    // rebuild the whole chain — small graph, reconnect is cheap and can never leave a stale edge
    function wire() {
        if (!ctx || !src) return;
        const A = K.S.audio;
        st.on = !!A.on;
        teardown();
        try {
            const used = st.on ? chain(A) : [];
            if (!used.length) { src.connect(ctx.destination); st.els = 1; st.err = null; return; }   // bypass: raw feed
            nodes = build();
            let at = src;
            used.forEach(function (n) { const s = nodes[n]; at.connect(s.in); at = s.out; });
            at.connect(ctx.destination);
            st.els = 1; st.err = null;
        } catch (e) { st.err = e && (e.message || String(e)); }
    }
    function attach(v) {
        if (!v || taken.has(v) || failed.has(v)) { el = v; return; }
        try {
            if (!ctx) ctx = new AC();
            const s = ctx.createMediaElementSource(v);
            taken.add(v);
            src = s; el = v;
            wire();
        } catch (e) {
            failed.add(v); el = v;                                // remember we tried; do not hammer it
            st.err = (e && e.name === 'NotSupportedError') ? 'taken-by-another-tool' : (e && (e.message || String(e)));
        }
    }
    function sync() {
        const A = K.S.audio || {};
        const v = mainVideo();
        if (!A.on && !src) { st.on = false; return; }                   // off and never built: nothing to do, nothing to own
        if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }   // even bypassed, the graph must keep flowing
        if (!A.on) { wire(); return; }                                  // bypass an existing graph; never build one while off
        if (!v) return;
        if (v !== el || !src) attach(v);
        else wire();
    }
    K.on('settings', sync);
    setInterval(function () { try { sync(); } catch (e) {} }, 1000);   // re-attach after SPA player swaps
    K.svc.audio = st;
})();
