# Step-by-Step Deployment Guide: YouTube to MP3 Converter

## Phase 1: Backend Deployment on Render.com

### Step 1: Prepare Your Repository

1. **Create a `render.yaml` file** in your project root:
```yaml
services:
  - type: web
    name: yt2-mp3-api
    runtime: node          # Use 'runtime' instead of 'env'
    plan: starter
    branch: main           # Required: specify Git branch
    buildCommand: |
      npm install
      # Install Python and yt-dlp system dependencies  
      apt-get update && apt-get install -y python3 python3-pip
      pip3 install yt-dlp --user
      # Ensure yt-dlp is in PATH
      export PATH=$PATH:/opt/render/.local/bin
    startCommand: npm start
    healthCheckPath: /
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
```

2. **Update your `package.json`** to include all dependencies:
```json
{
  "name": "yt2-mp3",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "yt-dlp-wrap": "^2.6.1",
    "ytdl-core": "^4.11.5",
    "cors": "^2.8.5"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

3. **Modify your `server.js`** to handle production environment:
```javascript
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
app.post('/api/convert', async (req, res) => {
  // Your existing conversion logic
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Step 2: Deploy to Render

1. **Push changes to GitHub**:
```bash
git add .
git commit -m "Add Render deployment configuration"
git push origin main
```

2. **Create Render Account**:
   - Go to [render.com](https://render.com)
   - Sign up with your GitHub account

3. **Create Web Service**:
   - Click "New" â†’ "Web Service"
   - Connect your GitHub repository
   - Select the `yt2-mp3` repository

4. **Configure Service Settings**:
   - **Name**: `yt2-mp3-api`
   - **Environment**: `Node`
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Root Directory**: Leave blank
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (for testing)

5. **Deploy**:
   - Click "Create Web Service"
   - Wait for deployment (5-10 minutes)
   - Note your API URL: `https://yt2-mp3-api.onrender.com`

### Step 3: Test Backend Deployment

Test your API using curl or Postman:
```bash
curl -X POST https://yt2-mp3-api.onrender.com/api/convert \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","bitrate":128}'
```

---

## Phase 2: Frontend Deployment on Serverbyt

### Step 4: Prepare Frontend Files

1. **Create a separate frontend folder** locally:
```
frontend/
â”œâ”€â”€ index.html
â”œâ”€â”€ style.css
â”œâ”€â”€ script.js
â””â”€â”€ favicon.ico (optional)
```

2. **Create `index.html`**:
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube to MP3 Converter</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>YouTube to MP3 Converter</h1>
        <form id="convertForm">
            <input type="url" id="youtubeUrl" placeholder="Enter YouTube URL" required>
            <select id="bitrate">
                <option value="64">64 kbps</option>
                <option value="128" selected>128 kbps</option>
                <option value="192">192 kbps</option>
                <option value="320">320 kbps</option>
            </select>
            <button type="submit">Convert</button>
        </form>
        <div id="status"></div>
        <div id="result"></div>
    </div>
    <script src="script.js"></script>
</body>
</html>
```

3. **Create `script.js`** with your Render API URL:
```javascript
const API_URL = 'https://yt2-mp3-api.onrender.com'; // Replace with your actual Render URL

document.getElementById('convertForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = document.getElementById('youtubeUrl').value;
    const bitrate = document.getElementById('bitrate').value;
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    
    statusDiv.innerHTML = 'Converting...';
    resultDiv.innerHTML = '';
    
    try {
        const response = await fetch(`${API_URL}/api/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, bitrate })
        });
        
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        
        statusDiv.innerHTML = 'Conversion complete!';
        resultDiv.innerHTML = `<a href="${downloadUrl}" download="audio.mp3">Download MP3</a>`;
        
    } catch (error) {
        statusDiv.innerHTML = `Error: ${error.message}`;
    }
});
```

4. **Copy your existing `style.css`** from your repository

### Step 5: Deploy to Serverbyt

1. **Sign up for Serverbyt**:
   - Go to [serverbyt.in](https://serverbyt.in)
   - Create an account

2. **Access File Manager**:
   - Login to your Serverbyt control panel
   - Go to "File Manager"
   - Navigate to `public_html` folder

3. **Upload Frontend Files**:
   - Delete any default files in `public_html`
   - Upload your `index.html`, `style.css`, `script.js`
   - Ensure `index.html` is in the root of `public_html`

4. **Test Your Website**:
   - Visit your Serverbyt domain
   - Test the conversion functionality

---

## Phase 3: Configuration and Optimization

### Step 6: Update CORS Settings

1. **Update your Render backend** `server.js`:
```javascript
app.use(cors({
  origin: [
    'https://your-serverbyt-domain.com',
    'http://your-serverbyt-domain.com',
    'http://localhost:3000' // for local development
  ]
}));
```

2. **Redeploy your Render service**:
```bash
git add .
git commit -m "Update CORS for Serverbyt domain"
git push origin main
```

### Step 7: Environment Variables and Security

1. **Add environment variables** in Render dashboard:
   - Go to your service â†’ Settings â†’ Environment
   - Add:
     - `NODE_ENV=production`
     - `ALLOWED_ORIGINS=https://your-serverbyt-domain.com`

### Step 8: Testing and Troubleshooting

1. **Test complete workflow**:
   - Visit your Serverbyt domain
   - Enter a YouTube URL
   - Select bitrate
   - Click Convert
   - Download the MP3

2. **Common issues and solutions**:

   **Backend Issues**:
   - **FFmpeg not found**: Ensure `@ffmpeg-installer/ffmpeg` is in dependencies
   - **yt-dlp not working**: Check build logs, may need system yt-dlp installation
   - **CORS errors**: Verify origin settings match your Serverbyt domain

   **Frontend Issues**:
   - **API calls failing**: Check browser console for CORS or network errors
   - **Download not working**: Verify blob handling and download link creation

### Step 9: Monitoring and Maintenance

1. **Monitor Render Logs**:
   - Go to your Render service dashboard
   - Check "Logs" tab for errors

2. **Set up alerts**:
   - Configure email notifications for deployment failures

---

## Quick Reference Commands

**Git Commands**:
```bash
git add .
git commit -m "Your commit message"
git push origin main
```

**Testing Backend Locally**:
```bash
npm install
npm start
# Test at http://localhost:3000
```

**Testing API Endpoint**:
```bash
curl -X POST http://localhost:3000/api/convert \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=VIDEO_ID","bitrate":128}'
```

---

## Estimated Timeline

- **Phase 1 (Backend)**: 30-45 minutes
- **Phase 2 (Frontend)**: 15-20 minutes  
- **Phase 3 (Configuration)**: 10-15 minutes
- **Total**: 60-90 minutes

## Important Notes

1. **Free Tier Limitations**:
   - Render free tier has 750 hours/month limit
   - Service sleeps after 15 minutes of inactivity
   - Cold start time: 30-60 seconds

2. **Legal Compliance**:
   - Add terms of service to your frontend
   - Implement rate limiting
   - Consider usage analytics

3. **Performance Optimization**:
   - Consider upgrading to paid Render plan for production
   - Implement CDN for frontend assets
   - Add error handling and retry logic

Follow these steps exactly, and you should have a working YouTube to MP3 converter deployed on both platforms!