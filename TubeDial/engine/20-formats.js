// STAGE: formats — the format-list trimmer. It is the only owner of the three interception
// points (ytInitialPlayerResponse, JSON.parse, fetch) and of the format pruning: every player
// response YouTube produces passes through prune() BEFORE the player sees it, trimmed to the plan.
// Runs right after core.js. Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;
    const S = function () { return K.S; };

    const ORIG = new Map();                                 // videoId -> YouTube's original, untrimmed format list
    function prune(d) {
        if (!d || typeof d !== 'object') return false;
        if (d.playerResponse && !d.streamingData) return prune(d.playerResponse);
        const info = K.learn(d);
        if (!info || K.isLiveVD(d.videoDetails)) return false;
        const f = d.streamingData.adaptiveFormats;
        const T = f.filter(K.isVideoFmt).map(K.norm).filter(function (t) { return t.fam; });
        if (!T.length) return false;
        const vv = K.vidOf(d);
        if (vv && (!ORIG.has(vv) || ORIG.get(vv).length < f.length)) {
            ORIG.set(vv, f.slice());
            if (ORIG.size > 20) ORIG.delete(ORIG.keys().next().value);
        }
        const pl = K.plan(vv, T);
        if (pl.keep.length === T.length) return false;
        const ks = new Set(pl.keep.map(function (t) { return t.ref; }));
        d.streamingData.adaptiveFormats = f.filter(function (x) { return !K.isVideoFmt(x) || ks.has(x) || !K.norm(x).fam; });
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
    const NATIVE_PARSE = JSON.parse;                               // kept unhooked: see the fetch wrapper
    try {
        JSON.parse = function (text) {
            const data = NATIVE_PARSE.apply(this, arguments);
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
                    // parse with the NATIVE parse: through the hook the list would be trimmed once
                    // already, and the second prune here would see "nothing to do" and hand the
                    // player the untouched response — which is how SPA navigations kept the wrong codec.
                    const json = NATIVE_PARSE(txt);
                    if (!prune(json)) return response;
                    const hs = [];
                    try { if (response.headers && response.headers.forEach) response.headers.forEach(function (v, k) {
                        const lk = String(k).toLowerCase();
                        if (lk === 'content-length' || lk === 'content-encoding' || lk === 'transfer-encoding') return;   // body was rewritten
                        hs.push([k, v]);
                    }); } catch (e) {}
                    const out = new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: hs });
                    try { Object.defineProperty(out, 'url', { value: response.url }); } catch (e) {}
                    return out;
                }).catch(function () { return response; });
            });
        };
    } catch (e) {}

    // YouTube's own AV1 preference flag follows the video profile (harmless when it isn't AV1-first)
    try { if (S().profiles.video.codec1 === 'av1' && localStorage.getItem('yt-player-av1-pref') !== '8192') localStorage.setItem('yt-player-av1-pref', '8192'); } catch (e) {}

    K.svc.formats = {
        prune: prune,
        reprime: function (v) {                                 // softReload: hand the player the full list, trimmed for the NEW choice
            try {
                const pr = K.resp(v);
                if (pr && pr.streamingData && ORIG.has(v)) { pr.streamingData.adaptiveFormats = ORIG.get(v).slice(); prune(pr); }
            } catch (e) {}
        }
    };
})();
