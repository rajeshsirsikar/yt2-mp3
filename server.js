const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const playdl = require('play-dl');
const path = require('path');
const sanitize = require('sanitize-filename');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [
        'https://yt2-mp3.com',
        'https://www.yt2-mp3.com'
      ]
    : ['http://localhost:3000']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'YouTube to MP3 API is running' });
});

function expandHomeSegments(spec = '') {
  if (!spec.includes('~')) {
    return spec;
  }

  const home = os.homedir();
  if (!home) {
    return spec;
  }

  return spec.replace(/(^|:)~(?=\/|$)/g, (_, prefix) => `${prefix}${home}`);
}

function loadCookieHeaderFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const cookies = new Map();

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const parts = trimmed.split('\t');
      if (parts.length < 7) {
        continue;
      }

      const name = parts[5];
      const value = parts[6];
      if (!name) {
        continue;
      }

      cookies.set(name, value);
    }

    if (!cookies.size) {
      return null;
    }

    return Array.from(cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  } catch (error) {
    console.warn('Failed to read cookie file %s: %s', filePath, error.message);
    return null;
  }
}

function configurePlayDlTokens() {
  if (process.env.YTDLP_NO_COOKIES === '1') {
    console.log('play-dl cookies disabled via YTDLP_NO_COOKIES');
    return;
  }

  const inlineCookie = process.env.PLAYDL_YOUTUBE_COOKIE
    || process.env.YOUTUBE_COOKIE_HEADER
    || process.env.YTDLP_COOKIE_HEADER;

  if (inlineCookie) {
    playdl.setToken({ youtube: { cookie: inlineCookie } });
    console.log('play-dl cookies configured from inline header');
    return;
  }

  const cookieFileEnv = process.env.PLAYDL_COOKIES_FILE || process.env.YTDLP_COOKIES_FILE;
  if (!cookieFileEnv) {
    console.log('play-dl cookies not configured; restricted videos may fail');
    if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
      console.log('YTDLP_COOKIES_FROM_BROWSER is set, but automatic browser extraction is not supported with play-dl. Export a Netscape cookie jar and point PLAYDL_COOKIES_FILE to it.');
    }
    return;
  }

  const expanded = expandHomeSegments(cookieFileEnv);
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    console.warn('Cookie file not found at %s', resolved);
    return;
  }

  const header = loadCookieHeaderFromFile(resolved);
  if (!header) {
    console.warn('Cookie file at %s did not yield any cookies', resolved);
    return;
  }

  playdl.setToken({ youtube: { cookie: header } });
  console.log('play-dl cookies configured from %s', resolved);
}

configurePlayDlTokens();

// Function to get video metadata using play-dl
async function getVideoInfo(url) {
  const info = await playdl.video_basic_info(url);
  const details = info?.video_details || {};
  const uploader = details.channel?.name || details.channel || details.author?.name || '';

  return {
    title: details.title || 'Unknown',
    uploader: uploader || 'Unknown',
    id: details.id || '',
    duration: Number(details.durationInSec) || 0
  };
}

function extractErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }

  const message = String(error.message || error);
  if (/sign in to confirm/i.test(message)) {
    return 'YouTube requires authentication for this video. Provide cookies via PLAYDL_YOUTUBE_COOKIE or PLAYDL_COOKIES_FILE.';
  }

  if (/private video/i.test(message)) {
    return 'This video is private and cannot be downloaded.';
  }

  return fallback;
}

app.post('/api/convert', async (req, res) => {
  const { url, bitrate = 320 } = req.body || {};
  console.log('Convert request', { url, bitrate });

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let videoInfo;
  try {
    videoInfo = await getVideoInfo(url);
    console.log('Video info:', videoInfo);
  } catch (error) {
    console.warn('Failed to get video info, using fallback filename', error?.message || error);
    videoInfo = { title: 'audio', uploader: '', id: '' };
  }

  const title = videoInfo.title || 'audio';
  const uploader = videoInfo.uploader || '';

  let baseFilename = title;
  if (uploader) {
    baseFilename += ` - ${uploader}`;
  }

  const sanitizedFilename = sanitize(baseFilename) + '.mp3';
  console.log('Generated filename:', sanitizedFilename);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

  let streamInfo;
  try {
    streamInfo = await playdl.stream(url, { quality: 2 });
  } catch (error) {
    console.error('play-dl stream error:', error);
    const message = extractErrorMessage(error, 'Failed to retrieve audio stream from YouTube');
    return res.status(500).json({ error: message });
  }

  const audioStream = streamInfo.stream;
  const streamType = (streamInfo.type || '').toString().toLowerCase();

  let finished = false;
  let startedStreaming = false;
  let ffmpegStderr = '';
  let ffmpegProc;

  const cleanup = () => {
    if (ffmpegProc) {
      try {
        ffmpegProc.kill('SIGKILL');
      } catch {}
    }
    if (audioStream && !audioStream.destroyed) {
      audioStream.destroy();
    }
  };

  const failRequest = (message) => {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      res.destroy(new Error(message));
    }
  };

  audioStream.on('error', err => {
    console.error('Audio stream error:', err);
    failRequest('The YouTube audio stream failed.');
  });

  const ffmpegPath = ffmpegInstaller.path;
  const ffmpegArgs = [];
  if (streamType.includes('opus')) {
    ffmpegArgs.push('-f', 'opus');
  }
  ffmpegArgs.push(
    '-i', 'pipe:0',
    '-vn',
    '-acodec', 'libmp3lame',
    '-b:a', `${bitrate}k`,
    '-metadata', `title=${title}`,
    '-metadata', `artist=${uploader}`,
    '-f', 'mp3',
    'pipe:1'
  );

  ffmpegProc = spawn(ffmpegPath, ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  ffmpegProc.on('error', err => {
    console.error('FFmpeg failed to start:', err);
    failRequest('FFmpeg failed to start');
  });

  ffmpegProc.stderr.on('data', chunk => {
    const text = chunk.toString();
    ffmpegStderr += text;
    console.error('FFmpeg stderr:', text);
  });

  audioStream.pipe(ffmpegProc.stdin);
  ffmpegProc.stdout.pipe(res);

  ffmpegProc.stdout.once('data', () => {
    startedStreaming = true;
  });

  ffmpegProc.on('close', code => {
    if (finished) {
      return;
    }
    if (code !== 0) {
      const message = ffmpegStderr.trim().split('\n').pop() || `FFmpeg exited with code ${code}`;
      console.error('FFmpeg exited with code %s: %s', code, message);
      failRequest(message);
      return;
    }
    if (!startedStreaming) {
      failRequest('No audio was produced; the source may require authentication.');
      return;
    }
    finished = true;
  });

  req.on('close', () => {
    if (finished) {
      return;
    }
    finished = true;
    console.warn('Client aborted; terminating stream');
    cleanup();
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
