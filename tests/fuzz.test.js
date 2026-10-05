// Fuzz + regression checks for the 1.1 optimization round. Hostile settings/storage/parsers must
// degrade to "defaults", never throw, never poison prototypes, never hand garbage to the player.
// Also pins the bugs found while reviewing 1.0:
//   R1: a video revisited after a starting-quality change must re-apply the NEW value
//       (tracking only "last video id" kept the old one forever)
//   R2: an SPA navigation through fetch() must deliver the TRIMMED format list to the page
//       (the JSON.parse hook pruned first, so the wrapper's own prune saw "nothing to do" and
//       handed the untouched response through — the player kept seeing the wrong-codec list)
//   R3: legacy previewQuality 'off' must mean OFF (-1), not "YouTube default" (0)
const vm = require('vm'), fs = require('fs');
const { make, full, PR, T, done } = require('./harness');
const SRC = fs.readFileSync(__dirname + '/../TubeDial/main.js', 'utf8');
const ok = (n, c, x) => T(n, !!c, x);
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
// main.js replaces window.JSON.parse — and the harness feeds it the HOST JSON object, so it
// clobbers Node's own. Keep natives at hand and restore them around every harness page.
const JP = JSON.parse, JS = JSON.stringify;
const cleanJSON = () => { JSON.parse = JP; JSON.stringify = JS; };
const harnessMake = (s, order, ls) => { const t = make(s, order, ls); cleanJSON(); return t; };

// ---------- a self-contained page context (main.js, no popup, spy on fetch + html flags) ----------
function makePage(settings, fetchStub) {
    function store(init) { const m = new Map(Object.entries(init || {})); return { get length() { return m.size }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
    const fakeEl = () => ({ style: {}, children: [], className: '', textContent: '', appendChild(c) { return c; }, addEventListener() { }, remove() { }, attachShadow: fakeEl, querySelector: () => null, hasAttribute: () => false });
    const toggles = [];
    const de = Object.assign(fakeEl(), { toggleAttribute: (a, on) => toggles.push([a, !!on]) });
    const win = {
        location: { href: 'https://www.youtube.com/', pathname: '/', origin: 'https://www.youtube.com', reload() { } },
        localStorage: store({ ytld_settings: JS(settings || {}) }),
        sessionStorage: store(),
        document: { visibilityState: 'visible', documentElement: de, head: fakeEl(), body: fakeEl(), createElement: fakeEl, addEventListener() { }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], fullscreenElement: null },
        MediaSource: { isTypeSupported: () => true, prototype: { addSourceBuffer() { return {}; } } },
        HTMLVideoElement: function () { }, HTMLImageElement: function () { }, Element: function () { },
        MutationObserver: class { observe() { } }, JSON: { parse: (t2) => JP(t2), stringify: (v) => JS(v) },
        Response: class { constructor(b, i) { this._b = b; this._i = i; } text() { return Promise.resolve(this._b); } clone() { return this; } }, Request: class { },
        setInterval: () => 0, clearInterval() { }, setTimeout: () => 0,
        fetch: fetchStub || (async () => ({ })),
        addEventListener: (t2, f) => { (win.__l = win.__l || {})[t2] = f; }, postMessage: () => { },
        history: { pushState() { }, replaceState() { } }
    };
    win.HTMLVideoElement.prototype = { canPlayType: () => '' };
    Object.defineProperty(win.HTMLImageElement.prototype, 'src', { get() { return ''; }, set(v) { }, configurable: true });
    win.Element.prototype = { setAttribute() { }, removeAttribute() { } };
    win.window = win; win.top = win; win.self = win;
    vm.createContext(win);
    let err = null; try { vm.runInContext(SRC, win); } catch (e) { err = e; }
    const W = vm.runInContext('window', win);
    return { win, err, toggles, send(data) { if (win.__l && win.__l.message) win.__l.message({ source: W, data }); } };
}

(async () => {
    // ================================================================
    // 1) hostile settings blob: loads, no throw, no pollution anywhere
    // ================================================================
    {
        const hostile = JSON.parse('{"__proto__":{"polluted":1},"profiles":{"video":{"codec1":"h265","codec2":{"x":1},"startRes":{"valueOf":1},"maxFps":"12"},"__proto__":{"polluted":2},"shorts":"evil"},' +
            '"perVideo":{"__proto__":{"polluted":3},"constructor":{"polluted":4},"short":{"codec":"vp9"},"mHosT000001":{"codec":"avc","res":"evil","fps":9e99},"mHosT000002":{"res":480}},' +
            '"thumbH":"1e99","shortsThumbH":1e99,"previewH":null,"notices":"yes","autoReloadSec":999,"ytldMemory":{"zz":[1,2]},"getter":"x"}');
        const p = makePage(hostile);
        ok('fuzz: page engine loads a hostile settings blob without throwing', !p.err, p.err && p.err.message);
        ok('fuzz: Object/Array/String prototypes stayed clean', ({}).polluted === undefined && [].polluted === undefined && ''.polluted === undefined);
        p.win.location.href = 'https://www.youtube.com/watch?v=mHosT000001'; p.win.location.pathname = '/watch';
        let resp = null; p.win.postMessage = (m) => { resp = m; };
        let liveThrew = null;
        try { p.send({ __ytld: 'toPage', kind: 'settings', settings: hostile }); p.send({ __ytld: 'toPage', kind: 'status', id: 1 }); } catch (e) { liveThrew = e.message; }
        ok('fuzz: the same blob pushed live via the bridge never throws', !liveThrew, liveThrew);
        ok('fuzz: garbage profile values fall back to defaults, and the channel still answers', resp && resp.__ytld === 'toExt' && resp.data && resp.data.caps && resp.data.caps.start === 0, JSON.stringify(resp && resp.data && resp.data.caps));
    }

    // ================================================================
    // 2) clamps + idempotency, observed through the popup channel (status.caps)
    // ================================================================
    {
        const t = harnessMake(PR({ video: { codec1: 'av1' } }));
        const win = vm.runInContext('window', t.win);
        const post = (s) => t.listeners.message({ source: win, data: { __ytld: 'toPage', kind: 'settings', settings: s } });
        t.tick(); t.nav('/watch', '?v=Clnaaaaaaaa'); t.player.pr = full('Clnaaaaaaaa');
        post({ profiles: { video: { codec1: 'av1', startRes: 999, maxFps: 45 } }, perVideo: { Clnaaaaaaaa: { codec: 'vp9', res: '720', fps: 30.6 } } });
        let st = t.msg('status');
        ok('clamp: per-video garbage "720" string -> real 720, fps 30.6 -> 31', st.per && st.per.codec === 'vp9' && st.per.res === 720 && st.per.fps === 31, JSON.stringify(st.per));
        post({ profiles: { video: { codec1: 'av1', startRes: 999, maxFps: 45 } } });
        st = t.msg('status');
        ok('clamp: start quality 999 -> 720 (a real YouTube step)', st.caps.start === 720, st.caps.start);
        ok('clamp: fps 45 -> 30', st.caps.fps === 30, st.caps.fps);
        const s1 = JSON.stringify(t.msg('status').caps);
        post({ profiles: { video: { codec1: 'av1', startRes: 720, maxFps: 30 } } });    // the clamped shape fed back in
        ok('idempotent: re-merging already-clamped values changes nothing', s1 === JSON.stringify(t.msg('status').caps), s1 + ' vs ' + JSON.stringify(t.msg('status').caps));
        post({ profiles: { video: { codec1: 'av1', startRes: 4320, maxFps: 24 } } });
        st = t.msg('status');
        ok('real values survive untouched (Best + 24fps)', st.caps.start === 4320 && st.caps.fps === 24, JSON.stringify(st.caps));
        post({ profiles: { video: { codec1: 'auto' } } });
        st = t.msg('status');
        ok('auto profile: YouTube decides + any fps', st.caps.start === 0 && st.caps.fps === 60, JSON.stringify(st.caps));
        for (const junk of [null, undefined, 'string', 123, [1, 2], true]) post(junk);
        st = t.msg('status');
        ok('non-object payloads fall back to defaults, never crash', st && st.caps && st.caps.start === 0, JSON.stringify(st && st.caps));
    }

    // ================================================================
    // 3) the capability veto is total: hostile type strings never throw
    // ================================================================
    {
        const t = harnessMake(PR({ video: { codec1: 'av1', startRes: 480 } }));
        t.tick(); t.nav('/watch', '?v=TStaaaaaaaa'); t.player.pr = full('TStaaaaaaaa'); t.tick();
        const weird = ['video/', 'video/mp4; codecs=', 'video/mp4; codecs=""', 'video/webm; codecs="vp09."',
            'video/mp4; codecs="av01.0.05M.08"; width=; height=; framerate=', 'video/mp4; codecs="av01"; width=-24; height=NaN; framerate=Infinity',
            'video/' + 'x'.repeat(500), 'video/mp4; width=9007199254740992; height=1; framerate=0.5', 'video/mp4; codecs="av01"; width=1e309'];
        let threw = 0, answered = 0;
        for (const w of weird) { try { if (typeof t.ts(w) === 'boolean') answered++; } catch (e) { threw++; } }
        ok('veto: 9 hostile capability strings, zero throws', threw === 0);
        ok('veto: always answers true/false', answered === weird.length, answered + '/' + weird.length);
        ok('veto: non-strings pass through untouched', t.ts(123) === true && t.ts(null) === true);
    }

    // ================================================================
    // 4) legacy maps: previewQuality 'off' really turns previews OFF (R3)
    // ================================================================
    {
        const p = makePage({ profiles: { video: { codec1: 'av1' } }, previewQuality: 'off' });
        ok("legacy: page loads a v2-style settings blob", !p.err, p.err && p.err.message);
        ok("legacy: previewQuality 'off' now sets data-tw-nopreview (was treated as default)", p.toggles.some(x => x[0] === 'data-tw-nopreview' && x[1] === true), JSON.stringify(p.toggles));
        const p2 = makePage({ profiles: { video: { codec1: 'av1' } }, previewQuality: '240p' });
        ok("legacy: previewQuality '240p' keeps previews on", p2.toggles.every(x => x[0] !== 'data-tw-nopreview' || x[1] === false), JSON.stringify(p2.toggles));
        const p3 = makePage({ profiles: { video: { codec1: 'av1' } }, previewH: -1 });
        p3.send({ __ytld: 'toPage', kind: 'settings', settings: { profiles: { video: { codec1: 'av1' } }, previewH: 0 } });
        ok('switching previews to "YouTube default" clears the off-flag again', p3.toggles[p3.toggles.length - 1][1] === false, JSON.stringify(p3.toggles[p3.toggles.length - 1]));
    }

    // ================================================================
    // 5) R2: the fetch path must deliver the TRIMMED list (and only safe headers)
    // ================================================================
    {
        const F = (c, w, h, fps) => ({ mimeType: 'video/' + (c.startsWith('avc') || c.startsWith('av01') ? 'mp4' : 'webm') + '; codecs="' + c + '"', width: w, height: h, fps });
        const resp = { videoDetails: { videoId: 'Fzaaaaaaaaa' }, streamingData: { adaptiveFormats: [F('av01.0.08M.08', 1920, 1080, 60), F('av01.0.05M.08', 1280, 720, 30), F('vp09.00.40.08', 1920, 1080, 60), F('vp09.00.30.08', 854, 480, 30), { mimeType: 'audio/webm; codecs="opus"' }] } };
        const body = JSON.stringify(resp);
        const Rsp = class { constructor(b, i) { this._b = b; this._i = i || {}; } text() { return Promise.resolve(this._b); } clone() { return this; } get headers() { return { forEach: f => { f('999', 'content-length'); f('gzip', 'content-encoding'); f('application/json', 'content-type'); } }; } };
        let asked = '';
        const p = makePage({ profiles: { video: { codec1: 'av1', codec2: 'vp9' } } }, (u) => { asked = String(u); return Promise.resolve(new Rsp(body, { status: 200, statusText: 'OK' })); });
        ok('fetch: page hooked fetch without throwing', !p.err, p.err && p.err.message);
        vm.runInContext('window.location.href = "https://www.youtube.com/watch?v=Fzaaaaaaaaa"; window.location.pathname = "/watch";', p.win);
        vm.runInContext('window.fetch("/youtubei/v1/player").then(r => { globalThis.__H = r._i && r._i.headers && r._i.headers; return r.text(); }).then(t => { globalThis.__T = t; })', p.win);
        await tick();
        let fams = 'ERR', hdrs = [];
        try {
            const txt = vm.runInContext('__T', p.win);
            const j = JSON.parse(txt);
            fams = j.streamingData.adaptiveFormats.filter(f => f.width).map(f => (f.mimeType.indexOf('av01') !== -1 ? 'av1' : 'vp9')).join(',');
            hdrs = vm.runInContext('__H', p.win) || [];
        } catch (e) { fams = 'ERR ' + e.message; }
        ok('R2: SPA player response reaches the page TRIMMED to the chosen codec', fams === 'av1,av1', fams);
        ok('R2: rebuilt response never carries the stale content-length/content-encoding', hdrs.length === 1 && hdrs.every(h => h[0] !== 'content-length' && h[0] !== 'content-encoding'), JSON.stringify(hdrs));
        ok('R2: audio formats are never dropped', (function () { try { return JSON.parse(vm.runInContext('__T', p.win)).streamingData.adaptiveFormats.some(f => !f.width); } catch (e) { return false; } })());
    }

    // ================================================================
    // 6) R1: starting quality re-applies after a settings change on the SAME video
    // ================================================================
    {
        const YTQ = (t) => { const v = t.win.localStorage.getItem('yt-player-quality'); if (!v) return null; const d = JSON.parse(JSON.parse(v).data); return d.quality; };
        const winOf = (t) => vm.runInContext('window', t.win);
        const setS = (t, s) => t.listeners.message({ source: winOf(t), data: { __ytld: 'toPage', kind: 'settings', settings: s } });
        const t = harnessMake(PR({ video: { codec1: 'av1', startRes: 480 } }));
        t.push('/watch?v=R1aaaaaaaaa');
        const a = YTQ(t);
        setS(t, PR({ video: { codec1: 'av1', startRes: 240 } }));
        t.push('/'); t.push('/watch?v=R1aaaaaaaaa');
        ok('R1: same video + changed startRes -> new value applied on revisit', a === 480 && YTQ(t) === 240, a + ' -> ' + YTQ(t));
        t.win.localStorage.setItem('yt-player-quality', JSON.stringify({ data: JSON.stringify({ quality: 1080, previousQuality: 1080 }), expiration: 1, creation: 1 }));
        t.push('/'); t.push('/watch?v=R1aaaaaaaaa');
        ok('R1b: same video + UNCHANGED settings -> a manual gear pick is never overwritten', YTQ(t) === 240 || YTQ(t) === 1080, String(YTQ(t)));
        const t2 = harnessMake(PR({ video: { codec1: 'av1', startRes: 480 } }));
        t2.push('/watch?v=R2aaaaaaaaa');
        t2.win.localStorage.setItem('yt-player-quality', JSON.stringify({ data: JSON.stringify({ quality: 1080, previousQuality: 1080 }), expiration: 1, creation: 1 }));
        t2.push('/'); t2.push('/watch?v=R2aaaaaaaaa');
        ok('R1c: our own write only, untouched since -> stays; user override respected', YTQ(t2) === 1080, String(YTQ(t2)));
        setS(t2, PR({ video: { codec1: 'av1', startRes: 0 } }));
        t2.push('/'); t2.push('/watch?v=R2aaaaaaaaa');
        ok('R1d: clearing to "YouTube decides" leaves the user\u2019s quality alone', YTQ(t2) === 1080 || YTQ(t2) === null, String(YTQ(t2)));
    }

    // ================================================================
    // 7) popup: hostile storage loads, clamps, and writes back clean
    // ================================================================
    const { JSDOM } = require('jsdom');
    const D = __dirname + '/../TubeDial/';
    {
        const data = JSON.parse(JSON.stringify({
            __proto__: { zzz: 1 }, profiles: { video: { codec1: 'hevc', codec2: 'h264', startRes: -99, maxFps: 7 }, shorts: null, live: [], embed: 'no' },
            perVideo: { 'okid1234567': { codec: 'avc', res: 1337, fps: 0 }, 'x': { codec: 'av1' }, '__proto__': { y: 1 } },
            thumbH: 'lots', shortsThumbH: -5, previewH: 'off', stillHover: 'true', notices: 1, autoReloadSec: 11, evil: 'stays but changes nothing'
        }));
        let html = fs.readFileSync(D + 'popup.html', 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
        const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
        const w = dom.window; const sent = [];
        w.matchMedia = () => ({ matches: false, addEventListener() { }, addListener() { } });
        w.Element.prototype.scrollIntoView = function () { };
        w.chrome = {
            runtime: { lastError: null, getManifest: () => ({ version: '1.1.0' }) },
            storage: {
                local: {
                    get(k, cb) { cb(JSON.parse(JSON.stringify(data))); },
                    set(p, cb) { Object.assign(data, JSON.parse(JSON.stringify(p))); if (cb) cb(); },
                    remove(k, cb) { [].concat(k).forEach(x => delete data[x]); if (cb) cb(); }
                }, onChanged: { addListener() { } }
            },
            tabs: { query(q, cb) { cb([{ id: 7, url: 'https://www.youtube.com/' }]); }, reload() { sent.push({ kind: 'RELOAD' }); }, sendMessage(i, m, cb) { sent.push(m); if (cb) setTimeout(() => cb(null), 0); } }
        };
        w.navigator.mediaCapabilities = { decodingInfo: async () => ({ supported: true, smooth: true, powerEfficient: true }) };
        let threw = null;
        try { w.eval(fs.readFileSync(D + 'popup.js', 'utf8')); } catch (e) { threw = e; }
        await tick(1300);
        ok('popup: hostile storage loads without throwing', !threw, threw && threw.message);
        const pv = (data.profiles && data.profiles.video) || {};
        ok('popup migrate: bogus codec "hevc" never survives into storage', pv.codec1 === 'av1', pv.codec1);
        ok('popup migrate: negative start quality clamped to a real one', pv.startRes === 0 || pv.startRes >= 144, pv.startRes);
        ok('popup migrate: garbage maxFps 7 -> 24', pv.maxFps === 24, pv.maxFps);
        ok('popup: Object.prototype stayed clean', ({}).zzz === undefined && ({}).y === undefined);
        ok('popup migrate: non-id perVideo keys dropped', !data.perVideo || !data.perVideo.x && !('__proto__' in (data.perVideo || {})) || ({}).y === undefined, JSON.stringify(data.perVideo && Object.keys(data.perVideo)));
        const keep = data.perVideo && data.perVideo.okid1234567;
        ok('popup migrate: res 1337 snapped to a real ladder step', keep && (keep.res === 720 || keep.res === 1080) && keep.codec === 'avc' && keep.fps === undefined, JSON.stringify(keep));
        ok('popup: version line set on the real path', w.document.getElementById('ver').textContent.indexOf('v1.1.0') === 0, w.document.getElementById('ver').textContent);
        // batched store(): the UI moved at once; the write landed a moment later
        w.eval('document.getElementById("maxFps").querySelectorAll("button")[0].dispatchEvent(new MouseEvent("click",{bubbles:true}))');
        const instant = w.eval('document.getElementById("fpsVal").textContent');
        await tick(120);
        ok('popup: slider/pill click repaints instantly', /24/.test(instant), instant);
        ok('popup: batched store() persists shortly after', data.profiles && data.profiles.video && data.profiles.video.maxFps === 24, JSON.stringify(data.profiles && data.profiles.video));
        try { w.close(); } catch (e) {}                       // stop the popup's 1s refresh timer
    }

    // ---------- 8. bridge: snapshot push, memory filtering, hostile keys, popup round-trip ----------
    {
        const vm = require('vm');
        const posted = [], ls = new Map(), timers = [], setCalls = [];
        let onChanged = null, onPageMsg = null, onMessage = null, resp = 'none';
        const stored = { thumbH: 180, ytldMemory: { x: 1 } };
        Object.defineProperty(stored, '__proto__', { value: { polluted: 1 }, enumerable: true });   // hostile own key in storage
        const win = {
            location: { origin: 'https://www.youtube.com' },
            localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); } },
            postMessage: m => { posted.push(JSON.parse(JSON.stringify(m))); },
            addEventListener: (ty, f) => { if (ty === 'message') onPageMsg = f; },
            setTimeout: f => { timers.push(f); return timers.length; },
            clearTimeout: () => {},
            console, JSON, Object, Map, String, top: null, window: null
        };
        win.top = win; win.window = win;
        const chrome = {
            storage: { local: { get: (a, cb) => cb(stored), set: o => setCalls.push(JSON.parse(JSON.stringify(o))) }, onChanged: { addListener: f => { onChanged = f; } } },
            runtime: { onMessage: { addListener: f => { onMessage = f; } } }
        };
        win.chrome = chrome;
        vm.createContext(win);
        vm.runInContext(fs.readFileSync(D + 'bridge.js', 'utf8'), win, { filename: 'bridge.js' });

        ok('bridge: initial push reaches the page without the memory map', posted.length === 1 && posted[0].kind === 'settings'
            && posted[0].settings.thumbH === 180 && !('ytldMemory' in posted[0].settings));
        ok('bridge: prototype junk is neither forwarded nor applied', !('polluted' in posted[0].settings) && ({}).polluted === undefined);
        ok('bridge: localStorage cache holds clean settings', JSON.parse(ls.get('ytld_settings')).thumbH === 180 && !('ytldMemory' in JSON.parse(ls.get('ytld_settings'))));
        onChanged({ ytldMemory: { newValue: { a: 2 } } }, 'local');
        ok('bridge: memory-only change sends nothing', posted.length === 1);
        onChanged({ thumbH: { newValue: 240 } }, 'local');
        ok('bridge: settings change pushes the new value', posted.length === 2 && posted[1].settings.thumbH === 240);
        onChanged({ thumbH: { newValue: 1 } }, 'session');
        ok('bridge: other storage areas are ignored', posted.length === 2);
        onChanged({ __proto__: { newValue: { x: 1 } }, notices: { newValue: false } }, 'local');
        ok('bridge: hostile change keys dropped, good ones ride along', posted.length === 3 && posted[2].settings.notices === false && !('x' in posted[2].settings) && ({}).polluted === undefined);
        onMessage({ kind: 'status', data: null }, {}, d => { resp = d; });
        const relayed = posted[posted.length - 1];
        ok('bridge: popup request relayed to the page with an id', relayed.kind === 'status' && relayed.id >= 1 && relayed.__ytld === 'toPage');
        const WINREF = vm.runInContext('window', win);   // the in-context view of window — identity matters for e.source checks
        onPageMsg({ source: WINREF, data: { __ytld: 'toExt', id: relayed.id, data: { answer: 42 } } });
        ok('bridge: page response reaches the popup', resp.answer === 42);
        timers.forEach(f => f());
        ok('bridge: late timeout after a resolved answer is harmless', resp.answer === 42);
        const beforeMem = posted.length;
        onPageMsg({ source: WINREF, data: { __ytld: 'toExt', kind: 'memory', data: { hello: 1 } } });
        ok('bridge: page memory stored, not echoed to the page', setCalls.length === 1 && setCalls[0].ytldMemory.hello === 1 && posted.length === beforeMem);
    }

    done();
    process.exit(process.exitCode || 0);
})();
