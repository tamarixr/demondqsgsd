const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile, spawn } = require('child_process');
const { buildASS } = require('./services/ass');

const app = express();
const PORT = process.env.PORT || 4000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const FONTS_DIR = path.join(__dirname, 'fonts');

[DATA_DIR, UPLOAD_DIR, OUTPUT_DIR, FONTS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/fonts', express.static(FONTS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } });

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function ffprobeDimensions(videoPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', videoPath],
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const data = JSON.parse(stdout);
          const s = data.streams[0];
          resolve({ width: s.width, height: s.height });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function runPython(scriptArgs) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', scriptArgs);
    let out = '';
    let errOut = '';
    py.stdout.on('data', (d) => (out += d.toString()));
    py.stderr.on('data', (d) => (errOut += d.toString()));
    py.on('close', (code) => {
      if (code !== 0) return reject(new Error(errOut || `python exited with code ${code}`));
      resolve(out);
    });
  });
}

// List available fonts: custom .ttf/.otf dropped into /server/fonts, plus common system fonts.
app.get('/api/fonts', (req, res) => {
  const custom = fs.existsSync(FONTS_DIR)
    ? fs.readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.parse(f).name)
    : [];
  const system = [
    'Arial', 'Impact', 'Verdana', 'Georgia', 'Comic Sans MS',
    'Trebuchet MS', 'Times New Roman', 'Courier New', 'Tahoma', 'Helvetica',
  ];
  res.json({ custom, system });
});

// Step 1: upload video, extract audio, run word-level transcription.
app.post('/api/transcribe', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'video file required' });
    const videoPath = req.file.path;
    const id = path.basename(videoPath, path.extname(videoPath));
    const audioPath = path.join(UPLOAD_DIR, `${id}.wav`);
    const modelSize = req.body.model || 'base';

    await runFFmpeg(['-y', '-i', videoPath, '-ac', '1', '-ar', '16000', '-vn', audioPath]);

    const scriptPath = path.join(__dirname, 'services', 'transcribe.py');
    const out = await runPython([scriptPath, audioPath, modelSize]);
    const data = JSON.parse(out);

    const dims = await ffprobeDimensions(videoPath).catch(() => ({ width: 1080, height: 1920 }));

    res.json({
      id,
      videoFile: path.basename(videoPath),
      videoWidth: dims.width,
      videoHeight: dims.height,
      ...data,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Step 2: build styled ASS captions and burn them into the video.
app.post('/api/render', async (req, res) => {
  try {
    const { id, videoFile, segments, style } = req.body;
    if (!id || !videoFile || !segments) {
      return res.status(400).json({ error: 'id, videoFile and segments are required' });
    }
    const videoPath = path.join(UPLOAD_DIR, videoFile);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'video not found, re-upload' });

    const dims = await ffprobeDimensions(videoPath).catch(() => ({ width: 1080, height: 1920 }));
    const mergedStyle = { videoWidth: dims.width, videoHeight: dims.height, ...(style || {}) };

    const assPath = path.join(OUTPUT_DIR, `${id}.ass`);
    const assContent = buildASS(segments, mergedStyle);
    fs.writeFileSync(assPath, assContent, 'utf8');

    const outId = uuidv4();
    const outPath = path.join(OUTPUT_DIR, `${outId}.mp4`);

    // Escape for ffmpeg filter graph (colons and backslashes are special inside filter args)
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const escapedFontsDir = FONTS_DIR.replace(/\\/g, '/').replace(/:/g, '\\:');
    const vf = `ass=${escapedAss}:fontsdir=${escapedFontsDir}`;

    await runFFmpeg([
      '-y', '-i', videoPath,
      '-vf', vf,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
      '-c:a', 'copy',
      outPath,
    ]);

    res.json({ downloadId: outId, file: `${outId}.mp4` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/download/:file', (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.download(filePath);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Auto-caption server running on http://localhost:${PORT}`);
});
