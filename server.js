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
    ? ['https://your-serverbyt-domain.com']
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

  // 1. yt-dlp extract
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  ytdlp.on('error', err => {
    console.error('yt-dlp error:', err);
    return res.status(500).send('yt-dlp failed to start');
  });
  ytdlp.stderr.on('data', d => console.error('yt-dlp stderr:', d.toString()));

  // 2. ffmpeg convert
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
    console.error('ffmpeg error:', err);
    return res.status(500).send('FFmpeg failed to start');
  });
  ffmpegProc.stderr.on('data', d => console.error('ffmpeg stderr:', d.toString()));

  // 3. Pipe streams
  ytdlp.stdout.pipe(ffmpegProc.stdin);
  ffmpegProc.stdout.pipe(res);

  req.on('close', () => {
    console.warn('Client aborted; killing processes');
    ytdlp.kill('SIGKILL');
    ffmpegProc.kill('SIGKILL');
  });
});

// Single listener
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
