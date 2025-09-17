const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const playdl = require('play-dl');
const path = require('path');
const sanitize = require('sanitize-filename');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 10000;
const PROVIDER = (process.env.CONVERTER_PROVIDER || '').toLowerCase();
const USING_RAPIDAPI = PROVIDER === 'rapidapi';

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
  if (USING_RAPIDAPI) {
    console.log('Skipping play-dl cookie configuration because CONVERTER_PROVIDER=rapidapi');
    return;
  }

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

function extractVideoIdFromUrl(url) {
  if (!url) {
    return '';
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be') {
      return parsed.pathname.replace(/^\//, '');
    }

    const vParam = parsed.searchParams.get('v');
    if (vParam) {
      return vParam;
    }

    const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/i);
    if (shortsMatch) {
      return shortsMatch[1];
    }

    const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/i);
    if (embedMatch) {
      return embedMatch[1];
    }
  } catch (error) {
    console.warn('Failed to parse URL for video ID extraction:', error?.message || error);
  }

  return '';
}

function findDownloadUrl(payload) {
  if (!payload) {
    return null;
  }

  if (typeof payload === 'string') {
    return /^https?:\/\//i.test(payload) ? payload : null;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = findDownloadUrl(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof payload === 'object') {
    const preferredKeys = [
      'download_url',
      'downloadUrl',
      'download',
      'mp3',
      'mp3_url',
      'mp3Url',
      'url',
      'link',
      'audio',
      'result'
    ];

    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const found = findDownloadUrl(payload[key]);
        if (found) {
          return found;
        }
      }
    }

    for (const value of Object.values(payload)) {
      const found = findDownloadUrl(value);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function streamViaRapidApi({ url, res, sanitizedFilename }) {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available; upgrade to Node 18+ or install a fetch polyfill.');
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    throw new Error('RAPIDAPI_KEY is not configured');
  }

  const videoId = extractVideoIdFromUrl(url);
  if (!videoId) {
    throw new Error('Unable to determine videoId for RapidAPI converter');
  }

  const endpoint = process.env.RAPIDAPI_BASE_URL || 'https://tube-mp31.p.rapidapi.com/api/json';
  const host = process.env.RAPIDAPI_HOST || 'tube-mp31.p.rapidapi.com';
  const method = (process.env.RAPIDAPI_METHOD || 'POST').toUpperCase();

  let requestUrl = endpoint;
  const headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': host
  };
  const init = { method, headers };

  if (method === 'GET') {
    const urlObject = new URL(endpoint);
    urlObject.searchParams.set('videoId', videoId);
    requestUrl = urlObject.toString();
  } else {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({ videoId });
  }

  const response = await fetchImpl(requestUrl, init);
  if (!response.ok) {
    throw new Error(`RapidAPI responded with HTTP ${response.status}`);
  }

  const json = await response.json();
  const downloadUrl = findDownloadUrl(json);
  if (!downloadUrl) {
    throw new Error('RapidAPI response did not include a downloadable URL');
  }

  const mp3Response = await fetchImpl(downloadUrl);
  if (!mp3Response.ok || !mp3Response.body) {
    throw new Error(`RapidAPI download failed with HTTP ${mp3Response.status}`);
  }

  const contentType = mp3Response.headers.get('content-type') || 'audio/mpeg';
  const contentLength = mp3Response.headers.get('content-length');

  res.setHeader('Content-Type', contentType.includes('audio') ? contentType : 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  const nodeStream = Readable.fromWeb(mp3Response.body);
  nodeStream.on('error', error => {
    console.error('RapidAPI stream error:', error);
    res.destroy(error);
  });
  nodeStream.pipe(res);
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

  if (USING_RAPIDAPI) {
    try {
      await streamViaRapidApi({ url, res, sanitizedFilename });
    } catch (error) {
      console.error('RapidAPI conversion error:', error);
      const message = extractErrorMessage(error, 'Failed to convert video via RapidAPI');
      if (!res.headersSent) {
        res.status(502).json({ error: message });
      } else {
        res.destroy(new Error(message));
      }
    }
    return;
  }

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
