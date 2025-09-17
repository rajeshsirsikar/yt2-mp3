# YT → MP3 (320kbps)

A lightweight web app to convert a YouTube link into a high‑quality MP3 (up to 320 kbps).

Important: Use only for content you own or have explicit permission to download. Respect the source platform’s Terms of Service.

## Features

- High‑bitrate MP3 via `ffmpeg` (`libmp3lame`) up to 320 kbps
- Streams directly: starts converting and downloading without temp files
- Sets basic ID3 metadata (title, artist)
- Simple, self‑contained UI

## Requirements

- Node.js 18+
- Network access to fetch NPM deps and video/audio streams
- `ffmpeg` binary (bundled via `@ffmpeg-installer/ffmpeg`)
- No additional binaries are required beyond the bundled `ffmpeg`; YouTube audio is fetched through [`play-dl`](https://github.com/play-dl/play-dl).

## Setup

```bash
npm install
npm run dev   # or: npm start
# Open http://localhost:3000
```

## How it works

- Backend (`server.js`) exposes `POST /api/convert` accepting `{ url, bitrate }`.
- It fetches basic video info with `play-dl` to build a safe filename and metadata.
- It then requests the best available audio stream through `play-dl`, pipes it into `ffmpeg`, encodes to MP3 at the selected bitrate, and streams the result to the client as a download.

## Notes

- Bitrate accepted range: 64–320 kbps (default 320).
- No files are written to disk; everything is streamed and piped.

## Using a Hosted Converter API (RapidAPI)

If you prefer not to run the conversion stack yourself, you can switch the backend to call a third‑party converter API (e.g., RapidAPI: Super Fast YouTube to MP3/MP4). Configure these environment variables and redeploy:

- `CONVERTER_PROVIDER=rapidapi`
- `RAPIDAPI_BASE_URL` — Full endpoint URL that accepts a `url` query param and returns JSON with a downloadable MP3 link. Example: `https://<your-rapidapi-endpoint>?url=` (the app appends the video URL)
- `RAPIDAPI_KEY` — Your RapidAPI key
- `RAPIDAPI_HOST` — Optional; if your API requires `X-RapidAPI-Host`

The server will:
- Call the RapidAPI endpoint with the YouTube URL
- Parse a common field (`url`, `link`, `download_url`, etc.) for the MP3 link
- Stream the resulting MP3 back to the client with an attachment filename

Notes:
- You must consult the API’s docs for the exact endpoint and field names.
- Billing, rate limits, and ToS are governed by the provider.

## FAQ / Limits (Public Hosting)

- Some videos return “Sign in to confirm you’re not a bot” or are private/members‑only.
  - Public instances do not use user cookies; age-restricted or members-only videos will return an error.
- Rate limiting / 429 from YouTube
  - The API has basic per-IP rate limiting. If YouTube rate limits the backend, the API returns 429. Try later.
- Live streams / DRM / geo restrictions
  - Live/DRM content is not supported. Geo-blocked content is likely to fail.
- Logged-in only / age-restricted videos
  - Cookie-based authentication is not currently supported; restricted content cannot be downloaded.
- Legal use
  - Use only for content you own or have permission to download; comply with platform Terms of Service.

## Legal and ethical use

Downloading content from YouTube or other platforms may violate their Terms of Service unless the content is your own or you have explicit permission. This project is provided for lawful uses only. You are responsible for ensuring compliance with all applicable laws and terms.

```text
POST /api/convert
Content-Type: application/json
{"url": "https://www.youtube.com/watch?v=...", "bitrate": 320}
```

If you run into issues, check the server logs and ensure your network allows the app to reach YouTube.
