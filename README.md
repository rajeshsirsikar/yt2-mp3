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
- Optional but recommended: `yt-dlp` system binary for robustness

The app bundles `ffmpeg`. For fetching audio, it prefers a system `yt-dlp` if available (more resilient to YouTube changes), and falls back to `ytdl-core` otherwise. If `yt-dlp` is not on your PATH, the server attempts to auto-download a local binary on first use into `bin/yt-dlp` via `yt-dlp-wrap`.

## Setup

```bash
npm install
npm run dev   # or: npm start
# Open http://localhost:3000
```

## How it works

- Backend (`server.js`) exposes `POST /api/convert` accepting `{ url, bitrate }`.
- It fetches video info with `yt-dlp -J` to build a safe filename and metadata.
- It then streams best available audio from `yt-dlp` to `ffmpeg`, encoding to MP3 at the selected bitrate and streaming to the client as a download.

## Notes

- Bitrate accepted range: 64–320 kbps (default 320).
- Install `yt-dlp` to avoid occasional `ytdl-core` breakages (or rely on auto-download):
  - macOS (Homebrew): `brew install yt-dlp`
  - Python: `pipx install yt-dlp` or `pip3 install --user yt-dlp` and ensure it’s on `PATH`.
  - Auto-download: first request may take longer while the binary downloads into `bin/`.
- No files are written to disk; everything is streamed and piped.

## Using a Hosted Converter API (RapidAPI)

If you prefer not to run yt-dlp/ffmpeg yourself, you can switch the backend to call a third‑party converter API (e.g., RapidAPI: Super Fast YouTube to MP3/MP4). Configure these environment variables and redeploy:

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
  - Public instances do not use user cookies. Such videos will return a 403 with a clear message.
- Rate limiting / 429 from YouTube
  - The API has basic per-IP rate limiting. If YouTube rate limits the backend, the API returns 429. Try later.
- Live streams / DRM / geo restrictions
  - Live/DRM content is not supported. Geo-blocked content may fail even with `--geo-bypass`.
- Logged-in only / age-restricted videos
  - The server automatically asks `yt-dlp` to reuse your Chrome cookies via `--cookies-from-browser`. On macOS it looks for the standard Chrome profile under `~/Library/Application Support/Google/Chrome`; on Linux it checks `~/.config/google-chrome` and, if needed, the Flatpak profile `~/.var/app/com.google.Chrome/`. Override with `YTDLP_COOKIES_FROM_BROWSER` (e.g. `chrome:/custom/path`). You can use `~` in the override—it expands to the container user’s home. Set `YTDLP_NO_COOKIES=1` to disable cookie usage entirely.
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
