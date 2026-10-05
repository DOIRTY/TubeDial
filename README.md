<p align="center"><img src="images/logo-300x300.png" width="96" alt="TubeDial"></p>

<h1 align="center">TubeDial</h1>
<p align="center">Control framerate, resolution and codec on YouTube — for the highest quality or the lowest internet usage.</p>

<p align="center"><img src="images/screenshot-1-now.png" width="720" alt="TubeDial"></p>

## Features

- **Codec** — prefer AV1, VP9 or H.264. AV1 gives the same picture for less data.
- **Starting quality** — pick the quality videos, Shorts, live streams and embeds start at.
- **Framerate limit** — e.g. 30 fps for slower computers.
- **Now tab** — see and switch the current video's codec, quality and framerate, without refreshing.
- **Lighter images** — smaller thumbnails and hover previews, or turn previews off.
- **Presets** — Smart, Data saver, Max savings, Best quality, Smooth.

## Install

1. Download the latest **TubeDial release zip** from [Releases](../../releases/latest) and unzip it.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the **TubeDial** folder.
5. Firefox: open `about:debugging`, "Load Temporary Add-on…" and pick `TubeDial/manifest.json`.

Works in Brave, Chrome, Edge, Opera and Vivaldi on computers, and in Firefox 114+ (temporary add-on).

## Privacy

TubeDial collects nothing, sends nothing and makes no network requests. Settings stay in your browser.
It doesn't block ads or download videos — it only chooses among the formats YouTube already provides.

## Contributing

Free for everyone, for anything: copy it, change it, fix it, rebrand it, **sell it** — the whole
project is released to the public domain (Unlicense), and there is nothing left to ask permission for.
Even the "Made with the help of AI" lines are just comments: reuse the code with or without them.
Found a bug or have an idea? Open an [issue](../../issues). Want to improve it? Send a pull request.

Tests: `cd tests && npm install && npm test` (engine, thumbnails, popup and fuzz suites — hostile
settings, corrupt storage and parser input get checked there too; all suites must end with `0 fail`).

Made with the help of AI — idea, design, testing and decisions by DOIRTY.

---

<sub>Not affiliated with YouTube or Google. YouTube is a trademark of Google LLC.</sub>
