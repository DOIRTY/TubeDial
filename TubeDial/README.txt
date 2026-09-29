TubeDial — Smart Quality for YouTube   v1.0 (Brave / Chrome extension)
=====================================================================

Same quality for less data, smoother playback on older computers, or
always the best picture: you choose. Zero extra requests to YouTube.

INSTALL
 1. Unzip somewhere permanent (e.g. Documents\tubedial).
 2. brave://extensions -> turn ON "Developer mode" -> "Load unpacked" -> pick the folder.
 3. Pin the icon (puzzle-piece menu).
 4. Violentmonkey: keep "YouTube Prefer AV1" and "YouTube Low-Data Thumbnails" OFF.

UPDATING FROM ANY EARLIER VERSION (keeps all your settings, choices and memory)
 Copy the new files INTO your existing extension folder (replace them),
 then press the reload arrow on the extension's card in brave://extensions
 and refresh YouTube. Don't "Remove" the old one and don't load a new
 folder: that creates a new extension with empty settings.
 Note: the new defaults are thumbnails 270p and previews 360p. If you
 used the old low-data defaults, open the popup and click "Data saver".

QUICK SETUP (one click, sets everything; you can fine-tune afterwards)
 Smart         Same quality, less data. Picks the most efficient codec your
               device plays in hardware. YouTube picks the quality.
 Data saver    New videos start at 480p, light thumbnails, 144p previews,
               still hover thumbnails. For limited/throttled plans.
 Max savings   New videos start at 144p, smallest thumbnails, hover previews
               OFF. For the last megabytes of the month.
 Best quality  New videos start at their best quality, full-size images.
 Smooth        H.264 then VP9, 30fps: easiest to play for older or slower
               computers (fixes stutter and high CPU use).
 None of them remove qualities from YouTube's gear menu (only Smooth's
 30fps limit hides the 60fps versions).
 Live streams keep codec "Auto" (except Smooth), so they never get format errors.

YOUR DEVICE (Stats tab)
 The popup asks the browser, locally, whether this computer decodes
 AV1 / VP9 / H.264 in hardware (smooth, battery-friendly) or software.
 Smart and Best quality use AV1 only if it is hardware-decoded,
 otherwise VP9. Data saver and Max savings use AV1 whenever it's supported,
 because at 480p and below software decoding is light.
 If a video stutters in AV1, pick Smooth or set VP9 as 1st choice.

LOOK & FEEL
 Palette button (top right): theme Auto (follows Windows) / Dark / Light,
 and 7 colors (Mint, Sky, Violet, Teal, Amber, Rose, Ruby).

SEE EXACTLY WHAT A PRESET CHANGED
 Clicking a preset (Now or Playback tab) animates every control to its new
 value and opens a "what changed" list: each setting, old -> new, and what it
 means (e.g. "≈30 -> 15 KB per picture (−50%)"), with an Undo button.
 "Your setup" on the Now tab updates live. Tabs with changed settings get a
 dot; opening them highlights the changed cards.

COPY SETTINGS TO OTHER TYPES (Playback tab)
 Pick which types receive the current type's settings (all are selected;
 tap one to leave it out). Each shows "Same" or what differs, live.
 The button copies, then shows "All types already match" until you change
 something again.

POPUP TABS
 NOW       Live controls for the video you're watching (Shorts too, no refresh):
           - Now playing: Codec (e.g. AV1, av01.0.05M.08), Resolution (e.g.
             720p, 720x1280) and Framerate (e.g. 30 fps), read live from the
             player itself. Plus the video's full quality range and framerates.
           - Auto, then one row per codec (AV1 / VP9 / H.264) listing the
             qualities that really exist in that codec, e.g. "1080p60".
             Solid = in YouTube's menu: switches instantly.
             Dashed with an arrow = another codec: the player re-opens this
             video in that codec at the same spot (about a second, NO page
             refresh), starting right at that quality. A codec you pick for a
             video is used for ALL of its qualities, so it can't fall back.
           - "Start all Shorts/videos at 240p" makes it your starting quality.
           - Framerate for this video: only the rates it really has (e.g.
             30 / 60), each with the best resolution you get at it
             ("30 fps - up to 480p"). Switches in place the same way.
           - "Reset this video" drops your per-video choices.
 PLAYBACK  Quick setup + separate settings for Videos / Shorts / Live / Embedded:
           1st/2nd codec (AV1 / VP9 / H.264 / Auto), starting quality
           (YouTube decides / 144p..1440p / Best), framerate limit 24..60/Any.
           On-page notices, auto-reload countdown (Never/3/5/10/15s).
 IMAGES    Thumbnails, Shorts thumbnails, hover previews, still hover,
           channel pictures (see below).
 STATS     Your device's decoders, and your own numbers: % of the videos you
           watched that have AV1 / VP9 / H.264 / 60fps / 4K, and what they played in.

IMAGES: CUSTOM SIZES THAT REALLY SAVE DATA
 YouTube only makes a few fixed picture sizes, so a typed number (e.g. 40,
 120, 200) uses the largest real size at or below it (the smallest one if
 your number is lower). Every step down is a genuinely smaller download,
 never a blurred copy of a big picture. The popup says what is used.
   Video thumbnails:  68p ~4 KB | 180p ~15 KB | 270p ~30 KB | 360p ~55 KB | Original ~100 KB
   Shorts thumbnails: 90p ~4 KB | 180p ~15 KB | 360p ~30 KB | 480p ~55 KB | Original ~90 KB
   (The picture the Shorts PLAYER shows for a split second before a Short starts
    is left as YouTube made it; a smaller copy showed as a small picture with black bars.)
   (720 or more = Original. Sizes are approximate.)
 It never switches to a bigger picture than YouTube asked for.

 Hover preview videos: Off, 144p..1080p, any typed number (largest real
 quality at or below it; 144p is the lowest), or YouTube's default.
   OFF = the preview video is never requested: the extension stops the
   "mouse is resting on a thumbnail" signal before YouTube sees it.
   Menus and buttons on thumbnails still work. Clicking still opens the video.
 Still hover thumbnails: ON = the moving pictures in search results are
   never downloaded; the tile keeps the still picture that's already on
   screen, so hovering costs zero data.

ON-PAGE NOTICES
 - A video fails to start in your codec -> notice with a countdown,
   "Reload now" and "Cancel". Countdown pauses in background tabs.
   At most once per video. Set auto-reload to "Never" to reload only by click.
 - A video supports your preferred codec but plays in another one
   (e.g. the first Short of a session) -> tip with a "Reload" button.

STARTING QUALITY (per content type; "YouTube decides" by default)
 YouTube decides   Nothing is changed: YouTube's own gear-menu setting picks.
 144p .. 1440p     New videos LOAD STRAIGHT AT this quality: no few seconds of a
                   higher quality first (it uses YouTube's own saved-quality
                   setting, which the player reads before downloading anything).
 Best              New videos start at their highest quality.
 Every quality stays in YouTube's gear menu. Pick another one and it stays
 for that video; the next video starts at your starting quality again.
 If a video doesn't go that high, it starts at its best.
 Shorts have no quality menu, so they simply play at this quality.

ONE CODEC PER VIDEO
 Each video plays in ONE codec: your 1st choice whenever the video has it,
 otherwise the next in your order. Quality never changes the codec - change the
 size in YouTube's own gear menu (or set a starting quality, e.g. for Shorts);
 the video stays in your codec.
 Example: AV1 144p-720p, VP9 up to 4K -> AV1 (gear menu shows 144p-720p).
 Even if your codec has only ONE quality it is used (AV1 360p uses about the
 same data as VP9 240p). Only exception: the "Best quality" preset (start at
 4320) takes the codec with the highest quality.
 Want another codec for one video? Tap it in the Now tab.
 A codec your browser can't decode at all is skipped automatically (e.g. AV1 in
 Edge on Windows needs Microsoft's free "AV1 Video Extension" from the Store).

FRAMERATE LIMIT (the only setting that hides versions)
 YouTube has no framerate choice, so the limit hides the smoother versions:
 with 30 the gear menu shows 1080p instead of 1080p60. "Any" (default)
 keeps everything. You can change it for one video under Now -> This video only.

CAN A SETTING CAUSE AN ERROR?
 Starting quality / framerate: no. Every video has 30fps-or-lower versions.
 Codec: only the first time you open a video that lacks your 1st choice
 and the extension couldn't know yet -> notice + one reload, remembered.
 Live streams: codec/framerate only once the formats are known -> no errors.

WHAT IT NEVER DOES
 No extra requests to YouTube, no downloading, doesn't touch ads, views,
 likes or comments. It only picks among the formats YouTube already offers,
 like the player's own quality menu.

PRIVACY
 TubeDial collects nothing and sends nothing anywhere. It makes no network
 requests of its own (not even to YouTube). Settings and the dashboard numbers
 are stored only in your browser and are removed when you uninstall it.

WHAT TUBEDIAL DOES NOT DO
 It does not block ads, download videos, skip anything, use YouTube's API or
 unlock anything. It only chooses among the video formats and picture sizes
 YouTube itself offers to your browser, like choosing a quality in the gear menu.

DISCLAIMER
 TubeDial is an independent project. It is not affiliated with, endorsed by or
 sponsored by YouTube or Google. YouTube is a trademark of Google LLC.
