// Small shared helpers. No chrome.* calls in here, so the tests can load this file directly.

export const VERSION = '0.2.1';
export const ROOT_DIR = 'RedAnt'; // folder inside the Downloads folder

// Placeholder line the page writers put under the title; fillSizeLine() swaps in the real size.
export const SIZE_MARK = '{{REDANT_SIZE}}';

export function textStats(text) {
  const s = String(text ?? '');
  const parts = s.split('\n');
  return {
    lines: s.endsWith('\n') ? parts.length - 1 : parts.length,
    words: (s.match(/\S+/g) || []).length,
    chars: [...s].length,
  };
}

// Put the file's exact size at the top. The size line is part of the file, so repeat until the
// numbers describe the finished file exactly.
export function fillSizeLine(md, extra = '') {
  let out = md;
  let stats = textStats(out);
  for (let i = 0; i < 8; i++) {
    const line = `**Size of this file:** ${fmtInt(stats.lines)} lines · ${fmtInt(stats.words)} words · ` +
      `${fmtInt(stats.chars)} characters${extra}`;
    const next = md.replace(SIZE_MARK, line);
    const nextStats = textStats(next);
    out = next;
    if (nextStats.lines === stats.lines && nextStats.words === stats.words && nextStats.chars === stats.chars) break;
    stats = nextStats;
  }
  return { md: out, stats };
}

// Drop share codes and ad trackers from an address before it goes in a file.
// Reddit and X addresses need no query at all; elsewhere only known trackers are removed.
const TRACKERS = /^(utm_\w+|share_id|fbclid|gclid|dclid|msclkid|igshid|igsh|si|mc_cid|mc_eid|ref_src|ref_url|rdt|correlation_id|_branch_\w+)$/i;
export function cleanUrl(href) {
  let u;
  try { u = new URL(href); } catch { return String(href || ''); }
  if (/(^|\.)(reddit\.com|x\.com|twitter\.com)$/i.test(u.hostname)) {
    u.search = '';
  } else {
    for (const key of [...u.searchParams.keys()]) if (TRACKERS.test(key)) u.searchParams.delete(key);
  }
  return u.href;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const pad = (n, width = 2) => String(n).padStart(width, '0');

export function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function utcStamp(date = new Date()) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

// Reddit gives times as seconds since 1970.
export function fromEpoch(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return '';
  return utcStamp(new Date(seconds * 1000));
}

// Local time, used only in folder names so they sort and read naturally in Explorer.
export function folderStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Safe for Windows file names: plain letters, digits and dashes only.
export function slug(text, max = 60) {
  let s = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > max) s = s.slice(0, max).replace(/-+$/, '');
  return s;
}

export function fmtInt(n) {
  if (typeof n === 'string' && /^-?\d+$/.test(n.trim())) n = Number(n);
  if (typeof n === 'number' && isFinite(n)) return n.toLocaleString('en-US');
  return String(n ?? '');
}

export function baseName(path) {
  return String(path || '').split(/[\\/]/).pop();
}

export function extFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.(jpe?g|png|gif|webp|avif|bmp|svg|mp4|pdf)$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : null;
  } catch {
    return null;
  }
}

// Work out a file's real type from its first bytes, so a picture never gets saved with the wrong
// extension (some sites send WebP from a ".jpg" address). Returns null for web pages and unknowns.
export function sniffExt(bytes, contentType = '', url = '') {
  const b = bytes || new Uint8Array(0);
  const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png';
  if (b.length >= 6 && ascii(0, 4) === 'GIF8') return 'gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (/^avi[fs]$/.test(brand)) return 'avif';
    if (/^(heic|heix|mif1)$/.test(brand)) return 'heic';
    return 'mp4';
  }
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'pdf';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  const head = ascii(0, Math.min(b.length, 300)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head')) return null;
  const ct = String(contentType || '').toLowerCase();
  const byType = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
  };
  for (const [type, ext] of Object.entries(byType)) if (ct.startsWith(type)) return ext;
  if (ct.startsWith('text/html')) return null;
  return extFromUrl(url);
}
