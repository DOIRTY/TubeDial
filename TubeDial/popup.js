// TubeDial popup. In the real extension it talks to the open YouTube tab;
// opened anywhere else (e.g. a file preview) it runs a harmless demo.
(function () {
    'use strict';
    // ================= CONSTANTS =================
    const PROFILE = { codec1: 'av1', codec2: 'vp9', startRes: 0, maxFps: 60 };
    const KINDS = ['video', 'shorts', 'live', 'embed'];
    const KIND_NAME = { video: 'Video', shorts: 'Short', live: 'Live', embed: 'Embedded' };
    const KIND_PLURAL = { video: 'Videos', shorts: 'Shorts', live: 'Live', embed: 'Embedded' };
    const KIND_HINT = {
        video: 'Normal videos, including playlists, mixes, premiere replays and past live streams.',
        shorts: 'Shorts, while scrolling or opened directly.',
        live: 'Live streams and premieres. Codec and framerate settings only apply once the stream’s formats are known, so live streams never get format errors.',
        embed: 'YouTube videos embedded in other websites.'
    };
    const DEFAULTS = {
        profiles: { video: Object.assign({}, PROFILE), shorts: Object.assign({}, PROFILE), live: Object.assign({}, PROFILE, { codec1: 'auto' }), embed: Object.assign({}, PROFILE) },
        perVideo: {}, thumbH: 270, shortsThumbH: 360, previewH: 360,
        stillHover: false, channelImages: true, notices: true, autoReloadSec: 5
    };
    const PRESET_KEYS = ['profiles', 'thumbH', 'shortsThumbH', 'previewH', 'stillHover', 'channelImages'];
    const RES = [0, 144, 240, 360, 480, 720, 1080, 1440, 4320];   // 0 = YouTube decides, 4320 = best
    const AR = [0, 3, 5, 10, 15];
    const NAME = { av1: 'AV1', vp9: 'VP9', avc: 'H.264', auto: 'Auto' };
    const FAM = ['av1', 'vp9', 'avc'];
    // real picture sizes YouTube makes (approximate file sizes, for guidance)
    const WIDE = [{ h: 68, kb: 4, note: 'smallest YouTube has' }, { h: 180, kb: 15 }, { h: 270, kb: 30 }, { h: 360, kb: 55 }, { h: 0, kb: 100, note: 'what YouTube sends normally' }];
    const TALL = [{ h: 90, kb: 4, note: 'smallest YouTube has' }, { h: 180, kb: 15 }, { h: 360, kb: 30 }, { h: 480, kb: 55 }, { h: 0, kb: 90, note: 'what YouTube sends normally' }];
    const PREV = [-1, 144, 240, 360, 480, 720, 1080, 0];
    const PREV_REAL = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    const ACCENTS = [
        ['green', 'Mint', '#2bd576', '#9be86b'], ['blue', 'Sky', '#3ea6ff', '#86d0ff'], ['violet', 'Violet', '#a78bfa', '#f0abfc'],
        ['teal', 'Teal', '#2dd4bf', '#7dd3fc'], ['orange', 'Amber', '#ffa53a', '#ffd86b'], ['pink', 'Rose', '#ff6fae', '#ffb86b'], ['red', 'Ruby', '#ff5a52', '#ffa05a']
    ];
    const TABS = ['now', 'video', 'images', 'dash'];

    const EXT = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.tabs);
    const $ = function (id) { return document.getElementById(id); };
    const raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
    const now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
    let REDUCED = false;
    try { REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function resLabel(r) { return !r ? 'YouTube decides' : r > 2160 ? 'best' : r === 2160 ? '4K' : r + 'p'; }
    function retrigger(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
    function setRich(el, html) {                   // only <b>…</b> markup, built safely (no innerHTML)
        clear(el);
        html.split(/(<b>.*?<\/b>)/).forEach(function (part) {
            if (!part) return;
            const m = part.match(/^<b>(.*)<\/b>$/);
            el.appendChild(m ? mk('b', null, m[1]) : document.createTextNode(part));
        });
    }
    function setText(el, text) {                   // animates only when the text really changes
        if (!el || el.textContent === text) return false;
        el.textContent = text; retrigger(el, 'pop'); return true;
    }

    // ================= STATE =================
    let S = clone(DEFAULTS);
    let UI = { theme: 'system', accent: 'green' };
    let tabId = null, vid = null, lastSt = null, memory = {}, editKind = 'video', kindPicked = false, dev = null, curTab = 'now';
    let lastChange = null;                          // { before, title }
    const pendingFlash = { video: new Set(), images: new Set() };
    let copySel = null;
    function P() { return S.profiles[editKind]; }
    function store(patch) { Object.assign(S, patch); if (EXT) chrome.storage.local.set(patch); }
    function setProf(patch, kind) {
        const pr = clone(S.profiles);
        Object.assign(pr[kind || editKind], patch);
        store({ profiles: pr });
    }
    function needReload() { if (vid) $('apply').classList.add('show'); }

    // ================= SMALL ANIMATED CONTROLS =================
    function pill(seg) {
        const b = seg.querySelector('button.on');
        if (!b || !b.offsetWidth) { seg.classList.remove('has-on'); return; }
        seg.style.setProperty('--px', b.offsetLeft + 'px');
        seg.style.setProperty('--pw', b.offsetWidth + 'px');
        seg.classList.add('has-on');
    }
    function refreshPills(root) {                   // after something became visible: place pills without sliding in from 0
        (root || document).querySelectorAll('.seg').forEach(function (s) { s.classList.remove('ready'); pill(s); });
        raf(function () { raf(function () { (root || document).querySelectorAll('.seg').forEach(function (s) { s.classList.add('ready'); }); }); });
    }
    function segSet(el, value, attr) {
        attr = attr || 'v';
        el.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset[attr] === String(value)); });
        pill(el);
    }
    function paintRange(el) {
        const p = (el.value - el.min) / (el.max - el.min) * 100;
        el.style.setProperty('--p', (isFinite(p) ? p : 0) + '%');
    }
    function setRange(el, idx, anim) {
        if (el._anim) { el._anim.stop = true; el._anim = null; el.step = '1'; }
        const from = +el.value, to = +idx;
        if (!anim || REDUCED || from === to || el.offsetParent === null) { el.value = to; paintRange(el); return; }
        const a = { stop: false }, t0 = now(), D = 420;
        el._anim = a; el.step = 'any';
        (function f() {
            if (a.stop) return;
            const k = Math.min(1, (now() - t0) / D), e = 1 - Math.pow(1 - k, 3);
            el.value = from + (to - from) * e; paintRange(el);
            if (k < 1) raf(f); else { el.step = '1'; el.value = to; paintRange(el); el._anim = null; }
        })();
    }
    let toastT = 0;
    function toast(msg) {
        const t = $('toast'); t.textContent = msg; t.classList.add('show');
        clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 1900);
    }
    function flashEl(id) { const el = $(id); if (el) retrigger(el, 'flash'); }

    // ================= APPEARANCE =================
    function sysLight() { try { return matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { return false; } }
    function applyUi() {
        const r = document.documentElement;
        r.setAttribute('data-theme', UI.theme === 'system' ? (sysLight() ? 'light' : 'dark') : UI.theme);
        r.setAttribute('data-accent', UI.accent);
        try { localStorage.setItem('tdUi', JSON.stringify(UI)); } catch (e) {}
        segSet($('theme'), UI.theme);
        $('accents').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.a === UI.accent); });
        const a = ACCENTS.filter(function (x) { return x[0] === UI.accent; })[0];
        $('accentName').textContent = a ? a[1] : '';
    }
    function saveUi(patch) { Object.assign(UI, patch); applyUi(); if (EXT) chrome.storage.local.set({ ui: UI }); }
    (function buildAccents() {
        const box = $('accents');
        ACCENTS.forEach(function (a) {
            const b = mk('button'); b.dataset.a = a[0]; b.title = a[1];
            b.style.setProperty('--c1', a[2]); b.style.setProperty('--c2', a[3]);
            box.appendChild(b);
        });
    })();
    try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (UI.theme === 'system') applyUi(); }); } catch (e) {}

    // ================= SETTINGS MIGRATION =================
    function migrate(s) {
        s = s || {};
        const o = Object.assign({}, DEFAULTS, s), patch = {};
        delete o.ytldMemory;
        if (s.perVideoFps && typeof s.perVideoFps === 'object') {
            const pv = Object.assign({}, o.perVideo || {});
            Object.keys(s.perVideoFps).forEach(function (k) { if (!pv[k]) pv[k] = { fps: s.perVideoFps[k] }; });
            o.perVideo = pv; patch.perVideo = pv;
        }
        let pr = s.profiles && typeof s.profiles === 'object' ? s.profiles : null;
        if (!pr && (s.codec1 || s.maxRes || s.maxFps || s.av1 === false)) {
            const b = { codec1: s.codec1 || (s.av1 === false ? 'auto' : 'av1'), codec2: s.codec2 || 'vp9', maxRes: +s.maxRes || 0, maxFps: +s.maxFps || 60 };
            pr = { video: b, shorts: b, embed: b, live: Object.assign({}, b, { codec1: 'auto' }) };
            patch.profiles = true;
        }
        o.profiles = {};
        let strip = false;
        KINDS.forEach(function (k) {
            const q = Object.assign({}, DEFAULTS.profiles[k], (pr && pr[k]) || {});
            if (q.resMode === 'start') q.maxRes = 0;
            if ('maxRes' in q) { if (!(pr && pr[k] && pr[k].startRes !== undefined)) q.startRes = +q.maxRes || 0; delete q.maxRes; strip = true; }   // old limit -> starting quality
            if ('highest' in q || 'resMode' in q) { delete q.highest; delete q.resMode; strip = true; }
            o.profiles[k] = q;
        });
        if (patch.profiles || strip) patch.profiles = o.profiles;
        if (s.thumbH === undefined && s.thumbQuality) patch.thumbH = o.thumbH = ({ '70p': 68, '180p': 180, '270p': 270, '360p': 360, 'original': 0 })[s.thumbQuality] ?? DEFAULTS.thumbH;
        if (s.shortsThumbH === undefined && s.shortsThumbQuality) patch.shortsThumbH = o.shortsThumbH = ({ '90p': 90, '180p': 180, '360p': 360, '480p': 480, 'original': 0 })[s.shortsThumbQuality] ?? DEFAULTS.shortsThumbH;
        if (s.previewH === undefined && s.previewQuality) patch.previewH = o.previewH = ({ '144p': 144, '240p': 240, '360p': 360, '480p': 480, '720p': 720, 'off': 0 })[s.previewQuality] ?? DEFAULTS.previewH;
        if (EXT && Object.keys(patch).length) {
            chrome.storage.local.set(patch);
            chrome.storage.local.remove(['perVideoFps', 'av1', 'codec1', 'codec2', 'maxRes', 'maxFps', 'thumbQuality', 'shortsThumbQuality', 'previewQuality']);
        }
        return o;
    }
    function vidFromUrl(u) {
        const m = (u || '').match(/^https:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/.*?(?:[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }
    function isYT(u) { return /^https:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\//.test(u || ''); }

    // ================= DEVICE CHECK (local, via the browser's own decoder info) =================
    const PROBES = { av1: 'video/mp4; codecs="av01.0.08M.08"', vp9: 'video/webm; codecs="vp09.00.40.08"', avc: 'video/mp4; codecs="avc1.640028"' };
    function probeDevice(cb) {
        const mc = navigator.mediaCapabilities;
        if (!mc || !mc.decodingInfo) { cb(null); return; }
        const out = {}; let left = FAM.length;
        FAM.forEach(function (c) {
            mc.decodingInfo({ type: 'media-source', video: { contentType: PROBES[c], width: 1920, height: 1080, bitrate: 4000000, framerate: 30 } })
                .then(function (r) { out[c] = r; }, function () { out[c] = null; })
                .then(function () { if (--left === 0) cb(out); });
        });
    }
    // Smart / Best quality: avoid codecs this device can only decode in software at 1080p.
    // Data saver / Max savings (480p and below): AV1 software decoding is light, so AV1 whenever it's supported.
    function smartOrder(lowRes) {
        if (!dev) return ['av1', 'vp9'];
        const sup = function (c) { return !dev[c] || dev[c].supported; };
        const hw = function (c) { return dev[c] && dev[c].supported && dev[c].powerEfficient; };
        if (lowRes) return sup('av1') ? ['av1', 'vp9'] : ['vp9', 'avc'];
        if (hw('av1')) return ['av1', 'vp9'];
        return ['vp9', 'avc'];
    }
    function renderDevice() {
        const box = $('devRows'); clear(box);
        FAM.forEach(function (c, i) {
            const r = mk('div', 'drow');
            r.style.animation = 'slideIn .4s ' + (i * 0.06) + 's both';
            r.appendChild(mk('span', 'cn', NAME[c]));
            const d = dev && dev[c];
            let cls = 'unk', t = 'Checking…';
            if (dev === false || (dev && !d)) { cls = 'unk'; t = 'Can’t check in this view'; }
            else if (d && !d.supported) { cls = 'bad'; t = '✗ Not supported'; }
            else if (d && d.powerEfficient) { cls = 'hw'; t = '✓ Hardware — smooth, battery-friendly'; }
            else if (d && d.smooth) { cls = 'sw'; t = '● Software — smooth, uses more battery'; }
            else if (d) { cls = 'bad'; t = '▲ Software — may stutter'; }
            r.appendChild(mk('span', cls, t));
            box.appendChild(r);
        });
    }

    // ================= PRESETS =================
    const PRESETS = [
        { id: 'smart', name: 'Smart', icon: '✦', needle: 30, desc: 'Same quality, less data. Best codec for your device.' },
        { id: 'saver', name: 'Data saver', icon: '◐', needle: -35, desc: 'New videos start at 480p · light thumbnails.' },
        { id: 'extreme', name: 'Max savings', icon: '▼', needle: -70, desc: 'New videos start at 144p · no hover videos · tiny thumbnails.' },
        { id: 'quality', name: 'Best quality', icon: '◆', needle: 70, desc: 'New videos start at their best · full-size images.' },
        { id: 'smooth', name: 'Smooth', icon: '≈', needle: 0, desc: 'Easiest to play: H.264, 30fps. For older or slower computers.', wide: true }
    ];
    function presetValues(id) {
        const o = smartOrder(false), lo = smartOrder(true);
        const prof = function (c1, c2, res, fps) { return { codec1: c1, codec2: c2, startRes: res, maxFps: fps }; };
        const all = function (p, liveCodec) { return { video: p, shorts: Object.assign({}, p), embed: Object.assign({}, p), live: Object.assign({}, p, { codec1: liveCodec || 'auto' }) }; };
        switch (id) {
            case 'smart': return { profiles: all(prof(o[0], o[1], 0, 60)), thumbH: 270, shortsThumbH: 360, previewH: 360, stillHover: false, channelImages: true };
            case 'saver': return { profiles: all(prof(lo[0], lo[1], 480, 60)), thumbH: 180, shortsThumbH: 180, previewH: 144, stillHover: true, channelImages: true };
            case 'extreme': return { profiles: all(prof(lo[0], lo[1], 144, 60)), thumbH: 68, shortsThumbH: 90, previewH: -1, stillHover: true, channelImages: true };
            case 'quality': return { profiles: all(prof(o[0], o[1], 4320, 60)), thumbH: 0, shortsThumbH: 0, previewH: 0, stillHover: false, channelImages: false };
            case 'smooth': return { profiles: all(prof('avc', 'vp9', 0, 30), 'avc'), thumbH: 270, shortsThumbH: 360, previewH: 360, stillHover: false, channelImages: true };
        }
        return null;
    }
    function resText(p) { const r = +p.startRes; return r ? 'Starts at ' + resLabel(r) : 'YouTube decides'; }
    function profEq(a, b) {
        return a.codec1 === b.codec1 && (a.codec1 === 'auto' || a.codec2 === b.codec2) && +a.startRes === +b.startRes && +a.maxFps === +b.maxFps;
    }
    function sameAs(v) {
        const keys = ['thumbH', 'shortsThumbH', 'previewH', 'stillHover', 'channelImages'];
        for (let i = 0; i < keys.length; i++) if (S[keys[i]] !== v[keys[i]]) return false;
        for (let i = 0; i < KINDS.length; i++) if (!profEq(S.profiles[KINDS[i]], v.profiles[KINDS[i]])) return false;
        return true;
    }
    function activePreset() { for (let i = 0; i < PRESETS.length; i++) if (sameAs(presetValues(PRESETS[i].id))) return PRESETS[i]; return null; }
    function buildPresets() {
        [['presets', false], ['presetsMini', true]].forEach(function (x) {
            const box = $(x[0]); clear(box);
            PRESETS.forEach(function (p) {
                const b = mk('button', p.wide && !x[1] ? 'wide' : '');
                b.dataset.p = p.id; b.title = p.desc;
                b.appendChild(mk('i', null, p.icon));
                b.appendChild(mk('b', null, p.name));
                b.appendChild(mk('span', null, p.desc));
                box.appendChild(b);
            });
            box.addEventListener('click', function (e) {
                const b = e.target.closest('button'); if (!b) return;
                const r = b.getBoundingClientRect();
                b.style.setProperty('--rx', (e.clientX - r.left) + 'px'); b.style.setProperty('--ry', (e.clientY - r.top) + 'px');
                retrigger(b, 'ripple'); setTimeout(function () { b.classList.remove('ripple'); }, 650);
                const p = PRESETS.filter(function (q) { return q.id === b.dataset.p; })[0];
                applyChange(presetValues(p.id), 'Switched to ' + p.name);
            });
        });
    }
    function renderPresets() {
        const a = activePreset();
        ['presets', 'presetsMini'].forEach(function (id) {
            $(id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', !!a && b.dataset.p === a.id); });
        });
        const o = smartOrder(false), lo = smartOrder(true);
        $('presetHint').textContent = (a ? 'Using “' + a.name + '”. ' : 'Custom settings. ') + 'For your device: Smart and Best quality use ' + NAME[o[0]] + ' then ' + NAME[o[1]] +
            (lo[0] !== o[0] ? '; the data-saving presets use ' + NAME[lo[0]] + ' then ' + NAME[lo[1]] + ' (light to play at low resolutions)' : '') + '.';
        setText($('presetNow'), a ? a.name : 'Custom');
        // the logo's dial needle points at how "heavy" the current setup is
        let deg;
        if (a) deg = a.needle;
        else {
            const v = S.profiles.video, map = { 144: -70, 240: -55, 360: -45, 480: -35, 720: -10, 1080: 10, 1440: 30, 4320: 60, 0: 30 };
            deg = map[+v.startRes] ?? 0;
        }
        document.documentElement.style.setProperty('--needle', deg + 'deg');
    }

    // ================= WHAT CHANGED (diff + effects + undo) =================
    const PF = [['codec1', '1st codec', 'cardCodec'], ['codec2', '2nd codec', 'cardCodec'], ['startRes', 'Starting quality', 'cardRes'], ['maxFps', 'Framerate limit', 'cardFps']];
    function fmtProf(f, v) {
        if (f === 'codec1' || f === 'codec2') return NAME[v] || v;
        if (f === 'startRes') return +v ? 'Starts at ' + resLabel(+v) : 'YouTube decides';
        if (f === 'maxFps') return +v >= 60 ? 'Any' : 'Up to ' + v + ' fps';
        return String(v);
    }
    function effProf(f, a, b) {
        if (f === 'startRes') { if (!+b) return ['YouTube’s own quality setting picks', false]; const A = +a || 99999, B = +b; return B < A ? ['New videos start lighter, less data', false] : ['New videos start sharper, more data', true]; }
        if (f === 'maxFps') return +b < +a ? ['Hides 60fps versions: less data and CPU', false] : ['Smoother motion on 60fps videos, more data', true];
        if (f === 'codec1') return b === 'av1' ? ['Smallest files for the same picture', false] : b === 'avc' ? ['Easiest to decode, uses more data', true] : b === 'vp9' ? ['Efficient and widely hardware-decoded', false] : ['YouTube chooses the codec', false];
        return null;
    }
    function realOf(steps, n) {
        n = +n || 0;
        if (n <= 0 || n >= 720) return steps[steps.length - 1];
        let r = steps[0];
        for (let i = 0; i < steps.length - 1; i++) if (steps[i].h <= n) r = steps[i];
        return r;
    }
    function imgLabel(steps, n) { const r = realOf(steps, n); return r.h ? r.h + 'p' : 'Original'; }
    function prevLabel(v) {
        v = +v;
        if (v === -1) return 'Off';
        if (v === 0) return 'YouTube default';
        let real = PREV_REAL[0]; PREV_REAL.forEach(function (r) { if (r <= v) real = r; });
        return real + 'p';
    }
    function kbEff(steps, a, b) {
        const A = realOf(steps, a).kb, B = realOf(steps, b).kb;
        if (A === B) return null;
        const pct = Math.round((B - A) / A * 100);
        return ['≈' + A + ' → ' + B + ' KB per picture (' + (pct > 0 ? '+' : '−') + Math.abs(pct) + '%)', pct > 0];
    }
    function diff(before, after) {
        const out = [], groups = {};
        KINDS.forEach(function (k) {
            const A = before.profiles[k], B = after.profiles[k];
            PF.forEach(function (f) {
                const key = f[0];
                if (key === 'codec2' && (A.codec1 === 'auto' && B.codec1 === 'auto')) return;
                const va = String(A[key]), vb = String(B[key]);
                if (va === vb) return;
                const g = key + '|' + va + '|' + vb;
                if (!groups[g]) { groups[g] = { tab: 'video', card: f[2], name: f[1], from: fmtProf(key, A[key]), to: fmtProf(key, B[key]), eff: effProf(key, A[key], B[key]), kinds: [] }; out.push(groups[g]); }
                groups[g].kinds.push(k);
            });
        });
        out.forEach(function (d) { d.meta = d.kinds.length === 4 ? 'All types' : d.kinds.map(function (k) { return KIND_PLURAL[k]; }).join(' · '); });
        const img = function (key, name, card, from, to, eff) { if (from !== to || eff) out.push({ tab: 'images', card: card, name: name, from: from, to: to, eff: eff, meta: '' }); };
        if (before.thumbH !== after.thumbH) img('thumbH', 'Video thumbnails', 'cardThumb', imgLabel(WIDE, before.thumbH), imgLabel(WIDE, after.thumbH), kbEff(WIDE, before.thumbH, after.thumbH));
        if (before.shortsThumbH !== after.shortsThumbH) img('shortsThumbH', 'Shorts thumbnails', 'cardSthumb', imgLabel(TALL, before.shortsThumbH), imgLabel(TALL, after.shortsThumbH), kbEff(TALL, before.shortsThumbH, after.shortsThumbH));
        if (before.previewH !== after.previewH) {
            const a = +before.previewH, b = +after.previewH;
            const eff = b === -1 ? ['Preview videos are never downloaded', false] : a === -1 ? ['Preview videos download again', true]
                : b === 0 ? ['YouTube picks the preview quality', true] : a === 0 || b < a ? (a === 0 ? ['Previews at a fixed quality', false] : ['Lighter preview videos', false]) : ['Sharper preview videos, more data', true];
            img('previewH', 'Hover previews', 'cardPrev', prevLabel(a), prevLabel(b), eff);
        }
        if (!!before.stillHover !== !!after.stillHover) img('stillHover', 'Still hover thumbnails', 'rowStill', before.stillHover ? 'On' : 'Off', after.stillHover ? 'On' : 'Off',
            after.stillHover ? ['Moving thumbnails are never downloaded', false] : ['Moving thumbnails download again', true]);
        if (!!before.channelImages !== !!after.channelImages) img('channelImages', 'Smaller channel pictures', 'rowChan', before.channelImages ? 'On' : 'Off', after.channelImages ? 'On' : 'Off',
            after.channelImages ? ['Lighter avatars and banners', false] : ['Full-size avatars and banners', true]);
        return out;
    }
    function snapshot() { const o = {}; PRESET_KEYS.forEach(function (k) { o[k] = clone(S[k]); }); return o; }
    function applyChange(patch, title) {
        const before = snapshot();
        store(clone(patch));
        ['thumbC', 'sthumbC', 'prevC'].forEach(function (id) { $(id).value = ''; });
        const d = diff(before, S);
        lastChange = { before: before, title: title };
        renderSettings(true);
        renderChanges(title, d);
        scheduleFlash(d);
        if (d.length) needReload();
        document.querySelectorAll('.sub').forEach(function (e) { retrigger(e, 'flash'); });
    }
    function renderChanges(title, d) {
        ['chgNow', 'chgPlay'].forEach(function (id) {
            const box = $(id); clear(box);
            const wrap = mk('div'), c = mk('div', 'chg');
            const head = mk('div', 'chg-head');
            head.appendChild(mk('b', null, d.length ? title + ' — ' + d.length + ' change' + (d.length === 1 ? '' : 's') : title));
            if (d.length) { const u = mk('button', 'btn sm', 'Undo'); u.dataset.act = 'undo'; head.appendChild(u); }
            const x = mk('button', 'x', '×'); x.dataset.act = 'close'; x.title = 'Hide'; head.appendChild(x);
            c.appendChild(head);
            if (!d.length) c.appendChild(mk('div', 'none', 'Already using these settings, so nothing changed.'));
            else {
                const ul = mk('ul');
                d.forEach(function (it, i) {
                    const li = mk('li'); li.style.animationDelay = (0.05 * i + 0.1) + 's';
                    const k = mk('span', 'k', it.name); if (it.meta) k.appendChild(mk('small', null, it.meta));
                    const ft = mk('span', 'ft');
                    ft.appendChild(mk('span', 'from', it.from)); ft.appendChild(mk('span', 'arr', '→')); ft.appendChild(mk('span', 'to', it.to));
                    li.appendChild(k); li.appendChild(ft);
                    if (it.eff) li.appendChild(mk('span', 'eff' + (it.eff[1] ? ' up' : ''), (it.eff[1] ? '▲ ' : '▼ ') + it.eff[0]));
                    ul.appendChild(li);
                });
                c.appendChild(ul);
            }
            wrap.appendChild(c); box.appendChild(wrap);
            raf(function () { box.classList.add('open'); });
        });
    }
    function hideChanges() { ['chgNow', 'chgPlay'].forEach(function (id) { $(id).classList.remove('open'); }); lastChange = null; }
    function onChangesClick(e) {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.act === 'close') hideChanges();
        if (b.dataset.act === 'undo' && lastChange) {
            const before = lastChange.before, cur = snapshot();
            store(before);
            const d = diff(cur, S);
            renderSettings(true); scheduleFlash(d); hideChanges();
            toast('Undone — previous settings restored');
            if (d.length) needReload();
        }
    }
    function scheduleFlash(d) {
        d.forEach(function (it) {
            if (it.tab === 'video' && it.kinds && it.kinds.indexOf(editKind) === -1) return;
            pendingFlash[it.tab].add(it.card);
        });
        ['video', 'images'].forEach(function (t) {
            if (!pendingFlash[t].size) return;
            if (curTab === t) runFlash(t);
            else document.querySelector('#tabs [data-tab="' + t + '"]').classList.add('badge');
        });
    }
    function runFlash(t) {
        const ids = Array.from(pendingFlash[t]); pendingFlash[t].clear();
        document.querySelector('#tabs [data-tab="' + t + '"]').classList.remove('badge');
        ids.forEach(function (id, i) { setTimeout(function () { flashEl(id); }, 120 + i * 70); });
    }
    function manualEdit() { if (lastChange) hideChanges(); }

    // ================= IMAGES (real sizes + custom numbers) =================
    function realIndex(steps, n) { return steps.indexOf(realOf(steps, n)); }
    function imgInfo(steps, n, what) {
        const st = realOf(steps, n);
        const real = st.h ? st.h + 'p' : 'original size';
        const typed = +n > 0 && +n < 720 && steps.every(function (x) { return x.h !== +n; });
        const below = +n < steps[0].h;
        let t = !typed ? 'Uses ' : below ? 'YouTube doesn’t make pictures as small as ' + n + 'p, so its smallest real size is used: '
            : 'YouTube doesn’t make ' + n + 'p pictures, so the largest real size under it is used: ';
        t += real + ' ' + what + ' · ≈' + st.kb + ' KB each';
        if (st.note) t += ' (' + st.note + ')';
        return t;
    }
    function setInfo(el, text) { if (el.textContent !== text) { el.textContent = text; retrigger(el, 'pop'); } }
    function renderImages(anim) {
        setRange($('thumb'), realIndex(WIDE, S.thumbH), anim);
        setText($('thumbVal'), imgLabel(WIDE, S.thumbH));
        setInfo($('thumbI'), imgInfo(WIDE, S.thumbH, 'pictures'));
        setRange($('sthumb'), realIndex(TALL, S.shortsThumbH), anim);
        setText($('sthumbVal'), imgLabel(TALL, S.shortsThumbH));
        setInfo($('sthumbI'), imgInfo(TALL, S.shortsThumbH, 'tall pictures'));
        const pv = +S.previewH;
        let pi = PREV.indexOf(pv), real = null;
        if (pv > 0) { real = PREV_REAL[0]; PREV_REAL.forEach(function (r) { if (r <= pv) real = r; }); }
        if (pi < 0) { pi = PREV.indexOf(real); if (pi < 0) pi = PREV.length - 2; }
        setRange($('prev'), pi, anim);
        setText($('prevVal'), prevLabel(pv));
        setInfo($('prevI'), pv === -1 ? 'Off: preview videos are never downloaded. Resting the mouse on a thumbnail costs no data.'
            : pv === 0 ? 'Previews play in whatever quality YouTube picks.'
            : (PREV_REAL.indexOf(pv) === -1 ? (pv < 144 ? 'YouTube has no video below 144p, so 144p is used. ' : 'YouTube has no ' + pv + 'p video, so the largest real quality under it is used: ' + real + 'p. ') : 'Previews play at ' + real + 'p. ') + (pv === 144 ? '144p is the lowest video quality YouTube has.' : ''));
        $('still').checked = !!S.stillHover; $('chan').checked = !!S.channelImages;
    }

    // kind of the video open in the tab (video / shorts / live / embed)
    function setupKind() { return lastSt && lastSt.vid ? (lastSt.live ? 'live' : (lastSt.kind || 'video')) : 'video'; }

    // ================= COPY TO OTHER TYPES =================
    function diffNames(a, b) {
        const n = [];
        if (a.codec1 !== b.codec1 || (a.codec1 !== 'auto' && a.codec2 !== b.codec2)) n.push('codec');
        if (+a.startRes !== +b.startRes) n.push('starting quality');
        if (+a.maxFps !== +b.maxFps) n.push('fps');
        return n;
    }
    function renderCopy(popChanged) {
        const src = P(), others = KINDS.filter(function (k) { return k !== editKind; });
        if (!copySel || copySel.src !== editKind) {
            copySel = { src: editKind, set: new Set(others) };     // all other types selected; click one to leave it out
        }
        $('copyTitle').textContent = 'Copy ' + KIND_PLURAL[editKind] + ' settings to…';
        const box = $('copyTargets');
        if (box.dataset.src !== editKind) {
            clear(box); box.dataset.src = editKind;
            others.forEach(function (k) {
                const b = mk('button'); b.dataset.k = k;
                b.appendChild(mk('b', null, KIND_PLURAL[k])); b.appendChild(mk('small'));
                box.appendChild(b);
            });
        }
        let n = 0;
        box.querySelectorAll('button').forEach(function (b) {
            const k = b.dataset.k, same = profEq(S.profiles[k], src), sm = b.querySelector('small');
            b.classList.toggle('sel', copySel.set.has(k));
            const txt = same ? '✓ Same' : 'Differs: ' + diffNames(S.profiles[k], src).join(', ');
            if (sm.textContent !== txt) { const had = !!sm.textContent; sm.textContent = txt; sm.className = same ? 'same' : 'diff'; if (had || popChanged) retrigger(sm, 'pop'); }
            if (!same && copySel.set.has(k)) n++;
        });
        const btn = $('copyBtn');
        if (btn.classList.contains('done')) return;
        btn.disabled = n === 0;
        btn.textContent = n ? 'Copy to ' + n + ' type' + (n === 1 ? '' : 's') : (copySel.set.size ? (copySel.set.size === others.length ? 'All types already match ✓' : 'Selected types already match ✓') : 'Select at least one type');
    }

    // ================= SETTINGS RENDER =================
    function renderSettings(anim) {
        const p = P();
        segSet($('kinds'), editKind, 'k');
        $('kindHint').textContent = KIND_HINT[editKind];
        segSet($('codec1'), p.codec1);
        $('c2wrap').classList.toggle('open', p.codec1 !== 'auto');
        $('codec2').querySelectorAll('button').forEach(function (b) { b.disabled = b.dataset.v === p.codec1; });
        segSet($('codec2'), p.codec2);
        let ri = RES.indexOf(+p.startRes || 0); if (ri < 0) ri = 0;
        setRange($('maxRes'), ri, anim);
        const R = RES[ri], rl = resLabel(R);
        setText($('resVal'), R ? 'Starts at ' + rl : 'YouTube decides');
        const mh = R ? '<b>Each new video loads straight at ' + rl + '.</b> No high-quality first seconds. All qualities stay in YouTube’s ⚙ menu — pick another one anytime and it stays for that video.' + (R < 4320 ? ' If a video doesn’t go that high, it starts at its best.' : '')
            : '<b>YouTube decides.</b> YouTube’s own quality setting picks, nothing is changed. Move the slider to choose what new videos start at.';
        const mhEl = $('resModeHint');
        if (mhEl.dataset.h !== mh) { mhEl.dataset.h = mh; setRich(mhEl, mh); retrigger(mhEl, 'pop'); }
        segSet($('maxFps'), +p.maxFps || 60);
        setText($('fpsVal'), +p.maxFps >= 60 ? 'Any' : 'Up to ' + p.maxFps + ' fps');
        $('notices').checked = !!S.notices;
        let ai = AR.indexOf(+S.autoReloadSec); if (ai < 0) ai = 2;
        setRange($('autoReload'), ai, false);
        setText($('arVal'), AR[ai] ? AR[ai] + ' seconds' : 'Never (button only)');
        $('autoReload').disabled = !S.notices;
        renderImages(anim);
        renderPresets();
        renderCopy(anim);
        if (lastSt) renderCtl(lastSt);
        const a = activePreset(), v = S.profiles.video;
        setText($('sub'), a ? a.name + ' mode' : 'Custom · ' + (v.codec1 === 'auto' ? 'Auto codec' : NAME[v.codec1] + ' first') + (+v.startRes ? ' · ' + resText(v).toLowerCase() : ''));
    }

    // ================= NOW TAB =================
    function perOf(v) { return (S.perVideo && S.perVideo[v]) || {}; }
    function setPer(key, val) {
        if (!vid) return;
        const all = Object.assign({}, S.perVideo || {});
        const cur = Object.assign({}, all[vid] || {});
        if (val === '' || val == null || val === 0) delete cur[key]; else cur[key] = val;
        delete all[vid];
        if (Object.keys(cur).length) all[vid] = cur;
        const keys = Object.keys(all);
        if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(function (k) { delete all[k]; });
        store({ perVideo: all });
        renderCtl(lastSt);
        needReload();
    }
    // ---- live controls: only what THIS video actually has ----
    const QH = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, highres: 4320 };
    const KIND_ALL = { video: 'videos', shorts: 'Shorts', live: 'live streams', embed: 'embedded videos' };
    let pendQ = null, pendAt = 0;
    function pLabel(p) { return p >= 4320 ? '8K' : p >= 2160 ? '4K' : p + 'p'; }
    function chipsSet(box, items, sig) {                // rebuild only when something changed (no flicker)
        if (box.dataset.sig === sig) return;
        const first = !box.dataset.sig;
        box.dataset.sig = sig; clear(box);
        if (!items.length) { box.appendChild(mk('span', 'none', 'Not known yet — start the video.')); return; }
        items.forEach(function (it, i) {
            const b = mk('button', it.cls || '');
            b.dataset.v = it.v;
            if (it.dis) b.disabled = true;
            if (it.title) b.title = it.title;
            b.appendChild(document.createTextNode(it.label));
            if (it.sub) b.appendChild(mk('small', null, it.sub));
            if (first) b.style.animation = 'slideIn .35s ' + (i * 0.035) + 's both';
            box.appendChild(b);
        });
    }
    function rowAt(st, p) { return (st.rows || []).filter(function (r) { return r.p === p; })[0] || null; }
    function maxPWhere(st, fn) { let m = 0; (st.rows || []).forEach(function (r) { if (fn(r) && r.p > m) m = r.p; }); return m; }
    function setPerObj(patch) {
        if (!vid) return;
        const all = Object.assign({}, S.perVideo || {});
        const cur = Object.assign({}, all[vid] || {});
        Object.keys(patch).forEach(function (k) { const v = patch[k]; if (v === '' || v == null || v === 0) delete cur[k]; else cur[k] = v; });
        delete all[vid];
        if (Object.keys(cur).length) all[vid] = cur;
        const keys = Object.keys(all);
        if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(function (k) { delete all[k]; });
        store({ perVideo: all });
        renderCtl(lastSt);
        softApply();
    }
    // apply a codec/framerate change to the video in place: the player re-opens it at the same spot
    // (about a second, no page refresh). Falls back to the Reload bar only if that isn't possible.
    let switching = 0;
    function softApply(msg) {
        if (!vid) return;
        if (!EXT) { toast(msg || 'Switching… (demo)'); return; }
        try {
            chrome.tabs.sendMessage(tabId, { kind: 'softReload', data: { settings: clone(S) } }, function (r) {
                if (chrome.runtime.lastError || !r || !r.ok) { needReload(); return; }
                $('apply').classList.remove('show');
                switching = now();
                toast(msg || 'Switching this video…');
                setTimeout(refresh, 700);
            });
        } catch (e) { needReload(); }
    }
    function qName(p) { return Object.keys(QH).filter(function (k) { return QH[k] === p; })[0] || null; }
    function fmtLabel(p, f) { return p + 'p' + (f > 30 ? f : ''); }
    // what is REALLY playing, from the player's own stats
    function renderTiles(st, pl) {
        const box = $('npTiles'), on = st.state === 'playing' && !!(pl.fam || pl.p);
        const lp = pl.p || QH[st.q] || 0;
        const T = [
            ['Codec', pl.fam ? NAME[pl.fam] : '—', pl.codec || (pl.fam ? '' : on ? 'reading…' : 'not playing')],
            ['Resolution', lp ? pLabel(lp) : '—', pl.w ? pl.w + '×' + pl.h : (on ? 'reading…' : 'not playing')],
            ['Framerate', pl.fps ? pl.fps + ' fps' : '—', pl.fps ? (pl.fps > 30 ? 'smooth motion' : 'standard') : (on ? 'reading…' : 'not playing')]
        ];
        box.classList.toggle('live', on);
        if (!box.children.length) T.forEach(function () {
            const t = mk('div', 'tile'); t.appendChild(mk('div', 'k')); t.appendChild(mk('div', 'v')); t.appendChild(mk('div', 's')); box.appendChild(t);
        });
        T.forEach(function (x, i) {
            const t = box.children[i], v = t.children[1];
            t.children[0].textContent = x[0];
            if (v.textContent !== x[1]) { const first = !v.textContent; v.textContent = x[1]; if (!first) retrigger(t, 'flash'); }
            t.children[2].textContent = x[2];
            t.title = x[0] + ': ' + x[1] + (x[2] ? ' (' + x[2] + ')' : '');
        });
    }
    // framerate for THIS video: only the rates it really has; each shows the best resolution you get with it
    function renderFps(st, pl, pv, prof, fmts) {
        const fl = []; fmts.forEach(function (f) { if (fl.indexOf(f.f) < 0) fl.push(f.f); });
        fl.sort(function (a, b) { return a - b; });
        const top = fl.length ? fl[fl.length - 1] : 0;
        const cap = +pv.fps || +prof.maxFps || 60;
        const within = fl.filter(function (f) { return f <= cap; });
        const want = within.length ? within[within.length - 1] : (fl[0] || 0);       // what this video will play in
        const items = fl.map(function (f) {
            const mp = Math.max.apply(null, fmts.filter(function (x) { return x.f <= f; }).map(function (x) { return x.p; }).concat([0]));
            const playing = pl.fps === f, pending = f === want && pl.fps && pl.fps !== f;
            return { v: String(f), label: f + ' fps', sub: pending ? 'switching…' : mp ? 'up to ' + pLabel(mp) : '',
                cls: (playing || (!pl.fps && f === want) ? 'on' : '') + (pending ? ' sel' : '') };
        });
        chipsSet($('fpsChips'), items, JSON.stringify(items));
        const h = [];
        if (fl.length === 1) h.push('This video only comes in ' + fl[0] + ' fps.');
        else if (fl.length > 1) {
            if (+pv.fps) h.push('Set for this video: ' + (+pv.fps >= top ? 'highest' : 'up to ' + pv.fps + ' fps') + '.');
            else if (+prof.maxFps < 60) h.push('Your framerate limit for ' + KIND_ALL[setupKind()] + ' is ' + prof.maxFps + ' fps.');
            h.push('Lower framerate = less data and CPU, but lower top resolution on some videos.');
        }
        setText($('fpsHint'), h.join(' '));
    }
    function renderCtl(st) {
        const card = $('ctlCard'), wasHidden = card.hidden;
        card.hidden = !(st && st.vid);
        if (card.hidden) return;
        const pv = perOf(st.vid), pl = st.playing || {}, kind = setupKind(), prof = S.profiles[kind] || PROFILE;
        if (pendQ && now() - pendAt > 2500) pendQ = null;
        const curQ = pendQ || st.q;
        const auto = pendQ ? pendQ === 'auto' : st.auto === true;
        const fmts = st.fmts || [];
        const levelQ = {}; (st.levels || []).forEach(function (l) { levelQ[l.q] = 1; });
        // facts: real numbers from this video's own format list
        const ps = fmts.map(function (f) { return f.p; }), fs = [];
        fmts.forEach(function (f) { if (fs.indexOf(f.f) < 0) fs.push(f.f); });
        fs.sort(function (a, b) { return a - b; });
        const facts = [];
        if (ps.length) facts.push(pLabel(Math.min.apply(null, ps)) + ' – ' + pLabel(Math.max.apply(null, ps)));
        if (fs.length) facts.push(fs.join(' & ') + ' fps');
        setText($('vidFacts'), fmts.length ? 'This video has ' + facts.join(' · ') : 'Reading this video’s formats…');
        renderTiles(st, pl);
        // Auto
        const pq = QH[st.q];
        const ai = [{ v: 'auto', label: 'Auto', sub: auto ? (pq ? 'now ' + pLabel(pq) : 'on') : 'YouTube picks', cls: (auto ? 'on' : '') + (pendQ === 'auto' ? ' busy' : '') }];
        chipsSet($('autoRow'), ai, JSON.stringify(ai));
        // one row per codec, with the qualities that REALLY exist in that codec
        const box = $('matrix'), rowsSig = [];
        const model = FAM.map(function (c) {
            const list = fmts.filter(function (f) { return f.c === c; }).sort(function (a, b) { return a.p - b.p || a.f - b.f; });
            const top = list.length ? list[list.length - 1] : null;
            const cells = list.map(function (f) {
                const playing = pl.fam === c && pl.p === f.p && (!pl.fps || pl.fps === f.f);
                const q = qName(f.p), instant = f.use && !!q;
                const chosen = pv.codec === c && +pv.res === f.p && !playing;
                const isOn = curQ && QH[curQ] && !auto ? (f.use && q === curQ) : playing;
                return { v: c + '|' + f.p + '|' + f.f, label: fmtLabel(f.p, f.f), sub: chosen ? 'switching…' : instant ? '' : '↻',
                    title: instant ? 'Switch now' : 'Switch this video to ' + NAME[c] + ' at ' + fmtLabel(f.p, f.f) + ' (in place, keeps your spot)',
                    cls: (isOn ? 'on' : '') + (chosen ? ' sel' : '') + (instant ? '' : ' rl') + (pendQ && pendQ === q && instant && !isOn ? ' busy' : '') };
            });
            const avail = st.avail ? st.avail[c] : null;
            rowsSig.push(c, avail, cells);
            return { c: c, cells: cells, top: top, avail: avail };
        });
        const sig = JSON.stringify(rowsSig);
        if (box.dataset.sig !== sig) {
            box.dataset.sig = sig; clear(box);
            model.forEach(function (m) {
                const r = mk('div', 'mrow' + (m.cells.length ? '' : ' off'));
                const h = mk('div', 'mc');
                h.appendChild(mk('b', null, (pl.fam === m.c ? '▶ ' : '') + NAME[m.c]));
                h.appendChild(mk('small', null, m.top ? 'up to ' + fmtLabel(m.top.p, m.top.f) : (m.avail === false || fmts.length ? 'none' : '?')));
                r.appendChild(h);
                const cb = mk('div', 'chips'); cb.dataset.c = m.c;
                if (m.cells.length) { cb.dataset.sig = ''; chipsSet(cb, m.cells, 'x'); }
                else cb.appendChild(mk('span', 'none', fmts.length || m.avail === false ? 'Not available for this video' : 'Not known yet'));
                r.appendChild(cb); box.appendChild(r);
            });
        }
        // "start every Short at 240p" — makes the chosen quality the starting quality for this type
        const sb = $('startBtn'), qp = !auto && QH[curQ];
        const topP = ps.length ? Math.max.apply(null, ps) : 0;
        if (qp) {
            sb.hidden = false;
            const same = +prof.startRes === qp || (+prof.startRes >= 4320 && qp === topP);
            sb.classList.toggle('done', same);
            sb.dataset.p = same ? '' : String(qp);
            setText(sb, same ? '✓ All ' + KIND_ALL[kind] + ' start at ' + pLabel(qp) : 'Start all ' + KIND_ALL[kind] + ' at ' + pLabel(qp) + ' →');
        } else sb.hidden = true;
        renderFps(st, pl, pv, prof, fmts);
        const h = ['Tap a quality to switch instantly. ↻ = another codec: the player re-opens this video in it at the same spot (about a second, no page refresh). A codec you pick is used for all of this video’s qualities.'];
        if (st.shorts) h.push('Shorts have no quality menu — this is it.');
        if (st.live) h.push('Live: codec changes apply once the stream’s formats are known.');
        setText($('ctlHint'), h.join(' '));
        $('pvReset').hidden = !(pv.codec || pv.fps || pv.res);
        if (wasHidden) refreshPills(card);
    }
    function qualityPick(q) {
        if (!q) return;
        pendQ = q; pendAt = now();
        if (lastSt) renderCtl(lastSt);
        if (!EXT) {                                        // demo
            setTimeout(function () { lastSt.q = q === 'auto' ? 'hd720' : q; lastSt.auto = q === 'auto'; const pp = QH[lastSt.q]; lastSt.playing = Object.assign({}, lastSt.playing, { p: pp, fps: pp >= 720 ? 60 : 30, fam: 'av1', w: Math.round(pp * 16 / 9), h: pp }); pendQ = null; showStatus(lastSt); }, 250);
            return;
        }
        try {
            chrome.tabs.sendMessage(tabId, { kind: 'setQuality', data: { q: q } }, function (st) {
                if (chrome.runtime.lastError || !st) return;
                if (st.q === q || (q === 'auto')) pendQ = null;
                showStatus(st);
            });
        } catch (e) {}
    }
    function banner(cls, title, text, btn) {
        const b = $('banner');
        const changed = $('bTitle').textContent !== title;
        b.className = 'banner ' + cls;
        $('bTitle').textContent = title;
        $('bText').textContent = text;
        $('bBtn').hidden = !btn;
        if (btn) $('bBtn').textContent = btn;
        if (changed) retrigger(b, 'swap');
    }
    function softNote(fam) {
        const d = dev && dev[fam];
        return d && d.supported && !d.powerEfficient ? ' Your device plays ' + NAME[fam] + ' in software. If it stutters, try the Smooth preset.' : '';
    }
    function showStatus(st) {
        lastSt = st;
        if (st && st.vid && st.vid !== vid) vid = st.vid;              // follows you while scrolling Shorts
        renderCtl(st);
        if (!st || !st.vid) {
            if (vid) banner('grey', 'Waiting for the video…', 'Loading information from the player.');
            else banner('grey', 'Not watching a video', 'Open a YouTube video or Short.');
            return;
        }
        const kc = $('kindChip');
        kc.hidden = !st.kind; kc.textContent = st.live ? 'LIVE' : (KIND_NAME[st.kind] || '');
        kc.className = 'chip kchip' + (st.live ? ' live' : '');
        if (!kindPicked && st.kind) { kindPicked = true; editKind = st.live ? 'live' : st.kind; renderSettings(false); }
        const pl = st.playing, fam0 = pl && pl.fam;
        const lv = (st.levels || []).filter(function (l) { return l.q === st.q; })[0];
        const qtxt = lv ? lv.label : (QH[st.q] ? pLabel(QH[st.q]) : (pl && pl.p ? pl.p + 'p' : ''));
        const fam = fam0, NQ = function (f) { return NAME[f] + (qtxt ? ' · ' + qtxt : ''); };
        const want = (st.per && st.per.codec) || st.preferred;
        let color = 'grey';
        if (st.state === 'error') {
            color = 'red';
            banner('red', 'Not working', 'The video failed to start' + (st.target ? ' in ' + NAME[st.target] : '') + '. Reloading fixes it, and it only happens once per video.', 'Reload');
        } else if (st.state !== 'playing' || !fam) {
            banner('grey', 'Starting…', 'Waiting for the video to start playing.');
        } else if (!want) {
            color = 'green';
            banner('green', 'Playing in ' + NQ(fam), 'Codec is set to Auto for this type (YouTube decides).' + softNote(fam));
        } else if (fam === st.target) {
            if (fam === want) {
                color = 'green';
                banner('green', 'Playing in ' + NQ(fam), (st.per && st.per.codec ? 'Your choice for this video.' : 'Your preferred codec.') + softNote(fam));
            } else {
                color = 'yellow';
                banner('yellow', 'Playing in ' + NQ(fam) + ' — best available', (st.avail && st.avail[want] === false ? 'This video has no ' + NAME[want] + ' version' : 'This video’s ' + NAME[want] + ' version doesn’t have the top quality (Best quality preset)') + ', so it plays in ' + NAME[fam] + '. Tap an ' + NAME[want] + ' quality below to use it anyway.');
            }
        } else if (st.target) {
            color = 'yellow';
            banner('yellow', 'Playing in ' + NQ(fam) + ' — not preferred', 'This video supports ' + NAME[st.target] + '. Reload to switch.', 'Reload');
        } else {
            color = 'yellow';
            banner('yellow', 'Playing in ' + NQ(fam), 'Not your preferred codec.');
        }
    }
    function refresh() {
        if (!EXT || tabId == null) return;
        try {
            chrome.tabs.sendMessage(tabId, { kind: 'status' }, function (st) {
                if (chrome.runtime.lastError) { showStatus(null); return; }
                showStatus(st);
            });
        } catch (e) {}
    }

    // ================= STATS =================
    function bar(parent, label, n, total, color, i) {
        const pct = total ? (n / total * 100) : 0;
        const b = mk('div', 'bar'), l = mk('div', 'bl');
        l.appendChild(mk('b', null, label));
        l.appendChild(mk('span', null, pct.toFixed(2) + '%  ·  ' + n + ' / ' + total));
        b.appendChild(l);
        const tr = mk('div', 'track'), f = mk('div', 'fill');
        f.style.background = color; f.style.transitionDelay = (i || 0) * 0.07 + 's';
        tr.appendChild(f); b.appendChild(tr); parent.appendChild(b);
        raf(function () { raf(function () { f.style.width = pct.toFixed(2) + '%'; }); });
    }
    function renderDash() {
        renderDevice();
        const vals = Object.keys(memory).map(function (k) { return memory[k]; }).filter(function (n) { return typeof n === 'number'; });
        const learned = vals.filter(function (n) { return n & 16; });
        const watched = learned.filter(function (n) { return n & 32; });
        const N = watched.length;
        const A = $('availBars'), Pb = $('playedBars'), O = $('otherBars');
        clear(A); clear(Pb); clear(O);
        $('dashBasis').textContent = N ? 'Based on ' + N + ' video' + (N === 1 ? '' : 's') + ' you watched (live streams not counted).' : 'Watch a few videos and your own numbers will appear here.';
        const cnt = function (arr, bit) { return arr.filter(function (n) { return n & bit; }).length; };
        bar(A, 'AV1', cnt(watched, 1), N, '#2bd576', 0);
        bar(A, 'VP9', cnt(watched, 2), N, '#3ea6ff', 1);
        bar(A, 'H.264', cnt(watched, 4), N, '#ffb02e', 2);
        const played = vals.filter(function (n) { return (n & 32) && (n & (64 | 128 | 256)); });
        const Np = played.length;
        bar(Pb, 'AV1', cnt(played, 64), Np, '#2bd576', 0);
        bar(Pb, 'VP9', cnt(played, 128), Np, '#3ea6ff', 1);
        bar(Pb, 'H.264', cnt(played, 256), Np, '#ffb02e', 2);
        const pc = S.profiles.video.codec1, prefBit = { av1: 64, vp9: 128, avc: 256 }[pc];
        $('prefLine').textContent = prefBit && Np ? 'Played in your preferred video codec (' + NAME[pc] + '): ' + (cnt(played, prefBit) / Np * 100).toFixed(2) + '%' : '';
        bar(O, 'Has 60 fps (or 48/50)', cnt(watched, 4096), N, '#b38cff', 0);
        bar(O, 'Has 4K', cnt(watched, 8192), N, '#ff7ab6', 1);
        $('learnLine').textContent = 'Videos remembered (including hover previews): ' + learned.length;
    }
    function loadDash() {
        if (!EXT) { renderDash(); return; }
        chrome.storage.local.get('ytldMemory', function (r) { memory = (r && r.ytldMemory) || {}; renderDash(); });
    }

    // ================= TABS =================
    function showTab(t) {
        if (t === curTab) return;
        const from = TABS.indexOf(curTab), to = TABS.indexOf(t);
        curTab = t;
        segSet($('tabs'), t, 'tab');
        const tb = document.querySelector('#tabs [data-tab="' + t + '"]'); if (tb) tb.classList.remove('badge');
        TABS.forEach(function (x) {
            const v = $('tab-' + x);
            if (x === t) { v.classList.toggle('from-left', to < from); v.hidden = false; }
            else v.hidden = true;
        });
        refreshPills($('tab-' + t));
        TABS.forEach(function (x) { if (x !== t) return; ['maxRes', 'autoReload', 'thumb', 'sthumb', 'prev'].forEach(function (id) { paintRange($(id)); }); });
        if (t === 'dash') loadDash();
        if (pendingFlash[t] && pendingFlash[t].size) setTimeout(function () { runFlash(t); }, 200);
    }
    function goTo(tab, card) {
        showTab(tab);
        setTimeout(function () {
            const el = $(card); if (!el) return;
            try { el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); } catch (e) {}
            flashEl(card);
        }, 180);
    }

    // ================= EVENTS =================
    $('tabs').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
    $('lookBtn').addEventListener('click', function () {
        const d = $('look'), open = !d.classList.contains('open');
        d.classList.toggle('open', open); this.setAttribute('aria-expanded', String(open));
        if (open) refreshPills(d);
    });
    $('theme').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) saveUi({ theme: b.dataset.v }); });
    $('accents').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) saveUi({ accent: b.dataset.a }); });
    $('chgNow').addEventListener('click', onChangesClick);
    $('chgPlay').addEventListener('click', onChangesClick);
    $('kinds').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b) return;
        editKind = b.dataset.k; kindPicked = true; renderSettings(false);
        retrigger($('kindHint'), 'pop');
    });
    $('codec1').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b) return;
        manualEdit();
        const patch = { codec1: b.dataset.v };
        if (b.dataset.v === P().codec2) patch.codec2 = FAM.filter(function (c) { return c !== b.dataset.v; })[0];
        setProf(patch); renderSettings(false); needReload();
    });
    $('codec2').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        manualEdit(); setProf({ codec2: b.dataset.v }); renderSettings(false); needReload();
    });
    function stopAnim() { if (this._anim) { this._anim.stop = true; this._anim = null; this.step = '1'; } }
    ['maxRes', 'autoReload', 'thumb', 'sthumb', 'prev'].forEach(function (id) { $(id).addEventListener('pointerdown', stopAnim); });
    $('maxRes').addEventListener('input', function () { paintRange(this); manualEdit(); setProf({ startRes: RES[Math.round(+this.value)] }); renderSettings(false); needReload(); });
    $('maxFps').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b) return;
        manualEdit(); setProf({ maxFps: +b.dataset.v }); renderSettings(false); needReload();
    });
    $('copyTargets').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b) return;
        const k = b.dataset.k;
        if (copySel.set.has(k)) copySel.set.delete(k); else copySel.set.add(k);
        renderCopy(false);
    });
    $('copyBtn').addEventListener('click', function () {
        const src = clone(P()), pr = clone(S.profiles), done = [];
        copySel.set.forEach(function (k) { if (!profEq(pr[k], src)) { pr[k] = clone(src); done.push(KIND_PLURAL[k]); } });
        if (!done.length) return;
        manualEdit();
        store({ profiles: pr });
        const btn = this;
        btn.classList.add('done'); btn.disabled = false; btn.textContent = '✓ Copied to ' + done.join(', ');
        renderSettings(false); renderCopy(true);
        toast(KIND_PLURAL[editKind] + ' settings copied to ' + done.join(', '));
        needReload();
        setTimeout(function () { btn.classList.remove('done'); renderCopy(false); }, 1500);
    });
    $('notices').addEventListener('change', function () { store({ notices: this.checked }); renderSettings(false); });
    $('autoReload').addEventListener('input', function () { paintRange(this); store({ autoReloadSec: AR[Math.round(+this.value)] }); renderSettings(false); });
    $('thumb').addEventListener('input', function () { paintRange(this); manualEdit(); store({ thumbH: WIDE[Math.round(+this.value)].h }); $('thumbC').value = ''; renderSettings(false); });
    $('sthumb').addEventListener('input', function () { paintRange(this); manualEdit(); store({ shortsThumbH: TALL[Math.round(+this.value)].h }); $('sthumbC').value = ''; renderSettings(false); });
    $('prev').addEventListener('input', function () { paintRange(this); manualEdit(); store({ previewH: PREV[Math.round(+this.value)] }); $('prevC').value = ''; renderSettings(false); });
    function customInput(id, key) {
        $(id).addEventListener('change', function () {
            const n = Math.round(+this.value);
            if (!n || n < 1) return;
            manualEdit();
            const patch = {}; patch[key] = n; store(patch); renderSettings(true);
        });
    }
    customInput('thumbC', 'thumbH'); customInput('sthumbC', 'shortsThumbH'); customInput('prevC', 'previewH');
    $('still').addEventListener('change', function () { manualEdit(); store({ stillHover: this.checked }); renderSettings(false); });
    $('chan').addEventListener('change', function () { manualEdit(); store({ channelImages: this.checked }); renderSettings(false); });
    $('autoRow').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) qualityPick('auto'); });
    $('matrix').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b || b.disabled || !lastSt) return;
        const a = b.dataset.v.split('|'), c = a[0], p = +a[1], f = +a[2];
        const fm = (lastSt.fmts || []).filter(function (x) { return x.c === c && x.p === p && x.f === f; })[0];
        const q = qName(p);
        if (fm && fm.use && q) { qualityPick(q); return; }                       // in YouTube's menu: instant
        const patch = { codec: c, res: p };
        const top = Math.max.apply(null, (lastSt.fmts || []).filter(function (x) { return x.c === c && x.p === p; }).map(function (x) { return x.f; }).concat([0]));
        patch.fps = f < top ? f : 0;                                               // e.g. 720p30 when 720p60 exists
        setPerObj(patch);
    });
    $('startBtn').addEventListener('click', function () {
        const p = +this.dataset.p; if (!p) return;
        const kind = setupKind(), pr = clone(S.profiles);
        pr[kind] = Object.assign({}, pr[kind], { startRes: p });
        manualEdit(); store({ profiles: pr }); renderSettings(false);
        toast('All ' + KIND_ALL[kind] + ' now start at ' + pLabel(p));
    });
    $('fpsChips').addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b || !lastSt) return;
        const f = +b.dataset.v, fl = (lastSt.fmts || []).map(function (x) { return x.f; });
        const top = Math.max.apply(null, fl.concat([0]));
        const profF = +(S.profiles[setupKind()] || PROFILE).maxFps || 60;
        const pv = perOf(vid), val = f >= top ? (profF >= top ? 0 : 60) : f;       // highest = no limit for this video
        if ((+pv.fps || 0) === val) return;
        setPerObj({ fps: val });
    });
    $('pvReset').addEventListener('click', function () {
        if (!vid) return;
        const all = Object.assign({}, S.perVideo || {}); delete all[vid];
        store({ perVideo: all }); renderCtl(lastSt); softApply('Back to your defaults…');
    });
    function reloadTab() { if (EXT && tabId != null) chrome.tabs.reload(tabId); $('apply').classList.remove('show'); }
    $('applyBtn').addEventListener('click', function () {        // try in place first, full reload only if needed
        if (!EXT || tabId == null) { reloadTab(); return; }
        chrome.tabs.sendMessage(tabId, { kind: 'softReload', data: { settings: clone(S) } }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) reloadTab();
            else { $('apply').classList.remove('show'); toast('Applied to this video'); setTimeout(refresh, 700); }
        });
    });
    $('bBtn').addEventListener('click', function () { if ($('banner').classList.contains('red')) reloadTab(); else $('applyBtn').click(); });
    $('reset').addEventListener('click', function () {
        const btn = this;
        if (!EXT) { btn.textContent = 'Cleared ✓ (demo)'; return; }
        chrome.storage.local.remove('ytldMemory');
        memory = {}; renderDash();
        if (tabId == null) { toast('Stats cleared ✓'); return; }
        chrome.tabs.sendMessage(tabId, { kind: 'resetMemory' }, function (r) {
            toast((!chrome.runtime.lastError && r && r.ok) ? 'Memory & stats cleared ✓' : 'Stats cleared ✓');
        });
    });
    window.addEventListener('resize', function () { document.querySelectorAll('.seg').forEach(pill); });

    // ================= START =================
    buildPresets();
    try { const u = JSON.parse(localStorage.getItem('tdUi')); if (u) UI = Object.assign(UI, u); } catch (e) {}
    applyUi();
    probeDevice(function (d) { dev = d || false; renderDevice(); renderSettings(false); if (lastSt) showStatus(lastSt); });
    function started() { refreshPills(document); ['maxRes', 'autoReload', 'thumb', 'sthumb', 'prev'].forEach(function (id) { paintRange($(id)); }); }
    if (!EXT) {                                              // demo preview
        vid = 'xMxTCwVyaYU';
        renderSettings(false);
        const L = [[144, 'tiny'], [240, 'small'], [360, 'medium'], [480, 'large'], [720, 'hd720'], [1080, 'hd1080'], [1440, 'hd1440'], [2160, 'hd2160']];
        showStatus({ vid: vid, kind: 'video', shorts: false, live: false, state: 'playing', playing: { fam: 'av1', p: 1080, fps: 60, w: 1920, h: 1080 },
            avail: { av1: true, vp9: true, avc: true }, res: [144, 240, 360, 480, 720, 1080, 1440, 2160], fps: [30, 60],
            levels: L.map(function (x) { return { q: x[1], p: x[0], label: x[0] + 'p' + (x[0] >= 720 ? '60' : '') }; }), q: 'hd1080', auto: false,
            rows: L.map(function (x) { const p = x[0]; return { p: p, fams: p > 1080 ? ['vp9'] : p > 480 ? ['av1', 'vp9', 'avc'] : ['av1', 'vp9', 'avc'], fps: p >= 720 ? [60] : [30], use: 'av1' }; }),
            fmts: [].concat(
                L.map(function (x) { return { c: 'av1', p: x[0], f: x[0] >= 720 ? 60 : 30, use: true }; }),
                L.map(function (x) { return { c: 'vp9', p: x[0], f: x[0] >= 720 ? 60 : 30, use: false }; }),
                [[144, 30], [360, 30], [480, 30], [720, 60], [1080, 60]].map(function (x) { return { c: 'avc', p: x[0], f: x[1], use: false }; })),
            target: 'av1', preferred: 'av1', per: null, caps: { start: 0, fps: 60 } });
        const demo = {};
        for (let i = 0; i < 200; i++) {
            let n = 16 | 32 | 2 | 4;
            if (i % 25 !== 0) n |= 1;
            if (i % 40 === 0) n &= ~2;
            n |= (n & 1) && i % 30 !== 0 ? 64 : (n & 2) ? 128 : 256;
            if (i % 5 === 0) n |= 4096;
            if (i % 9 === 0) n |= 8192;
            demo['demo' + i] = n;
        }
        memory = demo;
        $('ver').textContent = 'Demo preview';
        started();
        return;
    }
    chrome.storage.local.get(null, function (s) {
        if (s && s.ui) { UI = Object.assign(UI, s.ui); applyUi(); }
        S = migrate(s);
        delete S.ui;
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const t = tabs && tabs[0];
            if (t && isYT(t.url)) { tabId = t.id; vid = vidFromUrl(t.url); }
            renderSettings(false);
            showStatus(null);
            started();
            refresh();
            setInterval(refresh, 1000);
        });
    });
})();
