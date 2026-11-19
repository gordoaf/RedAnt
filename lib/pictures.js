// Saving a list of pictures without saving the same picture twice.
// A picture counts as already saved if it has the same address as one saved earlier, or the same
// bytes (a screenshot posted again, or a post shared to several subreddits, gets a new address).
// Repeats point at the first file and don't count toward the limit.
// The real fetching and writing are passed in, so the tests can run this without Chrome.
import { pad } from './util.js';

export function newPictureBook() {
  return { byUrl: new Map(), byHash: new Map(), next: {} };
}

// o: { folder, prefix, max, book,
//      fetchPic(m)      -> { ok, from, ext, hash?, ... } or { ok: false, error }
//      writePic(f, rel) -> { ok, file } or { ok: false, error }   (rel = path without extension)
//      discard(f)       -> forget a fetched picture we won't write
//      progress(i, n)   -> optional }
// Sets m.result on every item and returns how many new files were written.
export async function savePictures(list, o) {
  let made = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const known = o.book.byUrl.get(m.url);
    if (known) {
      m.result = { ...known, duplicate: true };
      continue;
    }
    if (made >= o.max) {
      m.result = { ok: false, skipped: true, error: 'over the picture limit' };
      continue;
    }
    if (o.progress) await o.progress(i + 1, list.length);
    const f = await o.fetchPic(m);
    if (!f.ok) {
      m.result = { ok: false, error: f.error };
      continue;
    }
    const same = f.hash ? o.book.byHash.get(f.hash) : null;
    if (same) {
      if (o.discard) o.discard(f);
      o.book.byUrl.set(m.url, same);
      m.result = { ...same, from: f.from, duplicate: true };
      continue;
    }
    const n = (o.book.next[o.prefix] || 0) + 1;
    const w = await o.writePic(f, `${o.folder}/images/${o.prefix}_${pad(n)}`);
    if (!w.ok) {
      m.result = { ok: false, error: w.error };
      continue;
    }
    o.book.next[o.prefix] = n;
    made++;
    const res = { ok: true, file: w.file, from: f.from };
    if (f.hash) o.book.byHash.set(f.hash, res);
    o.book.byUrl.set(m.url, res);
    m.result = res;
  }
  return made;
}

export function pictureCounts(list) {
  const files = new Set();
  let repeats = 0;
  let failed = 0;
  let skipped = 0;
  for (const m of list) {
    const r = m.result;
    if (!r) continue;
    if (r.ok) {
      files.add(r.file);
      if (r.duplicate) repeats++;
    } else if (r.skipped) {
      skipped++;
    } else {
      failed++;
    }
  }
  return { files: files.size, repeats, failed, skipped };
}

// How a picture is described in the file lists.
export function pictureWhere(m) {
  const r = m.result;
  if (r?.ok) return r.duplicate ? `${r.file} (same picture as an earlier one)` : r.file;
  return `NOT SAVED (${r?.error || 'skipped'})`;
}
