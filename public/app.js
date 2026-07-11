const API = ''; // same origin

const state = {
  id: null,
  videoFile: null,
  videoWidth: 1080,
  videoHeight: 1920,
  words: [], // [{text, start, end}]
};

// ---------- Step navigation ----------
function showPanel(n) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
  document.getElementById(['panel-upload', 'panel-edit', 'panel-export'][n - 1]).classList.remove('hidden');
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === n));
}

// ---------- Upload ----------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  uploadStatus.textContent = 'Uploading & transcribing… this can take a minute depending on video length and model size.';
  uploadStatus.classList.remove('error');

  const form = new FormData();
  form.append('video', file);
  form.append('model', document.getElementById('modelSize').value);

  try {
    const res = await fetch(`${API}/api/transcribe`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transcription failed');

    state.id = data.id;
    state.videoFile = data.videoFile;
    state.videoWidth = data.videoWidth || 1080;
    state.videoHeight = data.videoHeight || 1920;
    state.words = flattenWords(data.segments || []);

    const videoUrl = URL.createObjectURL(file);
    document.getElementById('previewVideo').src = videoUrl;

    renderWordList();
    showPanel(2);
  } catch (err) {
    uploadStatus.textContent = `Error: ${err.message}`;
    uploadStatus.classList.add('error');
  }
}

function flattenWords(segments) {
  const words = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length) {
      for (const w of seg.words) {
        const text = (w.word || '').trim();
        if (text) words.push({ text, start: w.start, end: w.end });
      }
    } else if (seg.text) {
      words.push({ text: seg.text.trim(), start: seg.start, end: seg.end });
    }
  }
  return words;
}

// ---------- Transcript editor ----------
const wordListEl = document.getElementById('wordList');

function renderWordList() {
  wordListEl.innerHTML = '';
  state.words.forEach((w, i) => {
    const span = document.createElement('span');
    span.className = 'word-chip';
    span.contentEditable = 'true';
    span.textContent = w.text;
    span.dataset.index = i;
    span.addEventListener('input', () => {
      state.words[i].text = span.textContent.trim();
    });
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    });
    wordListEl.appendChild(span);
  });
}

// ---------- Fonts ----------
async function loadFonts() {
  const sel = document.getElementById('fontFamily');
  try {
    const res = await fetch(`${API}/api/fonts`);
    const data = await res.json();
    const all = [...(data.custom || []), ...(data.system || [])];
    sel.innerHTML = all.map((f) => `<option value="${f}">${f}</option>`).join('');
  } catch {
    sel.innerHTML = '<option value="Arial">Arial</option>';
  }
}
loadFonts();

// ---------- Style controls ----------
const controls = {
  fontFamily: document.getElementById('fontFamily'),
  fontSize: document.getElementById('fontSize'),
  primaryColor: document.getElementById('primaryColor'),
  outlineColor: document.getElementById('outlineColor'),
  outlineWidth: document.getElementById('outlineWidth'),
  highlightColor: document.getElementById('highlightColor'),
  shadow: document.getElementById('shadow'),
  bold: document.getElementById('bold'),
  italic: document.getElementById('italic'),
  uppercase: document.getElementById('uppercase'),
  background: document.getElementById('background'),
  backgroundColor: document.getElementById('backgroundColor'),
  backgroundOpacity: document.getElementById('backgroundOpacity'),
  position: document.getElementById('position'),
  animation: document.getElementById('animation'),
  wordsPerLine: document.getElementById('wordsPerLine'),
};

// live value labels
const labelPairs = [
  ['fontSize', 'fontSizeVal'], ['outlineWidth', 'outlineWidthVal'], ['shadow', 'shadowVal'],
  ['backgroundOpacity', 'bgOpacityVal'], ['wordsPerLine', 'wordsPerLineVal'],
];
labelPairs.forEach(([inputId, labelId]) => {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  input.addEventListener('input', () => { label.textContent = input.value; updatePreview(); });
});

controls.background.addEventListener('change', () => {
  document.getElementById('bgColorField').style.display = controls.background.checked ? 'grid' : 'none';
  updatePreview();
});

Object.values(controls).forEach((el) => el.addEventListener('input', updatePreview));

function getStyle() {
  return {
    fontFamily: controls.fontFamily.value,
    fontSize: Number(controls.fontSize.value),
    primaryColor: controls.primaryColor.value,
    outlineColor: controls.outlineColor.value,
    outlineWidth: Number(controls.outlineWidth.value),
    highlightColor: controls.highlightColor.value,
    shadow: Number(controls.shadow.value),
    bold: controls.bold.checked,
    italic: controls.italic.checked,
    uppercase: controls.uppercase.checked,
    background: controls.background.checked,
    backgroundColor: controls.backgroundColor.value,
    backgroundOpacity: Number(controls.backgroundOpacity.value),
    position: controls.position.value,
    animation: controls.animation.value,
    wordsPerLine: Number(controls.wordsPerLine.value),
  };
}

// ---------- Live CSS preview (approximation of the ASS render) ----------
const overlay = document.getElementById('captionOverlay');
const video = document.getElementById('previewVideo');

function chunkWords(words, size) {
  const chunks = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size));
  return chunks;
}

function updatePreview() {
  const style = getStyle();
  overlay.style.fontFamily = style.fontFamily;
  overlay.style.fontSize = `${style.fontSize / 2}px`; // scale down for typical preview width
  overlay.style.color = style.primaryColor;
  overlay.style.fontWeight = style.bold ? '800' : '400';
  overlay.style.fontStyle = style.italic ? 'italic' : 'normal';
  overlay.style.webkitTextStroke = `${style.outlineWidth / 2}px ${style.outlineColor}`;
  overlay.style.textShadow = style.shadow > 0
    ? `0 ${style.shadow}px ${style.shadow * 2}px rgba(0,0,0,.8)`
    : 'none';
  overlay.style.top = style.position === 'top' ? '6%' : style.position === 'middle' ? '45%' : 'auto';
  overlay.style.bottom = style.position === 'bottom' ? '8%' : 'auto';
  overlay.style.background = style.background
    ? hexToRgba(style.backgroundColor, style.backgroundOpacity)
    : 'transparent';
  overlay.style.padding = style.background ? '6px 14px' : '0';
  overlay.style.borderRadius = style.background ? '8px' : '0';
  overlay.style.display = 'inline-block';
  overlay.style.left = '5%';
  overlay.style.right = '5%';
  renderActiveChunk();
}

function hexToRgba(hex, opacity) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function renderActiveChunk() {
  const style = getStyle();
  if (!state.words.length) { overlay.innerHTML = ''; return; }
  const chunks = chunkWords(state.words, style.wordsPerLine);
  const t = video.currentTime || 0;
  const chunk = chunks.find((c) => t >= c[0].start && t <= (c[c.length - 1].end + 0.2)) || null;

  if (!chunk) { overlay.innerHTML = ''; return; }

  const text = style.uppercase
    ? chunk.map((w) => w.text.toUpperCase())
    : chunk.map((w) => w.text);

  if (style.animation === 'karaoke') {
    overlay.innerHTML = chunk.map((w, i) => {
      const active = t >= w.start;
      const color = active ? style.highlightColor : style.primaryColor;
      return `<span class="word" style="color:${color}">${text[i]}</span>`;
    }).join(' ');
  } else {
    overlay.innerHTML = `<span class="word active">${text.join(' ')}</span>`;
  }
}

video.addEventListener('timeupdate', renderActiveChunk);
video.addEventListener('loadedmetadata', updatePreview);

// ---------- Render ----------
const renderBtn = document.getElementById('renderBtn');
const renderStatus = document.getElementById('renderStatus');

renderBtn.addEventListener('click', async () => {
  renderBtn.disabled = true;
  renderStatus.classList.remove('error');
  renderStatus.textContent = 'Rendering final video with ffmpeg… this may take a while for longer clips.';

  const payload = {
    id: state.id,
    videoFile: state.videoFile,
    segments: [{ words: state.words }],
    style: getStyle(),
  };

  try {
    const res = await fetch(`${API}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Render failed');

    const url = `${API}/api/download/${data.file}`;
    document.getElementById('resultVideo').src = url;
    document.getElementById('downloadLink').href = url;
    showPanel(3);
  } catch (err) {
    renderStatus.textContent = `Error: ${err.message}`;
    renderStatus.classList.add('error');
  } finally {
    renderBtn.disabled = false;
  }
});

document.getElementById('startOverBtn').addEventListener('click', () => {
  state.id = null;
  state.videoFile = null;
  state.words = [];
  fileInput.value = '';
  uploadStatus.textContent = '';
  showPanel(1);
});

// init
document.getElementById('bgColorField').style.display = 'none';
