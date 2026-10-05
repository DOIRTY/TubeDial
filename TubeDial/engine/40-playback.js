// STAGE: playback — everything that touches the player itself: the starting quality written
// before the player even exists (YouTube's own saved-quality key + a one-time range), the
// per-video quality enforcement, the live badges that steer "which kind is this", the 1s
// watchdog that notices a failed load and offers the one-reload fix, and the popup's
// in-place switch (softReload). Owner of: yt-player-quality, the reload markers, toasts' cause.
// Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;
    const S = function () { return K.S; };
    const rt = K.rt;
    let checkedFor = null, resDoneFor = null, softCheck = null;
    rt.errorFor = null; rt.lastHref = location.href; rt.lastVid = K.curVid(); rt.vidSince = Date.now();

    // ---- LIVE / UPCOMING badges on what you click (so kindOf() picks the live profile) ----
    const LOCKUP = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-rich-grid-media, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ytd-channel-video-player-renderer';
    const LIVE_SEL = '.badge-style-type-live-now, .badge-style-type-live-now-alternate, [overlay-style="LIVE"], [overlay-style="UPCOMING"], .yt-badge-shape--thumbnail-live, .badge-shape-wiz--thumbnail-live';
    const LIVE_WORDS = ['LIVE', 'LIVE NOW', 'UPCOMING', 'PREMIERE', 'PREMIERING NOW', 'مباشر', 'بث مباشر', 'قريبًا'];
    document.addEventListener('click', function (e) {
        try {
            const a = e.target && e.target.closest && e.target.closest('a[href]');
            if (!a) return;
            const m = a.href.match(K.URL_VID_RE);
            if (!m) return;
            const box = a.closest(LOCKUP);
            if (!box) return;
            if (box.querySelector(LIVE_SEL)) { K.live.add(m[1]); return; }
            const badges = box.querySelectorAll('badge-shape, .yt-badge-shape__text, .badge-shape-wiz__text, ytd-badge-supported-renderer, ytd-thumbnail-overlay-time-status-renderer');
            for (let i = 0; i < badges.length; i++) {
                if (LIVE_WORDS.indexOf((badges[i].textContent || '').trim().toUpperCase()) !== -1) { K.live.add(m[1]); return; }
            }
        } catch (err) {}
    }, true);

    // ================================================================
    // LOAD STRAIGHT AT THE STARTING QUALITY: YouTube's player reads its own saved quality
    // (localStorage "yt-player-quality") before it downloads anything, and a quality range set on
    // the player carries over to the next video. So new videos start at your quality from the very
    // first second, instead of playing a few seconds higher first. With "YouTube decides", your
    // own YouTube value is put back exactly as it was.
    // ================================================================
    const YTQ = 'yt-player-quality', YTQ_BK = 'tubedial_ytq_backup', YTQ_WR = 'tubedial_ytq_written';
    function ytqNum(str) {
        try { const o = JSON.parse(str); let d = o && o.data; if (typeof d === 'string' && d.charAt(0) === '{') d = JSON.parse(d); return d && typeof d === 'object' ? +d.quality || 0 : (K.Q2H[d] || 0); } catch (e) { return 0; }
    }
    function writeYtq(res) {
        try {
            if (localStorage.getItem(YTQ_BK) === null) { const cur = localStorage.getItem(YTQ); localStorage.setItem(YTQ_BK, cur === null ? '__none__' : cur); }
            const now = Date.now();
            const val = JSON.stringify({ data: JSON.stringify({ quality: res, previousQuality: res }), expiration: now + 30 * 864e5, creation: now });
            localStorage.setItem(YTQ, val); localStorage.setItem(YTQ_WR, String(res));
        } catch (e) {}
    }
    function restoreYtq() {
        try {
            const bk = localStorage.getItem(YTQ_BK);
            if (bk === null) return;
            if (ytqNum(localStorage.getItem(YTQ)) === +localStorage.getItem(YTQ_WR)) {   // untouched since we wrote it
                if (bk === '__none__') localStorage.removeItem(YTQ); else localStorage.setItem(YTQ, bk);
            }
            localStorage.removeItem(YTQ_BK); localStorage.removeItem(YTQ_WR);
        } catch (e) {}
    }
    let earlySig = null;
    function earlyStart() {
        const v = K.curVid();
        if (!v) return;
        const st = K.startRes(v);
        const sig = v + '|' + st;                    // same video + same start quality = already prepared.
        if (sig === earlySig) return;                // if the setting changed in between, coming back re-applies it
        earlySig = sig;                              // (plain id tracking kept a stale quality on the same video)
        if (!st) { restoreYtq(); return; }
        writeYtq(Math.min(st, 4320));
        const p = K.player.el(), q = K.qFor(st);
        try { if (p && typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange(q, q); } catch (e) {}
    }
    try { earlyStart(); } catch (e) {}                          // direct page load: before the player exists
    try {                                                       // in-page navigation (incl. scrolling Shorts)
        ['pushState', 'replaceState'].forEach(function (fn) {
            const o = history[fn];
            if (typeof o !== 'function') return;
            history[fn] = function () { const r = o.apply(this, arguments); try { earlyStart(); } catch (e) {} return r; };
        });
        window.addEventListener('popstate', function () { try { earlyStart(); } catch (e) {} });
        document.addEventListener('yt-navigate-start', function () { try { earlyStart(); } catch (e) {} });
    } catch (e) {}

    // STARTING QUALITY: when a NEW video starts, pick your starting quality once. Every quality
    // stays in YouTube's menu, and whatever you pick there afterwards is never changed.
    // startRes 0 = do nothing (YouTube's own quality setting decides).
    function enforceRes(v, p, info) {
        const st = K.startRes(v);
        if (!st || !p || typeof p.getPlaybackQuality !== 'function') return true;
        const q = p.getPlaybackQuality();
        if (!K.Q2H[q]) return false;                              // not ready yet
        let t = st;
        if (info) t = Math.min(t, K.plan(v, info.t).maxP);        // "best" / above what the video has -> its best
        const tq = K.qFor(t);
        if (tq !== q) K.player.setQuality(p, tq);
        return true;
    }

    // ================================================================
    // WATCHDOG (1s) — errors, one-shot reloads, and the soft-switch verifier
    // ================================================================
    // After an in-place switch, check the player really took it. If it kept the old codec (or its
    // quality menu came up empty), do ONE normal page reload for this video — which always works.
    function verifySoft(v, p, info, fam) {
        const age = Date.now() - softCheck.at;
        if (age > 15000) { softCheck = null; return; }
        if (age < 3000 || !info) return;
        const tg = K.plan(v, info.t).target;
        let empty = false;
        try { empty = typeof p.getAvailableQualityLevels === 'function' && K.player.levels(p).length === 0; } catch (e) {}
        if ((!tg || fam === tg) && !empty) { softCheck = null; return; }
        if (!fam) return;
        softCheck = null;
        if (document.visibilityState !== 'visible') return;
        const key = 'tubedial_softfb_' + v;
        let last = 0; try { last = +sessionStorage.getItem(key) || 0; } catch (e) {}
        if (Date.now() - last < 60000) return;                  // never more than once a minute per video
        try { sessionStorage.setItem(key, String(Date.now())); } catch (e) {}
        location.reload();
    }
    function reloadFor(v, t) {
        if (K.curVid() !== v) return;
        K.heal.mark(v); K.heal.bump(K.heal.HEALS); if (K.onShorts()) K.heal.bump(K.heal.SHORTS);
        if (t) K.mem.setHint(v, t);
        location.reload();
    }
    function onError(v) {
        if (rt.errorFor === v || K.healed.has(v)) return;
        rt.errorFor = v;
        const t = rt.blockedTarget;
        if (!S().notices) { reloadFor(v, t); return; }
        const secs = +S().autoReloadSec || 0;
        K.toast({
            kind: 'error', forVid: v,
            title: t ? 'This video couldn’t start in ' + K.NAME[t] : 'This video couldn’t start',
            text: t ? 'It probably has no ' + K.NAME[t] + ' version. Reloading plays it in the best format it has — only once for this video.'
                    : 'Reloading plays it in the best format it has — only once for this video.',
            buttons: [
                { label: 'Reload now', primary: true, onClick: function () { K.closeToast(); reloadFor(v, t); } },
                { label: 'Cancel', onClick: function () { K.heal.mark(v); K.closeToast(); } }
            ],
            onClose: function () { K.heal.mark(v); },
            countdown: secs > 0 ? { secs: secs, onDone: function () { K.closeToast(); reloadFor(v, t); }, fmt: function (s) { return 'Reloading by itself in ' + s + 's…'; } } : null
        });
    }
    function checkMismatch(v, pr, fam) {
        if (!S().notices || !fam) return;
        const info = pr ? K.fullInfo(pr) : null;
        if (!info) return;
        let pp = 0;
        try { const vid = K.player.el() && K.player.el().querySelector('video'); if (vid && vid.videoWidth) pp = Math.min(vid.videoWidth, vid.videoHeight); } catch (e) {}
        if (!pp) return;
        const pl = { target: K.targetAt(K.plan(v, info.t), pp, 0) };   // the codec picked for the quality being played
        if (!pl.target || pl.target === fam) return;
        K.toast({
            kind: 'warn', forVid: v, timeout: 12000,
            title: 'This video supports ' + K.NAME[pl.target],
            text: 'It’s currently playing in ' + K.NAME[fam] + '. Reload to switch to ' + K.NAME[pl.target] + '.',
            buttons: [
                { label: 'Reload in ' + K.NAME[pl.target], primary: true, onClick: function () { K.closeToast(); location.reload(); } },
                { label: 'Dismiss', onClick: K.closeToast }
            ]
        });
    }

    setInterval(function () {
        if (!K.IS_TOP) return;
        try {
            const v = K.curVid();
            if (location.href !== rt.lastHref) {
                rt.lastHref = location.href;
                if (v && v !== rt.lastVid) rt.armed = true;
            }
            if (v !== rt.lastVid) {
                rt.lastVid = v; rt.vidSince = Date.now();
                earlyStart();
                if (rt.toastFor && rt.toastFor !== v) K.closeToast();
                return;
            }
            if (!v) return;
            const pr = K.resp(v);
            let info = null;
            if (pr) { if (K.isLiveVD(pr.videoDetails)) { K.live.add(v); info = K.fullInfo(pr); } else info = K.learn(pr); }
            const p = K.player.el();
            const rp = rt.bufFor === v ? null : K.player.realPlaying(v);
            if (rt.bufFor === v || rp) {                           // playing
                const fam = (rp && rp.fam) || (rt.bufFor === v ? K.player.playedFam() : null);
                if (fam && !K.live.has(v)) K.mem.markPlayed(v, fam);
                if (softCheck && softCheck.v === v) verifySoft(v, p, info, fam);
                if (resDoneFor !== v && enforceRes(v, p, info)) resDoneFor = v;
                if (checkedFor !== v && (rp || Date.now() - rt.bufAt > 1500)) { checkedFor = v; checkMismatch(v, pr, fam); }
                return;
            }
            if (rt.blockedFor !== v) return;
            const waited = Date.now() - rt.vidSince;
            if (waited < 3000 || K.healed.has(v)) return;
            if (document.visibilityState !== 'visible') return;
            const ps = pr && pr.playabilityStatus && pr.playabilityStatus.status;
            if (ps && ps !== 'OK') return;                      // age/members/unavailable: not a format issue
            if (K.player.errSeen(p) || (waited >= 8000 && K.player.stuck(p))) onError(v);
        } catch (e) {}
    }, 1000);

    // embedded players (videos on other websites): starting quality only — never reloads
    if (!K.IS_TOP) {
        let embDone = null;
        setInterval(function () {
            try {
                const v = K.curVid();
                if (!v || !K.player.isPlaying(v) || embDone === v) return;
                const pr = K.resp(v);
                const info = pr ? (K.isLiveVD(pr.videoDetails) ? K.fullInfo(pr) : K.learn(pr)) : null;
                if (enforceRes(v, K.player.el(), info)) embDone = v;
            } catch (e) {}
        }, 1000);
    }

    // ---- popup messages this stage answers ----
    K.reply('setQuality', function (m) {                        // switch the current video's quality now
        const v = K.curVid(), p = K.player.el(), q = m.data && m.data.q;
        if (v && p && (q === 'auto' || K.Q2H[q])) { K.player.setQuality(p, q); resDoneFor = v; }
        return K.nowPlaying();
    });
    K.reply('softReload', function (m) {                        // re-open THIS video in the player, same spot, no page refresh
        if (m.data && m.data.settings) K.setSettings(m.data.settings);
        const v = K.curVid(), p = K.player.el();
        let ok = false;
        if (v && p && typeof p.loadVideoById === 'function') {
            let t = 0;
            try { t = +p.getCurrentTime() || 0; } catch (e) {}
            rt.bufFor = null; resDoneFor = null; checkedFor = null; rt.errorFor = null; earlySig = null;
            if (K.svc.veto) K.svc.veto.clearBlocked();
            K.svc.formats.reprime(v);
            earlyStart();                                       // quality set before it loads again
            softCheck = { v: v, at: Date.now() };
            try { p.loadVideoById({ videoId: v, startSeconds: Math.max(0, t - 0.3) }); ok = true; } catch (e) {}
        }
        return { ok: ok };
    });
})();
