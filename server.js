const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');

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

app.post('/api/convert', (req, res) => {
  const { url, bitrate = 320 } = req.body;
  console.log('Convert request', { url, bitrate });

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Set response headers for streaming MP3
  const fileName = 'audio.mp3';
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  // 1. Spawn yt-dlp to extract audio stream
  const ytDlpExec = process.env.YTDLP_PATH || 'yt-dlp';
  const ytdlp = spawn(ytDlpExec, ['-f', 'bestaudio', '-o', '-', url], {
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
