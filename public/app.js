const form = document.getElementById('convert-form');
const statusEl = document.getElementById('status');

const API = 'https://api.yt2-mp3.com'; // your Render/custom-domain backend

function setStatus(text) {
statusEl.textContent = text || '';
}

form.addEventListener('submit', async (e) => {
e.preventDefault();
setStatus('Starting conversion...');
const btn = form.querySelector('button');
btn.disabled = true;

try {
const url = document.getElementById('url').value.trim();
const bitrate = Number(document.getElementById('bitrate').value);

// Note the backticks here:
const resp = await fetch(`${API}/api/convert`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, bitrate })
});

if (!resp.ok) {
  const problem = await resp.json().catch(() => ({}));
  throw new Error(problem.error || 'Conversion failed.');
}

const disp = resp.headers.get('Content-Disposition') || '';
const match = /filename=\"?([^\";]+)\"?/i.exec(disp);
const fileName = match ? match[1] : 'audio.mp3';

const blob = await resp.blob();
const href = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = href;
a.download = fileName;
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(href);
setStatus('Done. Download should begin.');
} catch (err) {
console.error(err);
setStatus(err.message || 'Something went wrong.');
} finally {
btn.disabled = false;
}
});