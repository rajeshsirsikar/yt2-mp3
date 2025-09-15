#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const YTDlpWrap = require('yt-dlp-wrap').default;

async function main() {
  const binDir = path.join(__dirname, '..', 'bin');
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const target = path.join(binDir, exe);

  try {
    await fsp.mkdir(binDir, { recursive: true });
    await fsp.access(target, fs.constants.X_OK);
    console.log('[postinstall] yt-dlp already present at', target);
    return;
  } catch {}

  try {
    console.log('[postinstall] Downloading yt-dlp to', target);
    await YTDlpWrap.downloadFromGithub(target);
    console.log('[postinstall] yt-dlp downloaded.');
  } catch (e) {
    console.warn('[postinstall] Failed to download yt-dlp (will fallback at runtime):', e && e.message);
  }
}

main();

