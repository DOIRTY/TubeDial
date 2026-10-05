// STAGE: thumbs — every picture on the page except the video itself. Single owner of the two
// entry points images have (the HTMLImageElement.src setter and setAttribute) plus the mutation
// sweep for already-rendered nodes; rewrites ytimg/ggpht URLs to the biggest real size that is
// still at or under the wanted height (never an upscaled blur, never a bigger picture), and puts
// the crop marker on when a 4:3 file gets shown in a 16:9 box. Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;
    const S = function () { return K.S; };
    const mk = K.mk;

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
            const choice = tall ? pick(TALL_STEPS, S().shortsThumbH) : pick(WIDE_STEPS, S().thumbH);
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
        if (S().stillHover) {
            m = u.match(AN_RE);
            if (m) {                                            // the tile's own still picture (already downloaded)
                const r = lower('https://i.ytimg.com/vi/' + m[1] + '/hq720.jpg', el);
                return r[0].indexOf('/hq720.jpg') !== -1 ? ['https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg', true, false] : r;
            }
        }
        if (S().channelImages) {
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
})();
