// STAGE: preview — the little video that pops up when you rest the mouse on a thumbnail, and
// the "off" switch for it. Owner of the hover signal: with previews off, YouTube never even
// learns the mouse is resting there, so nothing is requested at all. Otherwise the preview
// player gets the quality you chose, same ladder as everything else. Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;
    const S = function () { return K.S; };
    const mk = K.mk;

    const PQ = [[144, 'tiny'], [240, 'small'], [360, 'medium'], [480, 'large'], [720, 'hd720'], [1080, 'hd1080'], [1440, 'hd1440'], [2160, 'hd2160']];
    function previewQ() {
        const n = +S().previewH || 0;
        if (n <= 0) return null;
        let q = PQ[0][1];
        for (let i = 0; i < PQ.length; i++) if (PQ[i][0] <= n) q = PQ[i][1];
        return q;
    }
    function previewsOff() { return +S().previewH === -1; }
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
    (function addCss() {
        try {
            const root = document.head || document.documentElement;
            if (!root) { setTimeout(addCss, 10); return; }
            root.appendChild(mk('style', null, 'html[data-tw-nopreview] ytd-video-preview,html[data-tw-nopreview] #video-preview{display:none!important}'));
        } catch (e) {}
    })();
    function applyFlags() {
        try { document.documentElement.toggleAttribute('data-tw-nopreview', previewsOff()); } catch (e) {}
    }
    applyFlags();
    K.on('settings', applyFlags);                               // a popup switch lands here too
    function isPreview(p) {
        if (!p || p.id === 'shorts-player' || p.id === 'movie_player') return false;
        if (p.id === 'inline-preview-player') return true;
        return !!(p.closest && p.closest('ytd-video-preview, #video-preview, #inline-player, ytd-thumbnail, ytd-rich-grid-media, ytd-inline-player'));
    }
    function applyPreview(p) {
        const Q = previewQ();
        if (!Q) return;
        try { if (typeof p.getPlaybackQuality === 'function' && p.getPlaybackQuality() === Q) return; } catch (e) {}
        K.player.setQuality(p, Q);
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

    K.svc.preview = { off: previewsOff };
})();
