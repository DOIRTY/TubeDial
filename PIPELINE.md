# The page pipeline — how TubeDial is built and how to change it

The page engine is not one big script. It is a **kernel plus numbered stages**, listed (and
therefore ordered) in `TubeDial/manifest.json` → `content_scripts[0].js`:

```
core.js                  the kernel: settings (the ONLY place they are parsed), plan(), video
                         memory, toasts, the popup link, and the tiny bus stages use
engine/20-formats.js     owns every format interception (JSON.parse, fetch,
                         ytInitialPlayerResponse) and trims the quality list to the plan
engine/30-veto.js        owns the "can this play?" answers (isTypeSupported / canPlayType)
                         and watches addSourceBuffer to know what is really being fed
engine/40-playback.js    owns the player: starting quality (before it exists), per-video
                         enforcement, live badges, the watchdog and the soft switch
engine/50-thumbs.js      owns image URLs: thumbnails, Shorts, channel pictures, the src hooks
engine/60-preview.js     owns the hover-preview signal and its quality
engine/70-audio.js       owns the player's SOUND graph: clean → stabilize → boost, order = data
bridge.js                (isolated world) moves settings / diagnostics between popup and page
```

## The two rules that stop stages from fighting

1. **One resource, one owner.** The table above is the full ownership map — a stage never
   touches a DOM/API entry point that another stage owns. That is why a rewrite of
   `setAttribute` or a quality call can never happen twice from two places.
2. **Stages don't know each other.** Everything goes through the kernel `K = window.__YTLK`:
   - `K.S` — current settings, already sanitized. Stages read, never write (only the popup
     link updates them, via `K.setSettings`).
   - `K.on('settings', fn)` — run again whenever settings change. That's the live-reconfig path.
   - `K.reply(kind, fn)` — answer a popup message (`status`, `softReload`, …); `fn` returns
     the payload that goes back.
   - `K.svc.<name>` — the few things other stages may call (`K.svc.formats.reprime(v)`,
     `K.svc.veto.clearBlocked()`).
   - `K.rt` — the shared runtime bag: who owns which key is written next to each key.
   - Everything else a stage declares stays inside its IIFE. If it isn't on `K`, nobody else
     can see it.

## Adding a stage (the whole recipe)

1. Create `engine/65-mystage.js`:

```js
// STAGE: my-stage — one sentence about what it owns. Made with the help of AI.
(function () {
    'use strict';
    const K = window.__YTLK; if (!K) return;                    // kernel missing (bad load order): inert
    function doThing() { /* read K.S, act, that's it */ }
    K.on('settings', doThing);                                  // react to popup changes
    doThing();                                                  // run once at document_start
})();
```

2. Add `"engine/65-mystage.js"` to the `js` array in `manifest.json`, between 60 and 70.
   **The number is the run order** — rename/reposition to reorder, delete the line to remove.
3. If it has a setting: add a default to `DEFAULTS` in `core.js`, **and** sanitize it in
   `merge()` there (hostile input rule: only known keys, clamped values, built fresh), mirror
   the rule in `popup.js` (`DEFAULTS` + `migrate()`), and render a control in `popup.html`.
4. Tests are the gate: `cd tests && npm install && npm test`. The harness loads the exact
   manifest list, so your new stage is under test in all four suites the moment it's in the
   manifest. Add a section to `tests/fuzz.test.js` if the stage gets input from the page.

## The audio chain specifically

`engine/70-audio.js` builds a Web Audio graph for the main `<video>` and wires **exactly the
stages your setting lists, in that order**: `clean` (a soft gate, not AI), `stabilize`
(compressor + makeup), `boost` (gain into a limiter). The order lives in `S.audio.order`, so
reordering needs no code; skipping all stages (or turning the chain off) bypasses the graph.
The stage keeps one `WeakSet` of elements it already owns — if another tool grabbed the audio
first, it reports that and leaves it alone instead of fighting over the element. A new sound
stage (e.g. `deecho`) is: one `build()` case, its name in `AUDIO_STAGES` (core + popup), one
UI row. Nothing else knows about it.

## What deliberately did NOT change in the rebuild

All behavior of v1.1 was carried across line-by-line (the same 117 checks of the original
suites still pass unchanged against the pipeline, plus the fuzz suite). `main.js` was split,
not rewritten: same sanitizer semantics, same plan math, same hooks, same messages.
