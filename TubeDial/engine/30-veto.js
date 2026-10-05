// STAGE: veto — the capability answer. The browser asks "can you play this?"; this stage is the
// single owner of those three answers (MediaSource / ManagedMediaSource .isTypeSupported and
// HTMLVideoElement.canPlayType) and says "no" to exactly the formats outside your plan — purely
// local, no request is ever made or blocked, only the menu the player assembles from the answer.
// Also watches addSourceBuffer to know what is REALLY being fed. Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;
    const rt = K.rt;                                           // armed/blockedFor/blockedTarget/bufFor/bufAt/lastType live here
    rt.armed = false; rt.blockedFor = null; rt.blockedTarget = null;
    rt.bufFor = null; rt.bufAt = 0; rt.lastType = '';
    let shortsWarm = false;

    // does a recently seen other video (e.g. the preloaded next Short) use this exact format?
    function otherAllows(v, fam, p, fr) {
        const now = Date.now();
        for (const [id, e] of K.recent) {
            if (id === v || now - e.at > 180000) continue;
            const pl = K.plan(id, e.info.t);
            if (p) { if (pl.keep.some(function (t) { return t.fam === fam && t.p === p && (!fr || t.fps === fr); })) return true; }
            else if (pl.fams.has(fam)) return true;
        }
        return false;
    }
    function num(type, key) { const m = type.match(new RegExp(key + '=(\\d+)', 'i')); return m ? +m[1] : 0; }
    function shouldBlock(type) {
        if (!rt.armed || typeof type !== 'string' || type.indexOf('video/') !== 0) return false;
        const v = K.curVid();
        if (!v) return false;
        if (K.healed.has(v)) return false;
        if (K.onShorts() && !shortsWarm) return false;              // let the Shorts player start up
        const cm = type.match(/codecs="?([a-zA-Z0-9.]+)/i);
        const fam = cm ? K.famOf(cm[1]) : null;
        const w = num(type, 'width'), h = num(type, 'height'), fr = num(type, 'framerate');
        const p = (w && h) ? Math.min(w, h) : (h || w);

        const pr = K.resp(v);
        let info = null;
        if (pr) {
            if (K.isLiveVD(pr.videoDetails)) { K.live.add(v); info = K.fullInfo(pr); }
            else info = K.learn(pr);
        }
        if (info) {                                             // exact: the player's own data (videos, Shorts AND live)
            const pl = K.plan(v, info.t), Fc = K.fpsCap(v);
            // A size this video doesn't have is usually for ANOTHER video (the next Short is preloaded
            // while the URL still shows this one): only your explicit framerate limit applies to it.
            let block = !!(Fc < 60 && fr && fr > Fc && pl.maxFps <= Fc);
            if (!block && fam) {
                const inVideo = p && info.t.some(function (t) { return t.p === p && (!fr || t.fps === fr); });
                if (inVideo) block = !pl.keep.some(function (t) { return t.fam === fam && t.p === p && (!fr || t.fps === fr); }) && !otherAllows(v, fam, p, fr);
                else if (!p) block = !pl.fams.has(fam) && !otherAllows(v, fam, 0, 0);
            }
            if (block) { rt.blockedFor = v; rt.blockedTarget = K.targetAt(pl, p, fr); }
            return block;
        }
        if (K.live.has(v) || location.pathname.indexOf('/live/') === 0) return false;   // live: never guess
        const Fc = K.fpsCap(v);                                   // unknown: safe rules
        if (fr && fr > Math.max(Fc, 30)) { rt.blockedFor = v; return true; }       // <=30fps exists for everything
        if (!fam) return false;
        const O = K.order(v);
        if (!O) return false;
        let t = null;
        for (let i = 0; i < O.length; i++) { if (K.mem.has(v, O[i]) !== false) { t = O[i]; break; } }
        if (!t || fam === t) return false;
        if (K.mem.has(v, t) === null && K.heal.reached()) return false;
        rt.blockedFor = v; rt.blockedTarget = t;
        return true;
    }
    try {
        if (window.MediaSource && MediaSource.isTypeSupported) {
            const o = MediaSource.isTypeSupported;
            MediaSource.isTypeSupported = function (t) { const r = o.call(this, t); return shouldBlock(t) ? false : r; };
        }
        if (window.ManagedMediaSource && ManagedMediaSource.isTypeSupported) {
            const o = ManagedMediaSource.isTypeSupported;
            ManagedMediaSource.isTypeSupported = function (t) { const r = o.call(this, t); return shouldBlock(t) ? false : r; };
        }
        const hp = window.HTMLVideoElement && HTMLVideoElement.prototype;
        if (hp && hp.canPlayType) {
            const o = hp.canPlayType;
            hp.canPlayType = function (t) { const r = o.call(this, t); return shouldBlock(t) ? '' : r; };
        }
    } catch (e) {}
    try {
        const ps = window.MediaSource && MediaSource.prototype;
        if (ps && ps.addSourceBuffer) {
            const o = ps.addSourceBuffer;
            ps.addSourceBuffer = function (t) {
                try {
                    if (typeof t === 'string' && t.indexOf('video/') === 0) {
                        rt.bufFor = K.curVid(); rt.bufAt = Date.now(); rt.lastType = t;
                        if (K.onShorts()) shortsWarm = true;
                    }
                } catch (e) {}
                return o.call(this, t);
            };
        }
    } catch (e) {}

    // what the stage exposes: nothing else touches its internals
    K.svc.veto = {
        clearBlocked: function () { rt.blockedFor = null; rt.blockedTarget = null; }   // softReload resets it
    };
})();
