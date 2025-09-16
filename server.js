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
    ? ['https://yt2-mp3.com'] 
    : ['http://localhost:3000']
}));

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'YouTube to MP3 API is running' });
});

// Your existing /api/convert endpoint stays the same
app.post('/api/convert', async (req, res) => {
  // Your existing conversion logic
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});