const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration for production
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-serverbyt-domain.com'] 
    : ['http://localhost:3000']
}));

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'YouTube to MP3 API is running' });
});

// Your existing /api/convert endpoint stays the same
app.post('/api/convert', (req, res) => {
  const { url, bitrate } = req.body;
  console.log('Received convert request', { url, bitrate });

  // 1. Spawn yt-dlp to extract best audio URL
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'pipe'] });

  ytdlp.on('error', err => {
    console.error('yt-dlp spawn error:', err);
    return res.status(500).send('yt-dlp failed to start');
  });
  ytdlp.stderr.on('data', data => console.error('yt-dlp stderr:', data.toString()));
  ytdlp.on('exit', code => console.log('yt-dlp exited with code', code));

  // 2. Pipe into FFmpeg to convert to MP3
  const ffmpeg = spawn(ffmpegPath, [
    '-i', 'pipe:0',
    '-vn',
    '-acodec', 'libmp3lame',
    '-b:a', `${bitrate}k`,
    '-f', 'mp3',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ffmpeg.on('error', err => {
    console.error('ffmpeg spawn error:', err);
    return res.status(500).send('FFmpeg failed to start');
  });
  ffmpeg.stderr.on('data', data => console.error('ffmpeg stderr:', data.toString()));
  ffmpeg.on('exit', code => console.log('ffmpeg exited with code', code));

  // 3. Pipe streams
  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(res);

  // If client aborts, kill child processes
  req.on('close', () => {
    console.warn('Client closed connection, killing processes');
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  });
});

app.listen(process.env.PORT || 10000, () => console.log('API listening'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});