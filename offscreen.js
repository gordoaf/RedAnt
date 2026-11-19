// Hidden helper page. The background worker can't make files or touch the clipboard itself,
// so it asks this page to: turn text into a file, fetch a picture (and check what it really is),
// and copy text to the clipboard.
import { sniffExt } from './lib/util.js';

const MAX_BYTES = 30 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, kind: 'error', error: String(e?.message || e) }));
  return true; // answer comes later
});

async function handle(msg) {
  switch (msg.type) {
    case 'blobFromText': {
      const blob = new Blob([msg.text], { type: msg.mime || 'text/plain' });
      return { ok: true, blobUrl: URL.createObjectURL(blob) };
    }
    case 'blobFromUrl':
      return fetchToBlob(msg.url, !!msg.allowPdf);
    case 'revoke':
      URL.revokeObjectURL(msg.blobUrl);
      return { ok: true };
    case 'copy':
      return { ok: copy(msg.text) };
    default:
      return { ok: false, error: `unknown request ${msg.type}` };
  }
}

async function fetchToBlob(url, allowPdf) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal, credentials: 'include', referrerPolicy: 'no-referrer' });
    } catch (e) {
      return { ok: false, kind: 'network', error: String(e?.message || e) };
    }
    if (!res.ok) return { ok: false, kind: 'http', status: res.status, error: `HTTP ${res.status}` };
    const len = Number(res.headers.get('content-length')) || 0;
    if (len > MAX_BYTES) return { ok: false, kind: 'too-big', error: `too big (${Math.round(len / 1e6)} MB)` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, kind: 'too-big', error: `too big (${Math.round(buf.byteLength / 1e6)} MB)` };
    const type = res.headers.get('content-type') || '';
    const ext = sniffExt(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512)), type, url);
    if (!ext || (ext === 'pdf' && !allowPdf)) {
      return { ok: false, kind: 'not-image', error: `not a picture (${type || 'unknown type'})` };
    }
    // fingerprint of the bytes, so the same picture under a different address is saved only once
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    const hash = Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
    const blob = new Blob([buf], { type: type || 'application/octet-stream' });
    return { ok: true, blobUrl: URL.createObjectURL(blob), ext, bytes: buf.byteLength, hash };
  } catch (e) {
    return { ok: false, kind: ctrl.signal.aborted ? 'timeout' : 'error', error: ctrl.signal.aborted ? 'timed out' : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function copy(text) {
  const box = document.createElement('textarea');
  box.value = String(text ?? '');
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  box.remove();
  return ok;
}
