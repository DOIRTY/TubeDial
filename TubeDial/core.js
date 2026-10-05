// TubeDial — page kernel: settings (the ONLY place they are parsed), shared helpers, video
// memory, toasts and the tiny bus every stage talks through. This file loads first; every
// engine/<NN>-*.js stage below registers itself on window.__YTLK and never reaches into
// another stage directly. Order of the engine/ files = order of the pipeline; see PIPELINE.md.
// Makes ZERO requests of its own. Made with the help of AI.
(function () {
    'use strict';
    if (window.__ytldLoaded) return;
    window.__ytldLoaded = true;

    const IS_TOP = (function () { try { return window.top === window.self; } catch (e) { return true; } })();
    const ORIGIN = location.origin;

    const K = window.__YTLK = {
        IS_TOP: IS_TOP, ORIGIN: ORIGIN,
        svc: {},                                   // stage -> services, by name (K.svc.formats.prune(...) etc.)
        rt: {},                                    // runtime state several stages read (who owns what: PIPELINE.md)
        on: function (ev, fn) { (this._l = this._l || {})[ev] = (this._l[ev] || []).concat(fn); return this; },
        emit: function (ev) { const l = this._l && this._l[ev]; if (l) for (let i = 0; i < l.length; i++) { try { l[i](); } catch (e) {} } }
    };

    // ================================================================
    // SETTINGS  (from the popup; cached in localStorage for instant start)
    // ================================================================
    // one profile per content type: long videos, Shorts, live streams, embedded players
    const PROFILE = { codec1: 'av1', codec2: 'vp9', startRes: 0, maxFps: 60 };
    //   codec1/codec2: 1st / 2nd choice, picked PER QUALITY ('auto' = let YouTube decide).
    //       A quality that doesn't exist in the 1st choice uses the 2nd, so no quality is ever removed.
    //   startRes: 0 = YouTube's own quality setting decides; else 144..4320 = the quality a NEW video
    //       starts at (4320 = its best). Set once per video; every quality stays in YouTube's menu.
    //   maxFps: 24|25|30|48|50|60 (60 = any). The only setting that hides versions (above the limit).
    const KINDS = ['video', 'shorts', 'live', 'embed'];
    const AUDIO_STAGES = ['clean', 'stabilize', 'boost'];   // the audio chain; its order is a setting
    // (the constants below must stay ABOVE merge(): merge is first called on load and reads them)
    const FAM = ['av1', 'vp9', 'avc'];
    const NAME = { av1: 'AV1', vp9: 'VP9', avc: 'H.264' };
    const BIT = { av1: 1, vp9: 2, avc: 4 };
    const KNOWN = 16, WATCHED = 32;
    const PLAYED = { av1: 64, vp9: 128, avc: 256 }, PLAYED_ALL = 64 | 128 | 256;
    const NOHINT = { av1: 512, vp9: 1024, avc: 2048 };
    const HFR = 4096, UHD = 8192;             // has >30fps / has 2160p+
    const Q2H = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, highres: 4320 };

    const ID_RE = /^[A-Za-z0-9_-]{11}$/;
    const URL_VID_RE = /(?:[?&]v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/;
    const DEFAULTS = {
        profiles: {
            video: Object.assign({}, PROFILE), shorts: Object.assign({}, PROFILE),
            live: Object.assign({}, PROFILE, { codec1: 'auto' }), embed: Object.assign({}, PROFILE)
        },
        perVideo: {},                        // videoId -> { codec, res, fps }
        thumbH: 270,                         // video thumbnails: any number (e.g. 40, 120); 0 = original
        shortsThumbH: 360,                   // Shorts thumbnails: any number; 0 = original
        previewH: 360,                       // hover-preview videos: any number; 0 = YouTube default; -1 = off
        stillHover: false, channelImages: true,
        notices: true,                       // small on-page notices
        autoReloadSec: 5,                    // error notice countdown (0 = never reload by itself)
        audio: { on: false, order: AUDIO_STAGES.slice(), gate: true, stab: true, boostDb: 0 }   // in-page sound chain
    };
    // ---- sanitizer: settings can come from storage, a postMessage or a legacy migration, so they
    // are treated as hostile input: only DEFAULTS' own keys survive, enums are whitelisted,
    // numbers are rounded and clamped to values the UI itself could ever produce, and the result
    // is built fresh (an own __proto__ key or getter can never reach S or poison anything).
    // merge(merge(x)) === merge(x): clamping is idempotent, so a round-trip never drifts.
    const RES_SET = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
    const FPS_SET = [24, 25, 30, 48, 50, 60];
    const AR_SET = [3, 5, 10, 15];
    function sanNum(v, lo, hi, dflt) { const n = +v; if (!isFinite(n)) return dflt; const r = Math.round(n); return r < lo ? lo : r > hi ? hi : r; }
    function floorIn(n, set, low) { for (let i = set.length - 1; i >= 0; i--) if (set[i] <= n) return set[i]; return low; }
    function sanRes(v) { const n = sanNum(v, 0, 1e9, 0); return n <= 0 ? 0 : floorIn(n, RES_SET, RES_SET[0]); }   // 0 = YouTube decides
    function sanFps(v, dflt) { const n = +v; if (!isFinite(n) || n <= 0) return dflt; return n >= 60 ? 60 : floorIn(n, FPS_SET, FPS_SET[0]); }
    function sanAuto(v, dflt) { const n = sanNum(v, 0, 1e9, dflt); return n >= 15 ? 15 : n >= 1 ? floorIn(n, AR_SET, AR_SET[0]) : 0; }
    function sanProf(base, src) {
        const q = { codec1: base.codec1, codec2: base.codec2, startRes: base.startRes, maxFps: base.maxFps };
        if (src && typeof src === 'object') {
            if (src.codec1 === 'auto' || BIT[src.codec1]) q.codec1 = src.codec1;
            if (BIT[src.codec2]) q.codec2 = src.codec2;
            const lim = +src.maxRes;                                                    // v1/v2: a limit becomes a start quality
            if (src.startRes !== undefined) q.startRes = sanRes(src.startRes);
            else if (isFinite(lim) && lim > 0) q.startRes = sanRes(lim);
            q.maxFps = sanFps(src.maxFps, q.maxFps);
        }
        return q;
    }
    function sanAudio(base, src) {
        const q = { on: !!base.on, order: base.order.slice(), gate: !!base.gate, stab: !!base.stab, boostDb: base.boostDb };
        if (src && typeof src === 'object') {
            q.on = typeof src.on === 'boolean' ? src.on : q.on;
            q.gate = typeof src.gate === 'boolean' ? src.gate : q.gate;
            q.stab = typeof src.stab === 'boolean' ? src.stab : q.stab;
            q.boostDb = sanNum(src.boostDb, 0, 20, q.boostDb);                         // 0..20 dB — the UI's own range
            if (Array.isArray(src.order)) {                                             // a permutation of the known stages
                const seen = {}, o = [];
                src.order.forEach(function (n) { if (AUDIO_STAGES.indexOf(n) !== -1 && !seen[n]) { seen[n] = 1; o.push(n); } });
                AUDIO_STAGES.forEach(function (n) { if (!seen[n]) o.push(n); });
                q.order = o;
            }
        }
        return q;
    }
    function merge(s) {
        s = (s && typeof s === 'object') ? s : {};
        const o = {};
        let th = s.thumbH;                                                              // legacy named steps
        if (th === undefined && s.thumbQuality) th = ({ '70p': 68, '180p': 180, '270p': 270, '360p': 360, 'original': 0 })[s.thumbQuality] ?? DEFAULTS.thumbH;
        th = sanNum(th, -1e9, 99999, DEFAULTS.thumbH); o.thumbH = th < 0 ? DEFAULTS.thumbH : th;   // 0 = original; negatives are junk
        let sth = s.shortsThumbH;
        if (sth === undefined && s.shortsThumbQuality) sth = ({ '90p': 90, '180p': 180, '360p': 360, '480p': 480, 'original': 0 })[s.shortsThumbQuality] ?? DEFAULTS.shortsThumbH;
        sth = sanNum(sth, -1e9, 99999, DEFAULTS.shortsThumbH); o.shortsThumbH = sth < 0 ? DEFAULTS.shortsThumbH : sth;
        let pv = s.previewH;
        if (pv === undefined && s.previewQuality) pv = ({ '144p': 144, '240p': 240, '360p': 360, '480p': 480, '720p': 720, 'off': -1 })[s.previewQuality] ?? DEFAULTS.previewH;
        pv = sanNum(pv, -1e9, 99999, DEFAULTS.previewH);                                 // -1 = off, 0 = YouTube default
        o.previewH = (pv === -1 || pv >= 0) ? pv : DEFAULTS.previewH;
        o.stillHover = typeof s.stillHover === 'boolean' ? s.stillHover : DEFAULTS.stillHover;
        o.channelImages = typeof s.channelImages === 'boolean' ? s.channelImages : DEFAULTS.channelImages;
        o.notices = typeof s.notices === 'boolean' ? s.notices : DEFAULTS.notices;
        o.autoReloadSec = sanAuto(s.autoReloadSec, DEFAULTS.autoReloadSec);
        o.audio = sanAudio(DEFAULTS.audio, s.audio);
        let pr = (s.profiles && typeof s.profiles === 'object') ? s.profiles : null;
        if (!pr && (s.codec1 || s.maxRes || s.maxFps || s.av1 === false)) {             // v1/v2 migration
            const b = { codec1: s.codec1 || (s.av1 === false ? 'auto' : 'av1'), codec2: s.codec2 || 'vp9', maxRes: s.maxRes, maxFps: s.maxFps };
            pr = { video: b, shorts: b, embed: b, live: Object.assign({}, b, { codec1: 'auto' }) };
        }
        o.profiles = {};
        KINDS.forEach(function (k) { o.profiles[k] = sanProf(DEFAULTS.profiles[k], pr && pr[k]); });
        o.perVideo = {};
        const pvs = (s.perVideo && typeof s.perVideo === 'object') ? s.perVideo : null;
        const pvf = (s.perVideoFps && typeof s.perVideoFps === 'object') ? s.perVideoFps : null;   // v1 migration
        if (pvs) {
            const keys = Object.keys(pvs);
            keys.slice(Math.max(0, keys.length - 5000)).forEach(function (k) {          // keep the newest 5000, id-shaped keys only
                if (!ID_RE.test(k)) return;
                const e = pvs[k];
                if (!e || typeof e !== 'object') return;
                const q = {};
                if (BIT[e.codec]) q.codec = e.codec;
                const r = sanRes(e.res); if (r > 0) q.res = r;
                const fr = +e.fps; if (isFinite(fr) && fr >= 1) q.fps = Math.min(240, Math.round(fr));   // 0/absent = "no override"
                if (q.codec || q.res || q.fps) o.perVideo[k] = q;
            });
        }
        if (pvf) {
            Object.keys(pvf).slice(0, 5000).forEach(function (k) {
                if (!ID_RE.test(k) || o.perVideo[k]) return;
                const fr = +pvf[k];
                if (isFinite(fr) && fr >= 1) o.perVideo[k] = { fps: Math.min(240, Math.round(fr)) };
            });
        }
        return o;
    }
    let _S = (function () { try { return merge(JSON.parse(localStorage.getItem('ytld_settings'))); } catch (e) { return merge(null); } })();
    Object.defineProperty(K, 'S', { get: function () { return _S; } });
    K.setSettings = function (raw) { _S = merge(raw); K.emit('settings'); };
    K.merge = merge; K.DEFAULTS = DEFAULTS; K.KINDS = KINDS; K.AUDIO_STAGES = AUDIO_STAGES;
    K.PROFILE = PROFILE;

    // ================================================================
    // SHARED LIB  (pure functions + small shared state every stage may read)
    // ================================================================
    function curVid() { try { const m = location.href.match(URL_VID_RE); return m ? m[1] : null; } catch (e) { return null; } }
    function onShorts() { return location.pathname.indexOf('/shorts/') === 0; }
    function playerEl() { try { return document.getElementById(onShorts() ? 'shorts-player' : 'movie_player'); } catch (e) { return null; } }
    const live = new Set();                   // videoIds known to be / have been live

    function famOf(c) {
        c = String(c || '').toLowerCase();
        if (c.indexOf('av01') === 0) return 'av1';
        if (c.indexOf('vp09') === 0 || c.indexOf('vp9') === 0 || c.indexOf('vp08') === 0 || c.indexOf('vp8') === 0) return 'vp9';
        if (c.indexOf('avc1') === 0 || c.indexOf('avc3') === 0) return 'avc';
        return null;
    }
    function isVideoFmt(f) { return !!(f && f.mimeType && f.mimeType.indexOf('video/') === 0); }
    function norm(f) {
        const m = f.mimeType.match(/codecs="([^"]+)"/);
        const w = +f.width || 0, h = +f.height || 0;
        return { fam: m ? famOf(m[1]) : null, p: (w && h) ? Math.min(w, h) : (h || w || 0), l: Math.max(w, h), fps: +f.fps || 30, ref: f };
    }
    // YouTube's quality name for a format size: 1920x800 is "1080p", a 1080x1920 Short is "1080p"
    const LADDER = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
    function ladderP(w, h) {
        const s = Math.min(w, h), l = Math.max(w, h), e = Math.max(s, Math.round(l * 9 / 16));
        let best = LADDER[0];
        LADDER.forEach(function (x) { if (Math.abs(x - e) < Math.abs(best - e)) best = x; });
        return best;
    }
    function qFor(R) { let best = 'tiny'; Object.keys(Q2H).forEach(function (q) { if (Q2H[q] <= R && Q2H[q] > Q2H[best]) best = q; }); return best; }

    function perV(v) { return v && K.S.perVideo ? (K.S.perVideo[v] || null) : null; }
    function kindOf(v) {
        if (!IS_TOP || location.pathname.indexOf('/embed/') === 0) return 'embed';
        if ((v && live.has(v)) || location.pathname.indexOf('/live/') === 0) return 'live';
        if (onShorts()) return 'shorts';
        return 'video';
    }
    function prof(v) { return K.S.profiles[kindOf(v)] || PROFILE; }
    function baseOrder(v) {
        const P = prof(v);
        if (!BIT[P.codec1]) return null;
        const o = [P.codec1];
        if (BIT[P.codec2] && P.codec2 !== P.codec1) o.push(P.codec2);
        FAM.forEach(function (c) { if (o.indexOf(c) === -1) o.push(c); });
        return o;
    }
    // Codecs this browser can't decode at all (e.g. AV1 in Edge on Windows without Microsoft's
    // free "AV1 Video Extension") are never chosen — asked once, with the browser's own answer.
    const NATIVE_TS = (function () { try { return window.MediaSource && MediaSource.isTypeSupported ? MediaSource.isTypeSupported.bind(MediaSource) : null; } catch (e) { return null; } })();
    const DEC_TEST = { av1: 'video/mp4; codecs="av01.0.05M.08"', vp9: 'video/webm; codecs="vp9"', avc: 'video/mp4; codecs="avc1.4d401f"' };
    const DEC = {};
    function decodable(c) {
        if (!(c in DEC)) { let r = true; try { if (NATIVE_TS && DEC_TEST[c]) r = !!NATIVE_TS(DEC_TEST[c]); } catch (e) {} DEC[c] = r; }
        return DEC[c];
    }
    function order(v) {
        const pv = perV(v);
        let o = baseOrder(v);
        if (pv && BIT[pv.codec]) {
            const b = o || FAM;
            o = [pv.codec].concat(b.filter(function (c) { return c !== pv.codec; }));
        }
        if (!o) return o;
        const ok = o.filter(decodable);
        return ok.length ? ok : o;
    }
    function startRes(v) { const pv = perV(v); return (pv && +pv.res) || +prof(v).startRes || 0; }
    function fpsCap(v) { const pv = perV(v); const f = pv ? +pv.fps : 0; return f > 0 ? f : (+prof(v).maxFps || 60); }

    // THE PLAN: framerate limit first (only if versions within it exist), then the codec order
    // PER QUALITY: for every resolution@fps the video has, keep the first codec in your order
    // that has it. Qualities are never removed — only duplicate copies in a less-preferred codec.
    function plan(v, T) {
        let F = T.slice();
        const pvc = perV(v) && perV(v).codec;                  // you picked a codec for THIS video: use only that codec
        if (BIT[pvc] && F.some(function (t) { return t.fam === pvc; })) F = F.filter(function (t) { return t.fam === pvc; });
        const Fc = fpsCap(v);
        if (Fc < 60) {
            const a = F.filter(function (t) { return t.fps <= Fc; });
            if (a.length) F = a;
            else { const mn = Math.min.apply(null, F.map(function (t) { return t.fps; })); F = F.filter(function (t) { return t.fps === mn; }); }
        }
        // ONE codec per video, like YouTube itself serves it (mixing codecs across qualities breaks
        // YouTube's player: empty quality menu, switches that don't happen).
        // The codec is simply the FIRST in your order that the video has. Quality never changes
        // the codec: YouTube's own ⚙ menu (or your starting quality) picks the size within it.
        // Even a single quality counts (AV1 360p only beats VP9 240p–1080p). Only exception:
        // "Best" (start at 4320) takes the codec with the top size.
        const O = order(v), pick = {};
        let keep = F;
        if (O) {
            const ps = function (c) { const o = {}; F.forEach(function (t) { if (t.fam === c) o[t.p] = 1; }); return Object.keys(o).map(Number); };
            const top = Math.max.apply(null, F.map(function (t) { return t.p; }));
            const sr = startRes(v);
            const ok = function (c) {
                const q = ps(c);
                if (!q.length) return false;
                if (sr >= 4320) return Math.max.apply(null, q) >= top;
                return true;
            };
            const topOf = function (c) { const q = ps(c); return q.length ? Math.max.apply(null, q) : 0; };
            let c = null, best = 0;
            for (let i = 0; i < O.length; i++) { if (ok(O[i])) { c = O[i]; break; } }
            if (!c) for (let i = 0; i < O.length; i++) { const m = topOf(O[i]); if (m > best) { best = m; c = O[i]; } }
            if (c) {
                keep = F.filter(function (t) { return t.fam === c; });
                keep.forEach(function (t) { pick[t.p + '@' + t.fps] = c; });
            }
        }
        const fams = new Set(), byP = {};
        keep.forEach(function (t) { fams.add(t.fam); (byP[t.p] = byP[t.p] || new Set()).add(t.fam); });
        let target = null;                                     // your most-preferred codec this video has
        if (O) for (let i = 0; i < O.length; i++) { if (fams.has(O[i])) { target = O[i]; break; } }
        return {
            keep: keep, target: target, pick: pick, byP: byP, fams: fams,
            maxP: Math.max.apply(null, F.map(function (t) { return t.p; })),
            maxFps: Math.max.apply(null, F.map(function (t) { return t.fps; }))
        };
    }
    // the codec the plan uses at a given playing size (falls back to the overall target)
    function targetAt(pl, p, fps) {
        if (!pl) return null;
        if (p && fps && pl.pick[p + '@' + fps]) return pl.pick[p + '@' + fps];
        if (p) {
            let best = null;                                   // nearest size the video has
            Object.keys(pl.byP).forEach(function (k) { if (best === null || Math.abs(k - p) < Math.abs(best - p)) best = +k; });
            if (best !== null) { for (const f of pl.byP[best]) return f; }
        }
        return pl.target;
    }

    // ================================================================
    // MEMORY  videoId -> bitmask (codecs available, watched, played...)
    // ================================================================
    const MAP_KEY = 'yt_av1_map_v22';
    const map = (function () {
        let out = {};
        try { out = JSON.parse(localStorage.getItem(MAP_KEY)) || {}; } catch (e) {}
        try {
            const olds = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('yt_av1_map_') === 0 && k !== MAP_KEY) olds.push(k);
            }
            olds.forEach(function (k) {
                try { const o = JSON.parse(localStorage.getItem(k)) || {}; Object.keys(o).forEach(function (v) { if (!(v in out)) out[v] = o[v]; }); } catch (e) {}
                try { localStorage.removeItem(k); } catch (e) {}
            });
            if (olds.length) localStorage.setItem(MAP_KEY, JSON.stringify(out));
        } catch (e) {}
        return out;
    })();
    let saveTimer = null, memDirty = true;
    function save() {
        memDirty = true;
        if (saveTimer) return;
        saveTimer = setTimeout(function () {
            saveTimer = null;
            try {
                const ks = Object.keys(map);
                if (ks.length > 8000) ks.slice(0, 2000).forEach(function (k) { delete map[k]; });
                localStorage.setItem(MAP_KEY, JSON.stringify(map));
            } catch (e) {}
        }, 800);
    }
    function asNum(old) { return typeof old === 'number' ? old : (old === false ? NOHINT.av1 : 0); }
    function put(v, n) { if (map[v] === n) return; delete map[v]; map[v] = n; save(); }
    function has(v, c) {
        const n = map[v];
        if (typeof n === 'number') { if (n & KNOWN) return !!(n & BIT[c]); if (n & NOHINT[c]) return false; return null; }
        if (n === true) return c === 'av1' ? true : null;
        if (n === false) return c === 'av1' ? false : null;
        return null;
    }
    function setKnown(v, info) {
        const keep = typeof map[v] === 'number' ? (map[v] & (WATCHED | PLAYED_ALL)) : 0;
        put(v, keep | KNOWN | info.m);
    }
    function markPlayed(v, fam) { if (!BIT[fam]) return; const n = (asNum(map[v]) & ~PLAYED_ALL) | WATCHED | PLAYED[fam]; put(v, n); }
    function setHint(v, fam) { const n = asNum(map[v]); if (!(n & KNOWN) && BIT[fam]) put(v, n | NOHINT[fam]); }

    // full availability of a response, computed BEFORE trimming and carried along
    const FULL = new Map();                                 // videoId -> the FULL format list ever seen (never a trimmed copy)
    function fullInfo(d) {
        const info = fullInfo0(d), v = info && vidOf(d);
        if (!v) return info;
        const old = FULL.get(v);
        if (old && old !== info) {
            const seen = {}; old.t.forEach(function (t) { seen[t.fam + t.p + '@' + t.fps] = 1; });
            const add = info.t.filter(function (t) { return !seen[t.fam + t.p + '@' + t.fps]; });
            if (add.length || (info.m | old.m) !== old.m) { const u = { m: old.m | info.m, t: old.t.concat(add) }; FULL.set(v, u); return u; }
            return old;
        }
        FULL.set(v, info);
        if (FULL.size > 40) FULL.delete(FULL.keys().next().value);
        return info;
    }
    function fullInfo0(d) {
        const sd = d && d.streamingData;
        if (!sd) return null;
        if (sd.ytldInfo && sd.ytldInfo.t) return sd.ytldInfo;
        const f = sd.adaptiveFormats;
        if (!f) return null;
        const vids = f.filter(isVideoFmt).map(norm).filter(function (t) { return t.fam; });
        if (!vids.length) return null;
        let m = 0; const seen = {}, t = [];
        vids.forEach(function (x) {
            m |= BIT[x.fam]; if (x.fps > 30) m |= HFR; if (x.p >= 2160) m |= UHD;
            const k = x.fam + x.p + '@' + x.fps;
            if (!seen[k]) { seen[k] = 1; t.push({ fam: x.fam, p: x.p, l: x.l, fps: x.fps }); }
        });
        const info = { m: m, t: t };
        try { sd.ytldInfo = info; } catch (e) {}
        return info;
    }

    const recent = new Map();                               // videoId -> formats of recently seen videos (e.g. the next, preloaded Short)
    function isLiveVD(vd) { return !!(vd && (vd.isLive || vd.isUpcoming || vd.isPostLiveDvr)); }
    function vidOf(d) { const vd = d && d.videoDetails; return vd && ID_RE.test(vd.videoId || '') ? vd.videoId : null; }
    function learn(d) {
        if (!d || typeof d !== 'object') return null;
        const v = vidOf(d);
        if (!v) return null;
        if (isLiveVD(d.videoDetails)) { live.add(v); return null; }
        const info = fullInfo(d);
        if (info) {
            setKnown(v, info);
            recent.set(v, { info: info, at: Date.now() });
            if (recent.size > 8) recent.delete(recent.keys().next().value);
        }
        return info;
    }
    function playerResp(v) {
        try {
            const p = playerEl();
            const pr = p && typeof p.getPlayerResponse === 'function' && p.getPlayerResponse();
            if (pr && pr.videoDetails && pr.videoDetails.videoId === v) return pr;
        } catch (e) {}
        return null;
    }

    // once-per-video reload markers + safety caps
    const REL_KEY = 'yt_av1_reloaded_v22_';
    const healed = (function () {
        const s = new Set();
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.indexOf('yt_av1_reloaded_') === 0 && sessionStorage.getItem(k) === '1') s.add(k.slice(-11));
            }
        } catch (e) {}
        return s;
    })();
    function markHealed(v) { healed.add(v); try { sessionStorage.setItem(REL_KEY + v, '1'); } catch (e) {} }
    function counter(k) { try { return parseInt(sessionStorage.getItem(k), 10) || 0; } catch (e) { return 0; } }
    function bump(k) { try { sessionStorage.setItem(k, String(counter(k) + 1)); } catch (e) {} }
    const HEALS = 'yt_av1_heals', SHORTS_HEALS = 'yt_av1_shorts_heals';
    function capsReached() { return counter(HEALS) >= 10 || (onShorts() && counter(SHORTS_HEALS) >= 4); }

    // ================================================================
    // THE PLAYER, read and nudged from the outside only through these
    // ================================================================
    // the qualities the player offers right now (what YouTube's own menu shows)
    function playerLevels(p) {
        const out = [], seen = {};
        try {
            const d = typeof p.getAvailableQualityData === 'function' ? p.getAvailableQualityData() : null;
            if (d && d.length) d.forEach(function (x) {
                if (!x || !Q2H[x.quality] || seen[x.quality] || x.isPlayable === false) return;
                seen[x.quality] = 1; out.push({ q: x.quality, p: Q2H[x.quality], label: String(x.qualityLabel || (Q2H[x.quality] + 'p')).replace(/\s*Premium.*/i, '') });
            });
        } catch (e) {}
        try {
            if (!out.length && typeof p.getAvailableQualityLevels === 'function') (p.getAvailableQualityLevels() || []).forEach(function (q) {
                if (!Q2H[q] || seen[q]) return;
                seen[q] = 1; out.push({ q: q, p: Q2H[q], label: Q2H[q] >= 4320 ? '8K' : Q2H[q] + 'p' });
            });
        } catch (e) {}
        return out.sort(function (a, b) { return a.p - b.p; });
    }
    function setQuality(p, q) {
        let saved = null;
        try { saved = localStorage.getItem('yt-player-quality'); } catch (e) {}
        try {
            if (q === 'auto') {
                if (typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange('auto', 'auto');
                if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality('auto');
            } else {
                if (typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange(q, q);
                if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(q);
            }
        } catch (e) {}
        try {
            if (saved === null) localStorage.removeItem('yt-player-quality');
            else if (localStorage.getItem('yt-player-quality') !== saved) localStorage.setItem('yt-player-quality', saved);
        } catch (e) {}
    }
    function statsOf(p) {
        const out = { fam: null, p: null, fps: null, w: 0, h: 0 };
        if (!p) return out;
        let vid = null;
        try { vid = p.querySelector && p.querySelector('video'); } catch (e) {}
        try {
            const st = typeof p.getStatsForNerds === 'function' ? p.getStatsForNerds() : null;
            const txt = st ? JSON.stringify(st) : '';
            const mr = txt.match(/(\d{2,5})x(\d{2,5})@(\d{2,3})/);
            if (mr) { out.w = +mr[1]; out.h = +mr[2]; out.fps = +mr[3]; }
            const mc = txt.match(/\b(av01|vp09|vp9|avc1|avc3)[.\w]*/);
            if (mc) { out.fam = famOf(mc[0]); out.codec = mc[0]; }
        } catch (e) {}
        if (!out.w && vid && vid.videoWidth) { out.w = vid.videoWidth; out.h = vid.videoHeight; }
        if (out.w) out.p = ladderP(out.w, out.h);
        return out;
    }
    // What the player is REALLY playing, straight from its own stats (works for Shorts, whose
    // player is reused and doesn't create a new buffer for every Short).
    function realPlaying(v) {
        const p = playerEl();
        if (!p) return null;
        try { const d = typeof p.getVideoData === 'function' ? p.getVideoData() : null; if (d && d.video_id && d.video_id !== v) return null; } catch (e) {}
        const vid = p.querySelector && p.querySelector('video');
        if (!vid || vid.readyState < 2 || !(vid.currentTime > 0)) return null;
        return statsOf(p);
    }
    function isPlaying(v) { return K.rt.bufFor === v || !!realPlaying(v); }
    function errSeen(p) {
        try { const vid = p && p.querySelector('video'); if (vid && vid.error) return true; } catch (e) {}
        try { if (p && p.querySelector('.ytp-error, [class*="ytp-error"]')) return true; } catch (e) {}
        try { const x = document.querySelector('yt-playability-error-supported-renderers'); if (x && x.offsetParent !== null) return true; } catch (e) {}
        return false;
    }
    function stuck(p) { try { const vid = p && p.querySelector('video'); return !vid || vid.readyState === 0; } catch (e) { return false; } }
    function playedFam() { const m = (K.rt.lastType || '').match(/codecs="?([a-zA-Z0-9.]+)/); return m ? famOf(m[1]) : null; }

    // ================================================================
    // ON-PAGE NOTICES (built with plain DOM; YouTube's page rules forbid innerHTML)
    // ================================================================
    let toastHost = null, toastTimer = null;
    K.rt.toastFor = null;
    const TOAST_CSS =
        '.box{font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f1f1f1;background:#1c1c1c;border:1px solid #333;border-left:4px solid #2bd576;' +
        'border-radius:12px;padding:12px 14px;width:320px;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:in .18s ease-out}' +
        '.warn{border-left-color:#ffb02e}.error{border-left-color:#ff4545}' +
        '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}' +
        '.t{font-weight:700;font-size:13.5px}.x{background:none;border:0;color:#999;font-size:18px;line-height:1;cursor:pointer;padding:0 2px}' +
        '.x:hover{color:#fff}.d{color:#bbb;margin-top:4px}.cd{color:#ffb02e;margin-top:6px;font-weight:600}' +
        '.b{display:flex;gap:8px;margin-top:10px}.b button{border:0;border-radius:8px;padding:6px 12px;font:inherit;font-weight:700;cursor:pointer;background:#333;color:#f1f1f1}' +
        '.b button.p{background:#3ea6ff;color:#000}.b button:hover{filter:brightness(1.15)}' +
        '@keyframes in{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}';
    function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function closeToast() {
        if (toastTimer) { clearInterval(toastTimer); toastTimer = null; }
        if (toastHost) { try { toastHost.remove(); } catch (e) {} toastHost = null; }
        K.rt.toastFor = null;
    }
    function toast(o) {
        closeToast();
        try {
            const host = mk('div');
            host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
            const root = host.attachShadow({ mode: 'closed' });
            root.appendChild(mk('style', null, TOAST_CSS));
            const box = mk('div', 'box ' + (o.kind || ''));
            const top = mk('div', 'top');
            top.appendChild(mk('div', 't', o.title));
            const x = mk('button', 'x', '×');
            x.addEventListener('click', function () { if (o.onClose) o.onClose(); closeToast(); });
            top.appendChild(x);
            box.appendChild(top);
            if (o.text) box.appendChild(mk('div', 'd', o.text));
            let cd = null;
            if (o.countdown) { cd = mk('div', 'cd'); box.appendChild(cd); }
            if (o.buttons && o.buttons.length) {
                const b = mk('div', 'b');
                o.buttons.forEach(function (btn) {
                    const e = mk('button', btn.primary ? 'p' : '', btn.label);
                    e.addEventListener('click', btn.onClick);
                    b.appendChild(e);
                });
                box.appendChild(b);
            }
            root.appendChild(box);
            (document.fullscreenElement || document.body || document.documentElement).appendChild(host);
            toastHost = host; K.rt.toastFor = o.forVid || null;
            if (o.countdown) {
                let s = o.countdown.secs;
                cd.textContent = o.countdown.fmt(s);
                toastTimer = setInterval(function () {
                    if (document.visibilityState !== 'visible') return;  // pauses in background tabs
                    s--;
                    if (s <= 0) { clearInterval(toastTimer); toastTimer = null; o.countdown.onDone(); }
                    else cd.textContent = o.countdown.fmt(s);
                }, 1000);
            } else if (o.timeout) {
                const me = host;
                setTimeout(function () { if (toastHost === me) closeToast(); }, o.timeout);
            }
        } catch (e) {}
    }

    // ---- the shared bag stages reach through (who writes what: PIPELINE.md) ----
    K.live = live; K.healed = healed;
    K.FAM = FAM; K.NAME = NAME; K.BIT = BIT; K.Q2H = Q2H; K.ID_RE = ID_RE; K.URL_VID_RE = URL_VID_RE;
    K.curVid = curVid; K.onShorts = onShorts; K.kindOf = kindOf; K.prof = prof; K.perV = perV;
    K.baseOrder = baseOrder; K.order = order; K.startRes = startRes; K.fpsCap = fpsCap;
    K.decodable = decodable; K.famOf = famOf; K.isVideoFmt = isVideoFmt; K.norm = norm;
    K.ladderP = ladderP; K.qFor = qFor; K.plan = plan; K.targetAt = targetAt;
    K.mem = { map: map, put: put, has: has, setKnown: setKnown, markPlayed: markPlayed, setHint: setHint, save: save, isDirty: function () { return memDirty; }, clean: function () { memDirty = false; } };
    K.fullInfo = fullInfo; K.recent = recent; K.learn = learn; K.isLiveVD = isLiveVD; K.vidOf = vidOf; K.resp = playerResp;
    K.heal = { mark: markHealed, bump: bump, reached: capsReached, HEALS: HEALS, SHORTS: SHORTS_HEALS };
    K.player = { el: playerEl, levels: playerLevels, setQuality: setQuality, statsOf: statsOf, realPlaying: realPlaying, isPlaying: isPlaying, errSeen: errSeen, stuck: stuck, playedFam: playedFam };
    K.toast = toast; K.closeToast = closeToast; K.mk = mk;

    // ================================================================
    // POPUP LINK: settings in; diagnostics + memory out (never to YouTube)
    // The bus: stages answer popup messages with K.reply(kind, fn) and get told when settings change.
    // ================================================================
    function nowPlaying() {
        const v = curVid();
        const out = { vid: v, shorts: onShorts(), live: !!(v && live.has(v)), state: 'idle',
            playing: null, avail: null, res: [], fps: [], target: null, preferred: null,
            per: perV(v), caps: v ? { start: startRes(v), fps: fpsCap(v) } : null };
        if (!v) return out;
        const O = order(v); out.preferred = baseOrder(v) ? baseOrder(v)[0] : null;
        const pr = playerResp(v), p = playerEl();
        if (pr && isLiveVD(pr.videoDetails)) { live.add(v); out.live = true; }
        const info = pr ? fullInfo(pr) : null;
        let planObj = null;
        out.kind = kindOf(v);
        if (info) {
            out.avail = { av1: !!(info.m & 1), vp9: !!(info.m & 2), avc: !!(info.m & 4) };
            const rs = {}, fs = {};
            info.t.forEach(function (t) { rs[t.p] = 1; fs[t.fps] = 1; });
            out.res = Object.keys(rs).map(Number).sort(function (a, b) { return a - b; });
            out.fps = Object.keys(fs).map(Number).sort(function (a, b) { return a - b; });
            planObj = plan(v, info.t); out.target = planObj.target;
            const rows = {};                                     // per quality: codecs + fps it exists in, and the codec used
            info.t.forEach(function (t) {
                const lp = ladderP(t.p, t.l || t.p);
                const r = rows[lp] = rows[lp] || { p: lp, fams: [], fps: [], use: null };
                if (r.fams.indexOf(t.fam) < 0) r.fams.push(t.fam);
                if (r.fps.indexOf(t.fps) < 0) r.fps.push(t.fps);
            });
            planObj.keep.forEach(function (t) { const r = rows[ladderP(t.p, t.l || t.p)]; if (r && !r.use) r.use = t.fam; });
            out.rows = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return a.p - b.p; });
            const kept = new Set(planObj.keep), seenF = {};               // every real format: codec, quality, fps, and
            out.fmts = [];                                                 // whether YouTube's menu uses it right now
            info.t.forEach(function (t) {
                const f = { c: t.fam, p: ladderP(t.p, t.l || t.p), f: t.fps, use: kept.has(t) }, k = f.c + f.p + '@' + f.f;
                if (seenF[k]) { if (f.use) seenF[k].use = true; return; }
                seenF[k] = f; out.fmts.push(f);
            });
        } else {
            out.avail = { av1: has(v, 'av1'), vp9: has(v, 'vp9'), avc: has(v, 'avc') };
            if (O) for (let i = 0; i < O.length; i++) { if (has(v, O[i]) !== false) { out.target = O[i]; break; } }
        }
        if (p) {
            out.levels = playerLevels(p);
            try { out.q = typeof p.getPlaybackQuality === 'function' ? p.getPlaybackQuality() : null; } catch (e) {}
            try { const pq = typeof p.getPreferredQuality === 'function' ? p.getPreferredQuality() : null; out.auto = pq ? pq === 'auto' : null; } catch (e) {}
        }
        const rp = realPlaying(v);
        if (rp || K.rt.bufFor === v) {
            const pl = rp || statsOf(p);
            if (!pl.fam && K.rt.bufFor === v) pl.fam = playedFam();
            out.playing = pl; out.state = 'playing';
            if (planObj && pl.p) out.target = targetAt(planObj, pl.p, pl.fps) || out.target;   // codec picked for THIS quality
        } else if (K.rt.errorFor === v || (K.rt.blockedFor === v && errSeen(p))) out.state = 'error';
        else out.state = 'loading';
        if (out.state !== 'playing' && errSeen(p)) out.state = 'error';
        return out;
    }
    K.nowPlaying = nowPlaying;
    K.reply = function (kind, fn) { (K._re = K._re || {})[kind] = fn; };
    K.reply('status', function () { return nowPlaying(); });
    K.reply('resetMemory', function () { Object.keys(map).forEach(function (k) { delete map[k]; }); save(); return { ok: true }; });

    if (IS_TOP) {
        setInterval(function () {
            if (!memDirty) return;
            memDirty = false;
            try { window.postMessage({ __ytld: 'toExt', kind: 'memory', data: map }, ORIGIN); } catch (e) {}
        }, 5000);
    }
    window.addEventListener('message', function (e) {
        if (e.source !== window || !e.data || e.data.__ytld !== 'toPage') return;
        const m = e.data;
        if (m.kind === 'settings') { K.setSettings(m.settings); return; }
        if (!IS_TOP) return;
        const h = K._re && K._re[m.kind];
        let data = null;
        if (h) { try { data = h(m); } catch (err) {} }
        window.postMessage({ __ytld: 'toExt', id: m.id, data: data }, ORIGIN);
    });
})();
