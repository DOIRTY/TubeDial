// Applies the saved theme before the popup paints (no white/black flash).
(function () {
    var ui = { theme: 'system', accent: 'green' };
    try { var s = JSON.parse(localStorage.getItem('tdUi')); if (s) { ui.theme = s.theme || ui.theme; ui.accent = s.accent || ui.accent; } } catch (e) {}
    var light = false;
    try { light = matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {}
    var r = document.documentElement;
    r.setAttribute('data-theme', ui.theme === 'system' ? (light ? 'light' : 'dark') : ui.theme);
    r.setAttribute('data-accent', ui.accent);
})();
