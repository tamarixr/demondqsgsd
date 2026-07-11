# CaptionForge — Auto Caption Maker

A self-hosted, CapCut-style auto-caption tool: upload a video, it transcribes speech with
word-level timestamps, you style the captions (font, size, color, outline, box background,
position) and pick an animation (word-by-word karaoke highlight, fade, pop, slide, typewriter),
then it burns the captions permanently into the video with ffmpeg.

Everything runs locally on your machine — no cloud API keys, no per-minute fees.

## How it works

1. **Node/Express server** (`server/`) handles uploads, orchestrates ffmpeg, and serves the frontend.
2. **faster-whisper** (Python) transcribes the audio and returns word-level timestamps.
3. A custom **ASS subtitle generator** (`server/services/ass.js`) turns your style choices into
   a real `.ass` subtitle file — using native libass features (karaoke tags `\k`, transforms
   `\t`, movement `\move`, fades `\fad`) for smooth, GPU-cheap animation.
4. **ffmpeg** burns the `.ass` file into the video via the `ass` filter (libass), producing a
   final MP4 with hardcoded captions.
5. The **frontend** (`public/`) is a single-page app: drag-and-drop upload → live preview with
   an approximate CSS re-creation of your caption style, synced to the video → editable
   word-by-word transcript → render & download.

## Requirements

Install these on your machine before running:

- **Node.js 18+**
- **Python 3.9+**
- **ffmpeg** compiled with `--enable-libass` (the default in almost all prebuilt ffmpeg
  packages, including `apt install ffmpeg`, `brew install ffmpeg`, and the official
  Windows builds from ffmpeg.org)
- **faster-whisper** Python package:
  ```bash
  pip install faster-whisper
  ```
  The first time you transcribe with a given model size, it downloads the model
  (a few hundred MB) — this requires an internet connection once, then it's cached locally.

## Setup

```bash
cd server
npm install
npm start
```

Then open **http://localhost:4000** in your browser.

## Adding custom fonts

Drop any `.ttf` or `.otf` file into `server/fonts/`. It will automatically appear in the
font dropdown in the UI (ffmpeg is told to look in that folder via `fontsdir`, so you don't
need to install fonts system-wide).

## Customization options (CapCut-equivalent feature list)

| Feature | Where |
|---|---|
| Font family (system + custom uploaded fonts) | Style panel → Font |
| Font size | Style panel → Font size |
| Text color | Style panel → Text color |
| Outline color & width | Style panel → Outline color / width |
| Drop shadow depth | Style panel → Shadow |
| Bold / Italic | Style panel checkboxes |
| UPPERCASE transform | Style panel checkbox |
| Background "pill"/box behind text, with adjustable color + opacity | Style panel → Background box |
| Position (top / middle / bottom) | Style panel → Position |
| Animation: word-by-word highlight (karaoke), fade, pop/bounce, slide-up, typewriter, none | Style panel → Animation |
| Highlight color for the currently-spoken word | Style panel → Highlight color |
| Words per caption line/chunk | Style panel → Words per line |
| Per-word manual text editing (fix transcription mistakes) | Transcript editor |
| Transcription quality/model size (tiny → medium) | Upload step |

## API endpoints (if you want to script it or build your own frontend)

- `POST /api/transcribe` — multipart form, field `video` (file) and `model` (string:
  `tiny|base|small|medium`). Returns `{ id, videoFile, videoWidth, videoHeight, language, segments }`
  where each segment has word-level `{ word, start, end }` entries.
- `GET /api/fonts` — returns `{ custom: [...], system: [...] }` font names available.
- `POST /api/render` — JSON body `{ id, videoFile, segments, style }`. `segments` can just be
  `[{ words: [...] }]` with your edited word list. Returns `{ downloadId, file }`.
- `GET /api/download/:file` — downloads the rendered MP4.

## Notes & tips

- Bigger whisper models (`small`, `medium`) are noticeably more accurate but slower on CPU.
  `base` is a good default for most content.
- The karaoke word-highlight look (the default) is achieved with ASS's native `\k` karaoke
  tags — this is the same rendering technique many auto-caption apps use, and it's cheap to
  render since libass (inside ffmpeg) does the animation, not a re-encode per word.
- Rendering time scales with video length and resolution — burning captions requires a full
  re-encode of the video stream (`libx264`), while audio is stream-copied for speed.
- All uploads and outputs are stored in `server/data/` — feel free to clear that folder
  periodically.

## Project structure

```
autocaption/
├── server/
│   ├── index.js              # Express server, upload/transcribe/render/download routes
│   ├── services/
│   │   ├── ass.js            # Style + animation → ASS subtitle file generator
│   │   └── transcribe.py     # faster-whisper word-level transcription
│   ├── fonts/                 # drop custom .ttf/.otf files here
│   ├── data/uploads, data/output  # runtime storage (gitignored)
│   └── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js                # upload, style controls, live preview, render flow
└── README.md
```
