const express = require('express');
const cors = require('cors');
const path = require('path');
const pino = require('pino');
const sanitize = require('sanitize-filename');
const ytdl = require('ytdl-core');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Configure ffmpeg binary path from installer
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Basic URL allowlist for YouTube domains
function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host.endsWith('youtube.com') ||
      host === 'youtu.be' ||
      host.endsWith('youtube-nocookie.com')
    );
  } catch (_) {
    return false;
  }
}

// Utilities to prefer yt-dlp when available (system or vendored) for robustness
const BIN_DIR = path.join(__dirname, 'bin');
const LOCAL_YTDLP = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ENV_YTDLP = process.env.YTDLP_PATH || '';
let cachedYtDlpPath = null;

async function pathExists(p) { try { await fsp.access(p, fs.constants.X_OK); return true; } catch { return false; } }

async function ensureYtDlp() {
  if (cachedYtDlpPath) return cachedYtDlpPath;
  // If explicitly provided via env, prefer it
  if (ENV_YTDLP && await pathExists(ENV_YTDLP)) { cachedYtDlpPath = ENV_YTDLP; return cachedYtDlpPath; }
  // Try system yt-dlp
  const sysOk = await new Promise(resolve => {
    const p = spawn('yt-dlp', ['--version']);
    let resolved = false;
    p.once('error', () => { if (!resolved) { resolved = true; resolve(false); } });
    p.once('exit', code => { if (!resolved) { resolved = true; resolve(code === 0); } });
  });
  if (sysOk) { cachedYtDlpPath = 'yt-dlp'; return cachedYtDlpPath; }

  // Try local vendored binary
  if (await pathExists(LOCAL_YTDLP)) { cachedYtDlpPath = LOCAL_YTDLP; return cachedYtDlpPath; }

  // Attempt download to local bin
  try {
    await fsp.mkdir(BIN_DIR, { recursive: true });
    await YTDlpWrap.downloadFromGithub(LOCAL_YTDLP);
    cachedYtDlpPath = LOCAL_YTDLP;
    return cachedYtDlpPath;
  } catch (e) {
    // Could not download (no network, etc.)
    return null;
  }
}

function spawnYtDlpAudio(ytDlpPath, url) {
  // Stream best available audio to stdout
  return spawn(ytDlpPath, [
    '-f', 'bestaudio/best',
    '-o', '-',
    '--no-playlist',
    '--quiet',
    '--no-warnings',
    url
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function getVideoInfoYtDlp(ytDlpPath, url) {
  return new Promise((resolve, reject) => {
    execFile(ytDlpPath, ['-J', '--no-playlist', '--no-warnings', url], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        resolve({
          title: data.title || data.fulltitle,
          uploader: data.uploader || data.channel,
          channel: data.channel || data.uploader,
          id: data.id
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Fetch basic video info via ytdl-core (fallback)
async function getVideoInfoYtdl(url) {
  const info = await ytdl.getInfo(url);
  const v = info && info.videoDetails ? info.videoDetails : {};
  return {
    title: v.title,
    uploader: v.author && v.author.name,
    channel: v.ownerChannelName || (v.author && v.author.name),
    id: v.videoId
  };
}

function extractIdFromUrl(url) {
  try { return ytdl.getURLVideoID(url); } catch { return ''; }
}

app.post('/api/convert', async (req, res) => {
  const { url, bitrate } = req.body || {};

  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({
      error: 'Invalid or missing YouTube URL.'
    });
  }

  const targetBitrate = Number(bitrate) || 320; // kbps, default 320
  if (targetBitrate < 64 || targetBitrate > 320) {
    return res.status(400).json({ error: 'Bitrate must be between 64 and 320 kbps.' });
  }

  let info;
  let ytDlpPath = await ensureYtDlp();

  try {
    info = ytDlpPath ? await getVideoInfoYtDlp(ytDlpPath, url) : await getVideoInfoYtdl(url);
  } catch (e) {
    logger.warn({ err: e }, ytDlpPath ? 'yt-dlp info failed' : 'ytdl-core info failed');
    // Try the other method once
    try {
      if (ytDlpPath) info = await getVideoInfoYtdl(url); else {
        ytDlpPath = await ensureYtDlp();
        if (!ytDlpPath) throw new Error('yt-dlp unavailable');
        info = await getVideoInfoYtDlp(ytDlpPath, url);
      }
    } catch (e2) {
      logger.error({ err: e2 }, 'Failed to fetch video info; proceeding without metadata');
      info = null;
    }
  }

  const title = (info && (info.title)) || 'audio';
  const artist = (info && (info.uploader || info.channel)) || 'YouTube';
  const id = (info && info.id) || extractIdFromUrl(url) || '';
  const baseName = sanitize(`${title}${artist ? ' - ' + artist : ''}`.trim()) || 'audio';
  const fileName = sanitize(`${baseName}${id ? ' [' + id + ']' : ''}.mp3`);

  // Set response headers before streaming
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  // Create source audio stream via yt-dlp (preferred) or ytdl-core fallback
  let sourceStream;
  let ytDlpProc;
  if (ytDlpPath) {
    ytDlpProc = spawnYtDlpAudio(ytDlpPath, url);
    sourceStream = ytDlpProc.stdout;
    ytDlpProc.stderr?.on('data', d => logger.debug({ ytDlp: d.toString() }));
    ytDlpProc.once('error', err => onFatal(err, undefined, 'yt-dlp'));
    ytDlpProc.once('exit', code => {
      if (!responded && code !== 0) onFatal(new Error('yt-dlp exited non-zero'), code, 'yt-dlp');
    });
  } else {
    sourceStream = ytdl(url, {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25
    });
    sourceStream.once('error', err => onFatal(err, undefined, 'ytdl-core'));
  }

  let responded = false;

  const onFatal = (err, code, where) => {
    if (responded) return;
    responded = true;
    logger.error({ err, code, where }, 'Conversion failed');
    try { res.status(500).end(); } catch (_) {}
    try { sourceStream.destroy?.(); } catch (_) {}
    try { ytDlpProc && ytDlpProc.kill('SIGKILL'); } catch (_) {}
  };

  // If client aborts, stop processing
  req.on('aborted', () => {
    try { sourceStream.destroy?.(); } catch (_) {}
    try { ytDlpProc && ytDlpProc.kill('SIGKILL'); } catch (_) {}
  });

  // Build ffmpeg pipeline
  try {
    const cmd = ffmpeg(sourceStream)
      .inputOptions(['-vn'])
      .audioCodec('libmp3lame')
      .audioBitrate(targetBitrate)
      .outputOptions([
        '-map_metadata', '0',
        `-metadata`, `title=${title}`,
        `-metadata`, `artist=${artist}`
      ])
      .format('mp3')
      .on('start', commandLine => {
        logger.info({ commandLine }, 'ffmpeg started');
      })
      .on('error', (err, _stdout, _stderr) => onFatal(err, undefined, 'ffmpeg'))
      .on('end', () => {
        responded = true;
        logger.info('Streaming finished');
      });

    cmd.pipe(res, { end: true });
  } catch (err) {
    onFatal(err, undefined, 'pipeline');
  }
});

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT}`);
});
