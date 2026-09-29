// TubeDial — Smart Quality for YouTube — page engine (runs in the page at document start).
// Picks, among the formats YouTube ALREADY offers, the one matching your
// codec order + resolution + framerate choices. Makes ZERO extra requests.
(function () {
    'use strict';
    if (window.__ytldLoaded) return;
    window.__ytldLoaded = true;

    const IS_TOP = (function () { try { return window.top === window.self; } catch (e) { return true; } })();
    const ORIGIN = location.origin;

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
        autoReloadSec: 5                     // error notice countdown (0 = never reload by itself)
    };
    function merge(s) {
        const o = Object.assign({}, DEFAULTS, s || {});
        if (!o.perVideo || typeof o.perVideo !== 'object') o.perVideo = {};
        if (s && s.thumbH === undefined && s.thumbQuality) o.thumbH = ({ '70p': 68, '180p': 180, '270p': 270, '360p': 360, 'original': 0 })[s.thumbQuality] ?? DEFAULTS.thumbH;
        if (s && s.shortsThumbH === undefined && s.shortsThumbQuality) o.shortsThumbH = ({ '90p': 90, '180p': 180, '360p': 360, '480p': 480, 'original': 0 })[s.shortsThumbQuality] ?? DEFAULTS.shortsThumbH;
        if (s && s.previewH === undefined && s.previewQuality) o.previewH = ({ '144p': 144, '240p': 240, '360p': 360, '480p': 480, '720p': 720, 'off': 0 })[s.previewQuality] ?? DEFAULTS.previewH;
        let pr = s && s.profiles && typeof s.profiles === 'object' ? s.profiles : null;
        if (!pr && s && (s.codec1 || s.maxRes || s.maxFps || s.av1 === false)) {        // v1/v2 migration
            const b = { codec1: s.codec1 || (s.av1 === false ? 'auto' : 'av1'), codec2: s.codec2 || 'vp9', maxRes: +s.maxRes || 0, maxFps: +s.maxFps || 60 };
            pr = { video: b, shorts: b, embed: b, live: Object.assign({}, b, { codec1: 'auto' }) };
        }
        o.profiles = {};
        KINDS.forEach(function (k) {
            const q = Object.assign({}, DEFAULTS.profiles[k], (pr && pr[k]) || {});
            if (pr && pr[k] && pr[k].startRes === undefined && +pr[k].maxRes > 0) q.startRes = +pr[k].maxRes;   // old limit -> start quality
            o.profiles[k] = q;
        });
        if (s && s.perVideoFps && typeof s.perVideoFps === 'object') {          // v1 migration
            Object.keys(s.perVideoFps).forEach(function (k) { if (!o.perVideo[k]) o.perVideo[k] = { fps: s.perVideoFps[k] }; });
        }
        return o;
    }
    let S = (function () { try { return merge(JSON.parse(localStorage.getItem('ytld_settings'))); } catch (e) { return merge(null); } })();

    const FAM = ['av1', 'vp9', 'avc'];
    const NAME = { av1: 'AV1', vp9: 'VP9', avc: 'H.264' };
    const BIT = { av1: 1, vp9: 2, avc: 4 };
    const KNOWN = 16, WATCHED = 32;
    const PLAYED = { av1: 64, vp9: 128, avc: 256 }, PLAYED_ALL = 64 | 128 | 256;
    const NOHINT = { av1: 512, vp9: 1024, avc: 2048 }, HINT_ALL = 512 | 1024 | 2048;
    const HFR = 4096, UHD = 8192;             // has >30fps / has 2160p+
    const Q2H = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, highres: 4320 };

    const ID_RE = /^[A-Za-z0-9_-]{11}$/;
    const URL_VID_RE = /(?:[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/;
    function curVid() { try { const m = location.href.match(URL_VID_RE); return m ? m[1] : null; } catch (e) { return null; } }
    function onShorts() { return location.pathname.indexOf('/shorts/') === 0; }
    function playerEl() { try { return document.getElementById(onShorts() ? 'shorts-player' : 'movie_player'); } catch (e) { return null; } }

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

    function perV(v) { return v && S.perVideo ? (S.perVideo[v] || null) : null; }
    function kindOf(v) {
        if (!IS_TOP || location.pathname.indexOf('/embed/') === 0) return 'embed';
        if ((v && live.has(v)) || location.pathname.indexOf('/live/') === 0) return 'live';
        if (onShorts()) return 'shorts';
        return 'video';
    }
    function prof(v) { return S.profiles[kindOf(v)] || PROFILE; }
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
            const vidPs = {}; F.forEach(function (t) { vidPs[t.p] = 1; });
            const nP = Object.keys(vidPs).length;
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

    const live = new Set();
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
    // WEAPON 1 — trim the format list YouTube already sent, per the plan
    // ================================================================
    const ORIG = new Map();                                 // videoId -> YouTube's original, untrimmed format list
    function prune(d) {
        if (!d || typeof d !== 'object') return false;
        if (d.playerResponse && !d.streamingData) return prune(d.playerResponse);
        const info = learn(d);
        if (!info || isLiveVD(d.videoDetails)) return false;
        const f = d.streamingData.adaptiveFormats;
        const T = f.filter(isVideoFmt).map(norm).filter(function (t) { return t.fam; });
        if (!T.length) return false;
        const vv = vidOf(d);
        if (vv && (!ORIG.has(vv) || ORIG.get(vv).length < f.length)) {
            ORIG.set(vv, f.slice());
            if (ORIG.size > 20) ORIG.delete(ORIG.keys().next().value);
        }
        const pl = plan(vv, T);
        if (pl.keep.length === T.length) return false;
        const ks = new Set(pl.keep.map(function (t) { return t.ref; }));
        d.streamingData.adaptiveFormats = f.filter(function (x) { return !isVideoFmt(x) || ks.has(x) || !norm(x).fam; });
        return true;
    }

    // direct page loads — chains any existing hook (Brave's ad blocker uses this property too)
    try {
        const prev = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
        if (!prev || prev.configurable) {
            let val = prev && !prev.get ? prev.value : undefined;
            if (val) { try { prune(val); } catch (e) {} }
            Object.defineProperty(window, 'ytInitialPlayerResponse', {
                configurable: true, enumerable: true,
                get: function () { return prev && prev.get ? prev.get.call(window) : val; },
                set: function (x) {
                    try { prune(x); } catch (e) {}
                    if (prev && prev.set) prev.set.call(window, x); else val = x;
                }
            });
        }
    } catch (e) {}
    try {
        const orig = JSON.parse;
        JSON.parse = function (text) {
            const data = orig.apply(this, arguments);
            try { if (typeof text === 'string' && text.indexOf('"streamingData"') !== -1) prune(data); } catch (e) {}
            return data;
        };
    } catch (e) {}
    try {
        const origFetch = window.fetch;
        window.fetch = function () {
            const args = arguments;
            return origFetch.apply(this, args).then(function (response) {
                let url = '';
                try { const a0 = args[0]; url = a0 instanceof Request ? a0.url : String(a0); } catch (e) {}
                if (url.indexOf('/youtubei/v1/player') === -1 && url.indexOf('/youtubei/v1/reel/') === -1) return response;
                return response.clone().text().then(function (txt) {
                    if (txt.indexOf('"streamingData"') === -1) return response;
                    const json = JSON.parse(txt);
                    if (!prune(json)) return response;
                    const out = new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
                    try { Object.defineProperty(out, 'url', { value: response.url }); } catch (e) {}
                    return out;
                }).catch(function () { return response; });
            });
        };
    } catch (e) {}

    // ================================================================
    // WEAPON 2 — capability veto (purely local): answer "unsupported"
    // for codecs / sizes / framerates outside the plan
    // ================================================================
    let armed = false, shortsWarm = false;
    let blockedFor = null, blockedTarget = null, bufFor = null, bufAt = 0, lastType = '';
    let lastHref = location.href, lastVid = curVid(), vidSince = Date.now();

    // does a recently seen other video (e.g. the preloaded next Short) use this exact format?
    function otherAllows(v, fam, p, fr) {
        const now = Date.now();
        for (const [id, e] of recent) {
            if (id === v || now - e.at > 180000) continue;
            const pl = plan(id, e.info.t);
            if (p) { if (pl.keep.some(function (t) { return t.fam === fam && t.p === p && (!fr || t.fps === fr); })) return true; }
            else if (pl.fams.has(fam)) return true;
        }
        return false;
    }
    function num(type, key) { const m = type.match(new RegExp(key + '=(\\d+)', 'i')); return m ? +m[1] : 0; }
    function shouldBlock(type) {
        if (!armed || typeof type !== 'string' || type.indexOf('video/') !== 0) return false;
        const v = curVid();
        if (!v) return false;
        if (healed.has(v)) return false;
        if (onShorts() && !shortsWarm) return false;           // let the Shorts player start up
        const cm = type.match(/codecs="?([a-zA-Z0-9.]+)/i);
        const fam = cm ? famOf(cm[1]) : null;
        const w = num(type, 'width'), h = num(type, 'height'), fr = num(type, 'framerate');
        const p = (w && h) ? Math.min(w, h) : (h || w);

        const pr = playerResp(v);
        let info = null;
        if (pr) {
            if (isLiveVD(pr.videoDetails)) { live.add(v); info = fullInfo(pr); }
            else info = learn(pr);
        }
        if (info) {                                             // exact: the player's own data (videos, Shorts AND live)
            const pl = plan(v, info.t), Fc = fpsCap(v);
            // A size this video doesn't have is usually for ANOTHER video (the next Short is preloaded
            // while the URL still shows this one): only your explicit framerate limit applies to it.
            let block = !!(Fc < 60 && fr && fr > Fc && pl.maxFps <= Fc);
            if (!block && fam) {
                const inVideo = p && info.t.some(function (t) { return t.p === p && (!fr || t.fps === fr); });
                if (inVideo) block = !pl.keep.some(function (t) { return t.fam === fam && t.p === p && (!fr || t.fps === fr); }) && !otherAllows(v, fam, p, fr);
                else if (!p) block = !pl.fams.has(fam) && !otherAllows(v, fam, 0, 0);
            }
            if (block) { blockedFor = v; blockedTarget = targetAt(pl, p, fr); }
            return block;
        }
        if (live.has(v) || location.pathname.indexOf('/live/') === 0) return false;   // live: never guess
        const Fc = fpsCap(v);                                   // unknown: safe rules
        if (fr && fr > Math.max(Fc, 30)) { blockedFor = v; return true; }       // <=30fps exists for everything
        if (!fam) return false;
        const O = order(v);
        if (!O) return false;
        let t = null;
        for (let i = 0; i < O.length; i++) { if (has(v, O[i]) !== false) { t = O[i]; break; } }
        if (!t || fam === t) return false;
        if (has(v, t) === null && capsReached()) return false;
        blockedFor = v; blockedTarget = t;
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
                        bufFor = curVid(); bufAt = Date.now(); lastType = t;
                        if (onShorts()) shortsWarm = true;
                    }
                } catch (e) {}
                return o.call(this, t);
            };
        }
    } catch (e) {}

    // LIVE / UPCOMING badges on what you click
    const LOCKUP = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-rich-grid-media, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ytd-channel-video-player-renderer';
    const LIVE_SEL = '.badge-style-type-live-now, .badge-style-type-live-now-alternate, [overlay-style="LIVE"], [overlay-style="UPCOMING"], .yt-badge-shape--thumbnail-live, .badge-shape-wiz--thumbnail-live';
    const LIVE_WORDS = ['LIVE', 'LIVE NOW', 'UPCOMING', 'PREMIERE', 'PREMIERING NOW', 'مباشر', 'بث مباشر', 'قريبًا'];
    document.addEventListener('click', function (e) {
        try {
            const a = e.target && e.target.closest && e.target.closest('a[href]');
            if (!a) return;
            const m = a.href.match(URL_VID_RE);
            if (!m) return;
            const box = a.closest(LOCKUP);
            if (!box) return;
            if (box.querySelector(LIVE_SEL)) { live.add(m[1]); return; }
            const badges = box.querySelectorAll('badge-shape, .yt-badge-shape__text, .badge-shape-wiz__text, ytd-badge-supported-renderer, ytd-thumbnail-overlay-time-status-renderer');
            for (let i = 0; i < badges.length; i++) {
                if (LIVE_WORDS.indexOf((badges[i].textContent || '').trim().toUpperCase()) !== -1) { live.add(m[1]); return; }
            }
        } catch (err) {}
    }, true);

    function errSeen(p) {
        try { const vid = p && p.querySelector('video'); if (vid && vid.error) return true; } catch (e) {}
        try { if (p && p.querySelector('.ytp-error, [class*="ytp-error"]')) return true; } catch (e) {}
        try { const x = document.querySelector('yt-playability-error-supported-renderers'); if (x && x.offsetParent !== null) return true; } catch (e) {}
        return false;
    }
    function stuck(p) { try { const vid = p && p.querySelector('video'); return !vid || vid.readyState === 0; } catch (e) { return false; } }

    // resolution limit, also via the player's own quality setting (keeps your saved quality)
    function qFor(R) { let best = 'tiny'; Object.keys(Q2H).forEach(function (q) { if (Q2H[q] <= R && Q2H[q] > Q2H[best]) best = q; }); return best; }
    // YouTube's quality name for a format size: 1920x800 is "1080p", a 1080x1920 Short is "1080p"
    const LADDER = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
    function ladderP(w, h) {
        const s = Math.min(w, h), l = Math.max(w, h), e = Math.max(s, Math.round(l * 9 / 16));
        let best = LADDER[0];
        LADDER.forEach(function (x) { if (Math.abs(x - e) < Math.abs(best - e)) best = x; });
        return best;
    }
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
    function isPlaying(v) { return bufFor === v || !!realPlaying(v); }

    // LOAD STRAIGHT AT THE STARTING QUALITY: YouTube's player reads its own saved quality
    // (localStorage "yt-player-quality") before it downloads anything, and a quality range set on
    // the player carries over to the next video. So new videos start at your quality from the very
    // first second, instead of playing a few seconds higher first. With "YouTube decides", your
    // own YouTube value is put back exactly as it was.
    const YTQ = 'yt-player-quality', YTQ_BK = 'tubedial_ytq_backup', YTQ_WR = 'tubedial_ytq_written';
    function ytqNum(str) {
        try { const o = JSON.parse(str); let d = o && o.data; if (typeof d === 'string' && d.charAt(0) === '{') d = JSON.parse(d); return d && typeof d === 'object' ? +d.quality || 0 : (Q2H[d] || 0); } catch (e) { return 0; }
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
    let earlyFor = null;
    function earlyStart() {
        const v = curVid();
        if (!v || v === earlyFor) return;
        earlyFor = v;
        const st = startRes(v);
        if (!st) { restoreYtq(); return; }
        writeYtq(Math.min(st, 4320));
        const p = playerEl(), q = qFor(st);
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
        const st = startRes(v);
        if (!st || !p || typeof p.getPlaybackQuality !== 'function') return true;
        const q = p.getPlaybackQuality();
        if (!Q2H[q]) return false;                              // not ready yet
        let t = st;
        if (info) t = Math.min(t, plan(v, info.t).maxP);        // "best" / above what the video has -> its best
        const tq = qFor(t);
        if (tq !== q) setQuality(p, tq);
        return true;
    }



    // ================================================================
    // ON-PAGE NOTICES (built with plain DOM; YouTube's page rules forbid innerHTML)
    // ================================================================
    let toastHost = null, toastTimer = null, toastFor = null;
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
        toastFor = null;
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
            toastHost = host; toastFor = o.forVid || null;
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

    // ================================================================
    // WATCHDOG (1s)
    // ================================================================
    let errorFor = null, checkedFor = null, resDoneFor = null, softCheck = null;
    // After an in-place switch, check the player really took it. If it kept the old codec (or its
    // quality menu came up empty), do ONE normal page reload for this video — which always works.
    function verifySoft(v, p, info, fam) {
        const age = Date.now() - softCheck.at;
        if (age > 15000) { softCheck = null; return; }
        if (age < 3000 || !info) return;
        const tg = plan(v, info.t).target;
        let empty = false;
        try { empty = typeof p.getAvailableQualityLevels === 'function' && playerLevels(p).length === 0; } catch (e) {}
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
    function playedFam() { const m = lastType.match(/codecs="?([a-zA-Z0-9.]+)/); return m ? famOf(m[1]) : null; }
    function reloadFor(v, t) {
        if (curVid() !== v) return;
        markHealed(v); bump(HEALS); if (onShorts()) bump(SHORTS_HEALS);
        if (t) setHint(v, t);
        location.reload();
    }
    function onError(v) {
        if (errorFor === v || healed.has(v)) return;
        errorFor = v;
        const t = blockedTarget;
        if (!S.notices) { reloadFor(v, t); return; }
        const secs = +S.autoReloadSec || 0;
        toast({
            kind: 'error', forVid: v,
            title: t ? 'This video couldn’t start in ' + NAME[t] : 'This video couldn’t start',
            text: t ? 'It probably has no ' + NAME[t] + ' version. Reloading plays it in the best format it has — only once for this video.'
                    : 'Reloading plays it in the best format it has — only once for this video.',
            buttons: [
                { label: 'Reload now', primary: true, onClick: function () { closeToast(); reloadFor(v, t); } },
                { label: 'Cancel', onClick: function () { markHealed(v); closeToast(); } }
            ],
            onClose: function () { markHealed(v); },
            countdown: secs > 0 ? { secs: secs, onDone: function () { closeToast(); reloadFor(v, t); }, fmt: function (s) { return 'Reloading by itself in ' + s + 's…'; } } : null
        });
    }
    function checkMismatch(v, pr, fam) {
        if (!S.notices || !fam) return;
        const info = pr ? fullInfo(pr) : null;
        if (!info) return;
        let pp = 0;
        try { const vid = playerEl() && playerEl().querySelector('video'); if (vid && vid.videoWidth) pp = Math.min(vid.videoWidth, vid.videoHeight); } catch (e) {}
        if (!pp) return;
        const pl = { target: targetAt(plan(v, info.t), pp, 0) };   // the codec picked for the quality being played
        if (!pl.target || pl.target === fam) return;
        toast({
            kind: 'warn', forVid: v, timeout: 12000,
            title: 'This video supports ' + NAME[pl.target],
            text: 'It’s currently playing in ' + NAME[fam] + '. Reload to switch to ' + NAME[pl.target] + '.',
            buttons: [
                { label: 'Reload in ' + NAME[pl.target], primary: true, onClick: function () { closeToast(); location.reload(); } },
                { label: 'Dismiss', onClick: closeToast }
            ]
        });
    }

    setInterval(function () {
        if (!IS_TOP) return;
        try {
            const v = curVid();
            if (location.href !== lastHref) {
                lastHref = location.href;
                if (v && v !== lastVid) armed = true;
            }
            if (v !== lastVid) {
                lastVid = v; vidSince = Date.now();
                earlyStart();
                if (toastFor && toastFor !== v) closeToast();
                return;
            }
            if (!v) return;
            const pr = playerResp(v);
            let info = null;
            if (pr) { if (isLiveVD(pr.videoDetails)) { live.add(v); info = fullInfo(pr); } else info = learn(pr); }
            const p = playerEl();
            const rp = bufFor === v ? null : realPlaying(v);
            if (bufFor === v || rp) {                           // playing
                const fam = (rp && rp.fam) || (bufFor === v ? playedFam() : null);
                if (fam && !live.has(v)) markPlayed(v, fam);
                if (softCheck && softCheck.v === v) verifySoft(v, p, info, fam);
                if (resDoneFor !== v && enforceRes(v, p, info)) resDoneFor = v;
                if (checkedFor !== v && (rp || Date.now() - bufAt > 1500)) { checkedFor = v; checkMismatch(v, pr, fam); }
                return;
            }
            if (blockedFor !== v) return;
            const waited = Date.now() - vidSince;
            if (waited < 3000 || healed.has(v)) return;
            if (document.visibilityState !== 'visible') return;
            const ps = pr && pr.playabilityStatus && pr.playabilityStatus.status;
            if (ps && ps !== 'OK') return;                      // age/members/unavailable: not a format issue
            if (errSeen(p) || (waited >= 8000 && stuck(p))) onError(v);
        } catch (e) {}
    }, 1000);

    // embedded players (videos on other websites): starting quality only — never reloads
    if (!IS_TOP) {
        let embDone = null;
        setInterval(function () {
            try {
                const v = curVid();
                if (!v || !isPlaying(v) || embDone === v) return;
                const pr = playerResp(v);
                const info = pr ? (isLiveVD(pr.videoDetails) ? fullInfo(pr) : learn(pr)) : null;
                if (enforceRes(v, playerEl(), info)) embDone = v;
            } catch (e) {}
        }, 1000);
    }

    // ================================================================
    // THUMBNAILS & IMAGES
    // ================================================================
    const SHORTS_CTX = 'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer, ytd-reel-video-renderer, ytd-rich-item-renderer[is-shorts], [is-shorts], ytd-shorts, a[href^="/shorts/"]';
    function inShortsCtx(el) { try { return !!(el && el.closest && el.closest(SHORTS_CTX)); } catch (e) { return false; } }
    function isTall(el) { return inShortsCtx(el) || !!(el && el.hasAttribute && el.hasAttribute('data-ld-tall')); }
    // The Shorts PLAYER's own picture (shown for a split second before the video starts) is left
    // as YouTube made it: it is sized for a tall screen, and a smaller (wide) copy showed up as a
    // small picture with black bars above and below.
    const SHORTS_PLAYER = 'ytd-reel-video-renderer, #shorts-player, ytd-shorts #player-container, yt-shorts-video-player';
    const ANY_PLAYER = '.html5-video-player, ytd-player, #player-container, .ytp-cued-thumbnail-overlay';
    function onShortsPage() { return /^\/shorts\//.test(location.pathname); }
    function shortsPlayerImg(el, tallName) {
        try {
            if (!el || !el.closest) return false;
            if (el.closest(SHORTS_PLAYER)) return true;
            if (!onShortsPage()) return false;
            if (el.closest(ANY_PLAYER)) return true;
            return !el.isConnected && tallName;                 // made by the Shorts player, not yet on the page
        } catch (e) { return false; }
    }
    const VI_RE = /^(?:https?:)?\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\/([A-Za-z0-9_]+)\.(?:jpg|webp)(?:\?.*)?$/;
    const AN_RE = /^(?:https?:)?\/\/i\d*\.ytimg\.com\/an_webp\/([A-Za-z0-9_-]{11})\//;
    const CH_RE = /^((?:https?:)?\/\/yt\d\.(?:ggpht|googleusercontent)\.com\/[^=?#]+)=([^?#]*)$/;
    // Real picture sizes YouTube makes: [visible height, file, crop 4:3 bars?].
    // Any typed number uses the largest real size at or below it (smallest if below all),
    // so every step down is a genuinely smaller download — never a blurred copy.
    const WIDE_STEPS = [[68, 'default', true], [180, 'mqdefault', false], [270, 'hqdefault', true], [360, 'sddefault', true]];
    const TALL_STEPS = [[90, 'default', true], [180, 'mqdefault', true], [360, 'hqdefault', true], [480, 'sddefault', true]];
    function pick(steps, n) {
        n = +n || 0;
        if (n <= 0 || n >= 720) return null;                   // original
        let c = steps[0];
        for (let i = 0; i < steps.length; i++) if (steps[i][0] <= n) c = steps[i];
        return [c[1], c[2]];
    }
    const RANK = { 'default': 1, mqdefault: 2, hqdefault: 3, sddefault: 4, hq720: 5, maxresdefault: 6 };
    function rankOf(n) { return RANK[n] || 5; }                               // oar*/frame* = full-size Shorts pictures
    const BIG_NAMES = /^(oar\d*|oardefault|frame\d|hq720|hqdefault|sddefault|maxresdefault|mqdefault|default)(_live)?(?:_\d+)?$/;

    // returns [url, crop?, tall?]
    function lower(u, el) {
        if (typeof u !== 'string' || u.length < 20) return [u, false, false];
        let m = u.match(VI_RE);
        if (m) {
            const id = m[1], name = m[2], base = 'https://i.ytimg.com/vi/' + id + '/';
            const tallName = /^(oar\d*|oardefault|frame\d)$/.test(name);
            if (shortsPlayerImg(el, tallName)) return [u, false, false];
            const tall = tallName || isTall(el);
            const choice = tall ? pick(TALL_STEPS, S.shortsThumbH) : pick(WIDE_STEPS, S.thumbH);
            if (!choice) return [u, false, tall];                           // original
            const alt = name.match(/^(?:hq|sd|maxres|mq)([1-3])$/);          // the 3 alternate frames
            if (alt) return [base + 'mq' + alt[1] + '.jpg', false, tall];
            const bm = name.match(BIG_NAMES);
            if (!bm) return [u, false, tall];
            if (rankOf(bm[1]) <= RANK[choice[0]]) return [u, false, tall];   // never switch to a BIGGER picture
            const liveSfx = (bm[2] && !tallName && choice[0] !== 'default' && choice[0] !== 'sddefault') ? '_live' : '';
            const out = base + choice[0] + liveSfx + '.jpg';
            return [out === u ? u : out, choice[1], tall];
        }
        if (S.stillHover) {
            m = u.match(AN_RE);
            if (m) {                                            // the tile's own still picture (already downloaded)
                const r = lower('https://i.ytimg.com/vi/' + m[1] + '/hq720.jpg', el);
                return r[0].indexOf('/hq720.jpg') !== -1 ? ['https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg', true, false] : r;
            }
        }
        if (S.channelImages) {
            m = u.match(CH_RE);
            if (m) {
                let p = m[2];
                const s = p.match(/^s(\d+)/);
                if (s) {
                    const n = +s[1], cap = n <= 240 ? 88 : 480;
                    if (n > cap) p = 's' + cap + p.slice(s[0].length);
                } else {
                    const w = p.match(/^w(\d+)/);
                    if (w && +w[1] > 1060 && !/-h\d+/.test(p)) p = 'w1060' + p.slice(w[0].length);
                }
                if (p !== m[2]) return [m[1] + '=' + p, false, false];
            }
        }
        return [u, false, false];
    }
    const nativeSetAttr = Element.prototype.setAttribute;
    const nativeRemoveAttr = Element.prototype.removeAttribute;
    function mark(el, r) {
        try {
            if (!el || !el.hasAttribute) return;
            if (r[1]) { if (!el.hasAttribute('data-ld-crop')) nativeSetAttr.call(el, 'data-ld-crop', ''); }
            else if (el.hasAttribute('data-ld-crop')) nativeRemoveAttr.call(el, 'data-ld-crop');
            if (r[2] && !el.hasAttribute('data-ld-tall')) nativeSetAttr.call(el, 'data-ld-tall', '');
        } catch (e) {}
    }
    (function addCss() {
        try {
            const root = document.head || document.documentElement;
            if (!root) { setTimeout(addCss, 10); return; }
            root.appendChild(mk('style', null,
                'html[data-tw-nopreview] ytd-video-preview,html[data-tw-nopreview] #video-preview{display:none!important}' +
                'img[data-ld-crop]{object-fit:cover!important;object-position:50% 50%!important}' +
                '[data-ld-crop]:not(img){background-size:cover!important;background-position:50% 50%!important}'));
        } catch (e) {}
    })();
    try {
        const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            get: function () { return d.get.call(this); },
            set: function (v) { const r = lower(v, this); mark(this, r); keepOrig(this, v, r[0]); d.set.call(this, r[0]); },
            configurable: true, enumerable: d.enumerable
        });
    } catch (e) {}
    try {
        Element.prototype.setAttribute = function (name, value) {
            if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') {
                const r = lower(value, this); mark(this, r); keepOrig(this, value, r[0]); value = r[0];
            }
            return nativeSetAttr.call(this, name, value);
        };
    } catch (e) {}
    const ORIG_SRC = new WeakMap();
    function keepOrig(el, from, to) { try { if (from !== to) ORIG_SRC.set(el, [from, to]); else ORIG_SRC.delete(el); } catch (e) {} }
    function fixImg(img) {
        try {
            const s = img.getAttribute('src');
            if (!s) return;
            const o = ORIG_SRC.get(img);
            if (o && o[1] === s) {                                // we made it smaller before it was on the page
                const m = String(o[0]).match(VI_RE);
                if (m && shortsPlayerImg(img, /^(oar\d*|oardefault|frame\d)$/.test(m[2]))) {
                    ORIG_SRC.delete(img); if (img.hasAttribute('data-ld-crop')) nativeRemoveAttr.call(img, 'data-ld-crop');
                    nativeSetAttr.call(img, 'src', o[0]); return;
                }
            }
            const r = lower(s, img);
            mark(img, r);
            if (r[0] !== s) nativeSetAttr.call(img, 'src', r[0]);
        } catch (e) {}
    }
    function fixBg(el) {
        try {
            const st = el.getAttribute('style');
            if (!st || st.indexOf('ytimg.com') === -1) return;
            const m = (el.style.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
            if (!m) return;
            const r = lower(m[1], el);
            mark(el, r);
            if (r[0] !== m[1]) el.style.backgroundImage = 'url("' + r[0] + '")';
        } catch (e) {}
    }
    // sddefault doesn't exist for every video: YouTube then sends a tiny 120x90 grey picture -> use hqdefault
    document.addEventListener('load', function (e) {
        try {
            const img = e.target;
            if (!(img instanceof HTMLImageElement)) return;
            const s = img.getAttribute('src') || '';
            if (s.indexOf('/sddefault') !== -1 && img.naturalWidth === 120 && img.naturalHeight === 90) {
                nativeSetAttr.call(img, 'src', s.replace('/sddefault', '/hqdefault'));
            }
        } catch (err) {}
    }, true);
    try {
        new MutationObserver(function (muts) {
            for (let i = 0; i < muts.length; i++) {
                const mu = muts[i], t = mu.target;
                if (mu.type === 'attributes') {
                    if (mu.attributeName === 'src') { if (t.tagName === 'IMG') fixImg(t); } else fixBg(t);
                    continue;
                }
                const added = mu.addedNodes;
                for (let j = 0; j < added.length; j++) {
                    const n = added[j];
                    if (n.nodeType !== 1) continue;
                    if (n.tagName === 'IMG') fixImg(n);
                    else if (n.querySelectorAll) {
                        n.querySelectorAll('img[src*="ytimg.com"], img[src*="ggpht.com"], img[src*="googleusercontent.com"]').forEach(fixImg);
                        n.querySelectorAll('[style*="ytimg.com"]').forEach(fixBg);
                    }
                }
            }
        }).observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });
    } catch (e) {}

    // ================================================================
    // HOVER-PREVIEW VIDEOS
    // ================================================================
    const PQ = [[144, 'tiny'], [240, 'small'], [360, 'medium'], [480, 'large'], [720, 'hd720'], [1080, 'hd1080'], [1440, 'hd1440'], [2160, 'hd2160']];
    function previewQ() {
        const n = +S.previewH || 0;
        if (n <= 0) return null;
        let q = PQ[0][1];
        for (let i = 0; i < PQ.length; i++) if (PQ[i][0] <= n) q = PQ[i][1];
        return q;
    }
    function previewsOff() { return +S.previewH === -1; }
    // OFF: YouTube never gets the "mouse is resting on this thumbnail" signal, so the
    // preview video is never requested at all (and animated thumbnails don't start either).
    const PREVIEW_ZONE = 'ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail, ytd-playlist-thumbnail, ytd-rich-grid-media, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-moving-thumbnail-renderer';
    const PREVIEW_KEEP = 'button, [role="button"], ytd-menu-renderer, yt-icon-button, #menu, tp-yt-paper-tooltip';
    function hoverGuard(e) {
        if (!previewsOff()) return;
        try {
            const t = e.target;
            if (!t || !t.closest || !t.closest(PREVIEW_ZONE) || t.closest(PREVIEW_KEEP)) return;
            e.stopImmediatePropagation();
        } catch (err) {}
    }
    ['mouseover', 'mouseenter', 'pointerover', 'pointerenter', 'mousemove', 'pointermove'].forEach(function (ev) {
        window.addEventListener(ev, hoverGuard, true);
    });
    function applyFlags() {
        try { document.documentElement.toggleAttribute('data-tw-nopreview', previewsOff()); } catch (e) {}
    }
    applyFlags();
    function isPreview(p) {
        if (!p || p.id === 'shorts-player' || p.id === 'movie_player') return false;
        if (p.id === 'inline-preview-player') return true;
        return !!(p.closest && p.closest('ytd-video-preview, #video-preview, #inline-player, ytd-thumbnail, ytd-rich-grid-media, ytd-inline-player'));
    }
    function applyPreview(p) {
        const Q = previewQ();
        if (!Q) return;
        try { if (typeof p.getPlaybackQuality === 'function' && p.getPlaybackQuality() === Q) return; } catch (e) {}
        setQuality(p, Q);
    }
    function onMedia(e) {
        try {
            const v = e.target;
            if (!(v instanceof HTMLVideoElement)) return;
            const p = v.closest('.html5-video-player');
            if (!isPreview(p)) return;
            if (previewsOff()) {                                // safety net: stop it right away
                try { if (typeof p.stopVideo === 'function') p.stopVideo(); } catch (e2) {}
                try { v.pause(); } catch (e2) {}
                return;
            }
            applyPreview(p);
        } catch (err) {}
    }
    ['loadstart', 'loadedmetadata', 'playing', 'resize'].forEach(function (ev) { document.addEventListener(ev, onMedia, true); });
    setInterval(function () {
        try {
            if (!previewQ()) return;
            document.querySelectorAll('.html5-video-player').forEach(function (p) {
                if (!isPreview(p)) return;
                const v = p.querySelector('video');
                if (v && !v.paused) applyPreview(p);
            });
        } catch (e) {}
    }, 1000);

    try { if (S.profiles.video.codec1 === 'av1' && localStorage.getItem('yt-player-av1-pref') !== '8192') localStorage.setItem('yt-player-av1-pref', '8192'); } catch (e) {}

    // ================================================================
    // POPUP LINK: settings in; diagnostics + memory out (never to YouTube)
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
        if (rp || bufFor === v) {
            const pl = rp || statsOf(p);
            if (!pl.fam && bufFor === v) pl.fam = playedFam();
            out.playing = pl; out.state = 'playing';
            if (planObj && pl.p) out.target = targetAt(planObj, pl.p, pl.fps) || out.target;   // codec picked for THIS quality
        } else if (errorFor === v || (blockedFor === v && errSeen(p))) out.state = 'error';
        else out.state = 'loading';
        if (out.state !== 'playing' && errSeen(p)) out.state = 'error';
        return out;
    }
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
        if (m.kind === 'settings') { S = merge(m.settings); applyFlags(); return; }
        if (!IS_TOP) return;
        let data = null;
        if (m.kind === 'status') data = nowPlaying();
        else if (m.kind === 'setQuality') {                    // popup: switch the current video's quality now
            const v = curVid(), p = playerEl(), q = m.data && m.data.q;
            if (v && p && (q === 'auto' || Q2H[q])) { setQuality(p, q); resDoneFor = v; }
            data = nowPlaying();
        }
        else if (m.kind === 'softReload') {                    // popup: re-open THIS video in the player, same spot, no page refresh
            if (m.data && m.data.settings) { S = merge(m.data.settings); applyFlags(); }
            const v = curVid(), p = playerEl();
            let ok = false;
            if (v && p && typeof p.loadVideoById === 'function') {
                let t = 0;
                try { t = +p.getCurrentTime() || 0; } catch (e) {}
                bufFor = null; resDoneFor = null; checkedFor = null; blockedFor = null; errorFor = null; earlyFor = null;
                try {                                           // give the player back the full list, trimmed for the NEW choice
                    const pr = playerResp(v);
                    if (pr && pr.streamingData && ORIG.has(v)) { pr.streamingData.adaptiveFormats = ORIG.get(v).slice(); prune(pr); }
                } catch (e) {}
                earlyStart();                                   // quality set before it loads again
                softCheck = { v: v, at: Date.now() };
                try { p.loadVideoById({ videoId: v, startSeconds: Math.max(0, t - 0.3) }); ok = true; } catch (e) {}
            }
            data = { ok: ok };
        }
        else if (m.kind === 'resetMemory') {
            Object.keys(map).forEach(function (k) { delete map[k]; });
            save();
            data = { ok: true };
        }
        window.postMessage({ __ytld: 'toExt', id: m.id, data: data }, ORIGIN);
    });
})();
