/**
 * ASS (Advanced SubStation Alpha) subtitle builder.
 * Generates styled + animated caption files that ffmpeg burns into video
 * via libass (the `ass` video filter).
 *
 * Supported style options (all optional, sensible defaults provided):
 *   fontFamily        - string, must be installed system font or placed in /fonts
 *   fontSize           - number (px, relative to video resolution)
 *   primaryColor        - hex "#RRGGBB" - normal / already-spoken text color
 *   highlightColor      - hex "#RRGGBB" - currently-highlighted word color (karaoke mode)
 *   outlineColor         - hex "#RRGGBB"
 *   outlineWidth         - number
 *   shadow               - number (drop shadow depth, 0 = none)
 *   bold / italic         - boolean
 *   background            - boolean, draw a solid box behind text (CapCut "highlight box")
 *   backgroundColor        - hex "#RRGGBB"
 *   backgroundOpacity       - 0..1
 *   position                - 'top' | 'middle' | 'bottom'
 *   marginV                  - number, vertical margin from edge
 *   animation                 - 'none' | 'fade' | 'pop' | 'slide' | 'karaoke' | 'typewriter'
 *   wordsPerLine               - number of words shown per caption chunk
 *   uppercase                  - boolean
 *   letterSpacing               - number
 *   videoWidth / videoHeight     - actual video resolution (for correct scaling/positions)
 */

function hexToAssColor(hex, opacity = 1) {
  if (!hex) hex = '#FFFFFF';
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const r = hex.substring(0, 2).padEnd(2, '0');
  const g = hex.substring(2, 4).padEnd(2, '0');
  const b = hex.substring(4, 6).padEnd(2, '0');
  const alphaValue = Math.round((1 - opacity) * 255);
  const alpha = Math.max(0, Math.min(255, alphaValue)).toString(16).padStart(2, '0').toUpperCase();
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function formatAssTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds - Math.floor(seconds)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAss(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function applyCase(text, uppercase) {
  return uppercase ? text.toUpperCase() : text;
}

// Accepts either:
//  - segments: [{ start, end, text, words: [{word,start,end}, ...] }, ...]
//  - or a flat pseudo-segment wrapper: [{ words: [...] }]
function flattenWords(segments) {
  const words = [];
  for (const seg of segments || []) {
    if (seg.words && seg.words.length) {
      for (const w of seg.words) {
        const text = (w.word || w.text || '').trim();
        if (!text) continue;
        words.push({ text, start: Number(w.start), end: Number(w.end) });
      }
    } else if (seg.text) {
      words.push({ text: seg.text.trim(), start: Number(seg.start), end: Number(seg.end) });
    }
  }
  return words;
}

function chunkWords(words, perLine) {
  const chunks = [];
  const size = Math.max(1, perLine || 4);
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size));
  }
  return chunks;
}

function dialogueLine(start, end, text) {
  return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
}

function buildASS(segments, style = {}) {
  const {
    fontFamily = 'Arial',
    fontSize = 42,
    primaryColor = '#FFFFFF',
    highlightColor = '#00E5FF',
    outlineColor = '#000000',
    outlineWidth = 3,
    shadow = 1,
    bold = true,
    italic = false,
    background = false,
    backgroundColor = '#000000',
    backgroundOpacity = 0.5,
    position = 'bottom',
    marginV = 60,
    animation = 'karaoke',
    wordsPerLine = 4,
    uppercase = false,
    letterSpacing = 0,
    videoWidth = 1080,
    videoHeight = 1920,
  } = style;

  const alignment = position === 'top' ? 8 : position === 'middle' ? 5 : 2;
  const borderStyle = background ? 3 : 1;
  const primary = hexToAssColor(primaryColor);
  const secondary = hexToAssColor(highlightColor);
  const outline = hexToAssColor(outlineColor);
  const back = hexToAssColor(backgroundColor, background ? backgroundOpacity : 0);

  const header = `[Script Info]
Title: Auto Captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${primary},${secondary},${outline},${back},${bold ? -1 : 0},${italic ? -1 : 0},0,0,100,100,${letterSpacing},0,${borderStyle},${outlineWidth},${shadow},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const words = flattenWords(segments);
  const chunks = chunkWords(words, wordsPerLine);
  const events = [];

  chunks.forEach((chunk, idx) => {
    if (!chunk.length) return;
    const start = chunk[0].start;
    const nextChunk = chunks[idx + 1];
    let end = chunk[chunk.length - 1].end + 0.2;
    if (nextChunk && nextChunk.length && end > nextChunk[0].start) {
      end = nextChunk[0].start;
    }
    if (end <= start) end = start + 0.3;

    if (animation === 'karaoke') {
      // Word-by-word progressive color highlight (the classic TikTok/CapCut look).
      // \k switches a word from SecondaryColour -> PrimaryColour once its time is reached.
      let text = '';
      chunk.forEach((w, i) => {
        const wordDurCs = Math.max(1, Math.round((w.end - w.start) * 100));
        const nextW = chunk[i + 1];
        const gapCs = nextW
          ? Math.max(0, Math.round((nextW.start - w.end) * 100))
          : Math.max(0, Math.round((end - w.end) * 100));
        const k = wordDurCs + gapCs;
        const t = escapeAss(applyCase(w.text, uppercase));
        text += `{\\k${k}}${t} `;
      });
      events.push(dialogueLine(start, end, text.trim()));
    } else if (animation === 'typewriter') {
      const full = chunk.map((w) => applyCase(w.text, uppercase)).join(' ');
      const revealSteps = Math.min(full.length, 14) || 1;
      const revealDur = Math.min(0.4, (end - start) * 0.4);
      for (let i = 1; i <= revealSteps; i++) {
        const charCount = Math.ceil((full.length * i) / revealSteps);
        const partStart = start + (revealDur * (i - 1)) / revealSteps;
        const partEnd = i === revealSteps ? end : start + (revealDur * i) / revealSteps;
        events.push(dialogueLine(partStart, partEnd, escapeAss(full.substring(0, charCount))));
      }
    } else {
      const full = chunk.map((w) => applyCase(w.text, uppercase)).join(' ');
      let tags = '';
      if (animation === 'fade') {
        tags = `{\\fad(150,150)}`;
      } else if (animation === 'pop') {
        tags = `{\\fscx60\\fscy60\\t(0,120,\\fscx108\\fscy108)\\t(120,200,\\fscx100\\fscy100)}`;
      } else if (animation === 'slide') {
        const cx = videoWidth / 2;
        const targetY =
          position === 'top' ? marginV + fontSize : position === 'middle' ? videoHeight / 2 : videoHeight - marginV;
        const startY = targetY + 50;
        tags = `{\\an5\\move(${cx},${startY},${cx},${targetY},0,200)}`;
      }
      events.push(dialogueLine(start, end, `${tags}${escapeAss(full)}`));
    }
  });

  return header + events.join('\n') + '\n';
}

module.exports = { buildASS, hexToAssColor, formatAssTime };
