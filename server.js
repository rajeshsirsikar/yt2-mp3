const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
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

function resolveCookieArgs() {
  if (process.env.YTDLP_NO_COOKIES === '1') {
    return [];
  }

  const explicit = process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (explicit) {
    return ['--cookies-from-browser', explicit];
  }

  const home = os.homedir();
  if (!home) {
    return [];
  }

  const chromeConfig = path.join(home, '.config', 'google-chrome');
  if (fs.existsSync(chromeConfig)) {
    return ['--cookies-from-browser', 'chrome'];
  }

  const flatpakChrome = path.join(home, '.var', 'app', 'com.google.Chrome');
  if (fs.existsSync(flatpakChrome)) {
    return ['--cookies-from-browser', `chrome:${flatpakChrome}/`];
  }

  return [];
}

const browserCookieArgs = resolveCookieArgs();

// Function to get video metadata using yt-dlp
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const ytDlpExec = process.env.YTDLP_PATH || 'yt-dlp';

    const args = ['-J', '--no-warnings', ...browserCookieArgs, url];

    execFile(ytDlpExec, args,
      { maxBuffer: 10 * 1024 * 1024 }, 
      (error, stdout, stderr) => {
        if (error) {
          console.error('yt-dlp metadata error:', error);
          reject(error);
          return;
        }
        
        try {
          const info = JSON.parse(stdout);
          resolve({
            title: info.title || 'Unknown',
            uploader: info.uploader || info.channel || 'Unknown',
            id: info.id || '',
            duration: info.duration || 0
          });
        } catch (parseError) {
          console.error('Failed to parse yt-dlp JSON:', parseError);
          reject(parseError);
        }
      }
    );
  });
}

app.post('/api/convert', async (req, res) => {
  const { url, bitrate = 320 } = req.body;
  console.log('Convert request', { url, bitrate });

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let videoInfo;
  try {
    // Get video metadata first
    videoInfo = await getVideoInfo(url);
    console.log('Video info:', videoInfo);
  } catch (error) {
    console.warn('Failed to get video info, using fallback filename');
    videoInfo = { title: 'audio', uploader: '', id: '' };
  }

  // Create sanitized filename
  const title = videoInfo.title || 'audio';
  const uploader = videoInfo.uploader || '';

  // Create filename: "Title - Artist.mp3"
  let baseFilename = title;
  if (uploader) {
    baseFilename += ` - ${uploader}`;
  }
  
  const sanitizedFilename = sanitize(baseFilename) + '.mp3';
  console.log('Generated filename:', sanitizedFilename);

  // Set response headers for streaming MP3
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

  // 1. Spawn yt-dlp to extract audio stream
  const ytDlpExec = process.env.YTDLP_PATH || 'yt-dlp';
  const ytdlpArgs = ['-f', 'bestaudio', '-o', '-', ...browserCookieArgs, url];

  const ytdlp = spawn(ytDlpExec, ytdlpArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  ytdlp.on('error', err => {
    console.error('yt-dlp failed to start:', err);
    return res.status(500).end();
  });
  ytdlp.stderr.on('data', chunk => {
    console.error('yt-dlp stderr:', chunk.toString());
  });

  // 2. Spawn FFmpeg to convert the piped input to MP3
  const ffmpegPath = ffmpegInstaller.path;
  const ffmpegProc = spawn(ffmpegPath, [
    '-i', 'pipe:0',
    '-vn',
    '-acodec', 'libmp3lame',
    '-b:a', `${bitrate}k`,
    '-metadata', `title=${title}`,
    '-metadata', `artist=${uploader}`,
    '-f', 'mp3',
    'pipe:1'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  ffmpegProc.on('error', err => {
    console.error('FFmpeg failed to start:', err);
    return res.status(500).end();
  });
  ffmpegProc.stderr.on('data', chunk => {
    console.error('FFmpeg stderr:', chunk.toString());
  });

  // 3. Pipe yt-dlp output into ffmpeg stdin, then pipe ffmpeg stdout into response
  ytdlp.stdout.pipe(ffmpegProc.stdin);
  ffmpegProc.stdout.pipe(res);

  // Cleanup if client aborts
  req.on('close', () => {
    console.warn('Client aborted; terminating child processes');
    ytdlp.kill('SIGKILL');
    ffmpegProc.kill('SIGKILL');
  });
});

// Single listener
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
