// Fixed app.js - Corrected form ID and dark mode toggle

const form = document.getElementById('convertForm'); // Fixed: was 'convert-form'
const statusEl = document.getElementById('status');

const API = 'https://api.yt2-mp3.com'; // your Render/custom-domain backend

function setStatus(text, isError = false) {
  statusEl.textContent = text || '';
  statusEl.className = `mt-4 text-center text-sm ${isError ? 'text-red-600' : 'text-blue-600'}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('Starting conversion...');
  const btn = form.querySelector('button');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Converting...';

  try {
    const url = document.getElementById('youtubeUrl').value.trim(); // Fixed: was 'url'
    const bitrate = Number(document.getElementById('bitrate').value);

    const resp = await fetch(`${API}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, bitrate })
    });

    if (!resp.ok) {
      const problem = await resp.json().catch(() => ({}));
      throw new Error(problem.error || `Server error: ${resp.status}`);
    }

    // Get filename from Content-Disposition header
    const disp = resp.headers.get('Content-Disposition') || '';
    const match = /filename=\"?([^\";]+)\"?/i.exec(disp);
    const fileName = match ? match[1] : 'audio.mp3';

    // Create and trigger download
    const blob = await resp.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    
    setStatus(` ✅ Download started: ${fileName}`);
  } catch (err) {
    console.error('Conversion error:', err);
    setStatus(`❌ ${err.message || 'Conversion failed'}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Dark/Light Mode Toggle - use data-color-scheme to match CSS
const themeToggle = document.getElementById('theme-toggle');

// Initialize from saved preference (default: light)
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-color-scheme', savedTheme);
themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-color-scheme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-color-scheme', next);
  themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('theme', next);
});

// Add some UI enhancements
document.addEventListener('DOMContentLoaded', () => {
  // Add loading animation to the convert button
  const convertBtn = form.querySelector('button[type="submit"]');
  const originalHTML = convertBtn.innerHTML;
  
  // URL validation feedback
  const urlInput = document.getElementById('youtubeUrl');
  urlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url && !url.includes('youtube.com') && !url.includes('youtu.be')) {
      e.target.classList.add('border-red-300');
      e.target.classList.remove('border-gray-300');
    } else {
      e.target.classList.remove('border-red-300');
      e.target.classList.add('border-gray-300');
    }
  });
});
