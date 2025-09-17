const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const playdl = require('play-dl');
const path = require('path');
const sanitize = require('sanitize-filename');

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

  let streamInfo;
  try {
    streamInfo = await playdl.stream(url, { quality: 2 });
  } catch (error) {
    console.error('play-dl stream error:', error);
    return res.status(500).json({ error: 'Failed to retrieve audio stream from YouTube' });
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

  // Cleanup if client aborts
  req.on('close', () => {
    if (finished) {
      return;
    }
    finished = true;
    console.warn('Client aborted; terminating stream');
    cleanup();
  });
});

// Single listener
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
