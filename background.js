// RedAnt background worker. Runs one snapshot at a time:
//   Reddit thread -> full comment tree + pictures;  Reddit profile -> the user's posts and comments + pictures;
//   PDF -> the file itself;  any other page -> main text + pictures.
// Everything lands in Downloads/RedAnt/<date>_<name>/ and the path of snapshot.md is copied to the clipboard.
import {
  VERSION, ROOT_DIR, sleep, slug, folderStamp, utcStamp, extFromUrl, baseName, cleanUrl, fillSizeLine, fmtInt,
} from './lib/util.js';
import * as R from './lib/reddit.js';
import * as P from './lib/profile.js';
import { newPictureBook, savePictures, pictureCounts } from './lib/pictures.js';
import { renderPage } from './lib/page.js';
import { extractPage, scrapeRedditDom } from './lib/inject.js';

const LIMITS = {
  moreRequests: 40,      // extra "load more comments" requests per thread (each brings up to 100 comments)
  requestGapMs: 1200,    // pause between Reddit requests, to stay polite to Reddit
  // picture limits count NEW files; repeats of an already-saved picture are free
  postPictures: 40,
  commentPictures: 40,
  profilePages: 10,      // 100 items per page; Reddit stops listing at about 1,000 anyway
  profilePictures: 40,
  pagePictures: 60,
  pictureCandidates: 300, // most pictures listed per snapshot (the ones past the limit show as not saved)
};

let running = false;
let job = null;
let badgeTimer = null;

// If the worker was stopped in the middle of a job, make sure Chrome's download bubble is back on.
chrome.downloads.setUiOptions?.({ enabled: true })?.catch?.(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  if (msg.type === 'start') {
    if (running) {
      sendResponse({ ok: false, error: 'busy' });
    } else {
      startJob(msg.tabId);
      sendResponse({ ok: true });
    }
  }
  return false;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'snapshot' && tab && tab.id != null) startJob(tab.id);
});

// ---------------------------------------------------------------- job state (the popup shows this)

async function update(patch) {
  job = { ...job, ...patch };
  try { await chrome.storage.session.set({ lastJob: job }); } catch { /* popup just won't update */ }
}

function step(text) {
  const line = `${new Date().toLocaleTimeString()}  ${text}`;
  return update({ step: text, log: [...(job?.log || []), line].slice(-80) });
}

function setBadge(text, color, clearAfterMs) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (clearAfterMs) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), clearAfterMs);
}

async function startJob(tabId) {
  if (running) return;
  running = true;
  // Chrome stops idle workers after ~30 s; a cheap call every 20 s keeps a long thread going.
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20_000);
  job = null;
  await update({ id: Date.now(), status: 'running', tabId, url: '', title: '', step: 'Starting…', log: [], startedAt: Date.now() });
  setBadge('…', '#5f6368');
  let hidDownloadBubble = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    await update({ url: tab.url || '', title: tab.title || '' });
    if (!/^https?:\/\//i.test(tab.url || '')) {
      throw new Error("Chrome doesn't let extensions save this kind of page (settings pages, the Web Store, new-tab pages, local files).");
    }
    try { await chrome.downloads.setUiOptions({ enabled: false }); hidDownloadBubble = true; } catch { /* older Chrome */ }
    await ensureOffscreen();

    const rid = R.parseRedditUrl(tab.url);
    const who = rid ? null : P.parseProfileUrl(tab.url);
    let out;
    if (rid) out = await snapshotReddit(tab, rid);
    else if (who) out = await snapshotProfile(tab, who);
    else if (/\.pdf$/i.test(new URL(tab.url).pathname)) out = await snapshotPdf(tab);
    else out = await snapshotPage(tab);

    const copied = await copyText(out.path);
    await update({
      status: 'done', finishedAt: Date.now(), path: out.path, downloadId: out.downloadId,
      summary: out.summary, stats: out.stats || null, copied,
      step: copied ? 'Saved. The file path is copied: paste it into your AI.' : 'Saved. (Could not copy the path by itself: use the Copy path button.)',
    });
    setBadge('✓', '#1e8e3e', 30_000);
  } catch (e) {
    await update({ status: 'error', finishedAt: Date.now(), error: String(e?.message || e), step: 'Failed' });
    setBadge('!', '#d93025', 30_000);
  } finally {
    if (hidDownloadBubble) await chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
    clearInterval(keepAlive);
    running = false;
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

function makeFolder(parts) {
  const name = [folderStamp(), ...parts.map((p) => slug(p, 50))].filter(Boolean).join('_');
  return `${ROOT_DIR}/${name}`;
}

// Fill in the size line, save snapshot.md, and build the answer startJob() reports.
async function saveSnapshot(folder, md, pictures, summary) {
  const files = pictureCounts(pictures).files;
  const { md: text, stats } = fillSizeLine(md, files ? ` · plus ${fmtInt(files)} picture file${files === 1 ? '' : 's'} in images/` : '');
  await step('Writing snapshot.md…');
  const item = await saveText(`${folder}/snapshot.md`, text, 'text/markdown');
  return { path: item.filename, downloadId: item.id, stats, summary };
}

function pictureSummary(list) {
  const c = pictureCounts(list);
  const extra = [
    c.repeats && `${c.repeats} repeat${c.repeats === 1 ? '' : 's'} skipped`,
    c.failed && `${c.failed} couldn't be saved`,
    c.skipped && `${c.skipped} over the limit`,
  ].filter(Boolean);
  return `${c.files} picture${c.files === 1 ? '' : 's'}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

// ---------------------------------------------------------------- Reddit

async function snapshotReddit(tab, rid) {
  const jsonUrl = `${rid.origin}/comments/${rid.postId}/.json?raw_json=1&limit=500`;
  await step('Reading the Reddit post…');
  let first;
  try {
    first = await redditJson(tab.id, jsonUrl);
  } catch (e) {
    await step(`Reddit's data view didn't work (${e.message}). Saving what's on screen instead.`);
    const dom = await runInTab(tab.id, scrapeRedditDom).catch(() => null);
    if (dom) return finishReddit(tab, rid, R.threadFromDom(dom), { mode: 'dom', raw: { source: cleanUrl(tab.url), read_from_screen: dom } });
    await step("Couldn't find the post on the page either. Saving it as an ordinary page.");
    return snapshotPage(tab);
  }

  const t = R.newThread(first);
  const raw = { source: cleanUrl(tab.url), fetched: [{ url: jsonUrl, data: first }] };
  let failures = 0;
  let stopped = false;
  await step(`Got the post and ${t.index.size} comments.`);
  for (;;) {
    if (!t.pending.length) break;
    if (t.requests >= LIMITS.moreRequests) { stopped = true; break; }
    const req = R.takeNextRequest(t);
    if (!req) break;
    await sleep(LIMITS.requestGapMs);
    t.requests++;
    await step(`Loading more comments: ${t.index.size} so far (extra request ${t.requests})…`);
    const url = req.kind === 'continue'
      ? `${rid.origin}/comments/${rid.postId}/_/${req.parent.slice(3)}/.json?raw_json=1&limit=500`
      : `${rid.origin}/api/morechildren.json?api_type=json&link_id=t3_${rid.postId}&children=${req.ids.join(',')}&raw_json=1&limit_children=false`;
    try {
      const data = await redditJson(tab.id, url);
      raw.fetched.push({ url, data });
      if (req.kind === 'continue') R.ingestContinue(t, data);
      else R.ingestMoreChildren(t, data);
    } catch (e) {
      failures++;
      t.failed.push({ ...req, error: e.message });
      await step(`A "load more" request failed (${e.message}).`);
      if (failures >= 3) {
        stopped = true;
        await step('Reddit stopped answering "load more" requests. Keeping what we have.');
        break;
      }
    }
  }
  return finishReddit(tab, rid, t, { mode: 'json', raw, stopped });
}

async function finishReddit(tab, rid, t, opts) {
  R.numberTree(t);
  const sub = t.post.subreddit || String(t.post.subreddit_name_prefixed || '').replace(/^r\//i, '');
  const folder = makeFolder(['reddit', sub, t.post.title || tab.title]);
  const postMedia = R.collectPostMedia(t.post, LIMITS.pictureCandidates);
  const commentMedia = R.collectCommentMedia(t, LIMITS.pictureCandidates);

  if (opts.raw) {
    await step('Saving the raw data (raw.json)…');
    await saveText(`${folder}/raw.json`, JSON.stringify(opts.raw), 'application/json');
  }
  const book = newPictureBook(); // shared, so a comment re-posting the post's picture is a repeat
  await savePictureList(postMedia, folder, 'post', LIMITS.postPictures, book);
  await savePictureList(commentMedia, folder, 'comment', LIMITS.commentPictures, book);

  const md = R.renderThread(t, {
    version: VERSION, capturedAt: utcStamp(), sourceUrl: cleanUrl(tab.url), focus: rid.commentId, mode: opts.mode,
    stopped: opts.stopped, maxRequests: LIMITS.moreRequests, postMedia, commentMedia,
  });
  const pics = [...postMedia, ...commentMedia];
  return saveSnapshot(folder, md, pics,
    `${fmtInt(t.index.size)} comments, ${pictureSummary(pics)}${opts.mode === 'dom' ? ', read from screen' : ''}`);
}

// ---------------------------------------------------------------- Reddit profile

async function snapshotProfile(tab, who) {
  await step(`Reading u/${who.name}'s profile…`);
  const pr = P.newProfile(who);
  const raw = { source: cleanUrl(tab.url), fetched: [] };
  try {
    const url = P.aboutUrl(who);
    const about = await redditJson(tab.id, url);
    raw.fetched.push({ url, data: about });
    P.ingestAbout(pr, about);
  } catch (e) {
    await step(`Couldn't read the account summary (${e.message}). Carrying on with the history.`);
  }

  let stopped = false;
  let stoppedNote = '';
  for (let page = 0; page < LIMITS.profilePages; page++) {
    if (page > 0) await sleep(LIMITS.requestGapMs);
    const url = P.listingUrl(who, pr.after);
    let data;
    try {
      data = await redditJson(tab.id, url);
    } catch (e) {
      if (page === 0) {
        if (pr.about?.is_suspended) throw new Error('Reddit says this account is suspended, so its history is hidden.');
        await step(`Reddit's data view didn't work (${e.message}). Saving the page as it looks instead.`);
        return snapshotPage(tab);
      }
      await step(`Reddit stopped answering after ${page} pages (${e.message}). Keeping what we have.`);
      stopped = true;
      stoppedNote = `Reddit stopped answering after ${page} page${page === 1 ? '' : 's'}, so older items are not included.`;
      break;
    }
    raw.fetched.push({ url, data });
    const added = P.ingestPage(pr, data);
    await step(`Loaded ${fmtInt(pr.items.length)} posts and comments…`);
    if (!pr.after || !added) break;
    if (page === LIMITS.profilePages - 1) stopped = true;
  }

  const folder = makeFolder(['reddit', 'u', who.name]);
  const media = P.collectProfileMedia(pr, LIMITS.pictureCandidates);
  await step('Saving the raw data (raw.json)…');
  await saveText(`${folder}/raw.json`, JSON.stringify(raw), 'application/json');
  await savePictureList(media, folder, 'pic', LIMITS.profilePictures, newPictureBook());
  const md = P.renderProfile(pr, {
    version: VERSION, capturedAt: utcStamp(), sourceUrl: cleanUrl(tab.url), stopped, stoppedNote,
    maxPages: LIMITS.profilePages, media,
  });
  const posts = pr.items.filter((it) => it.kind === 't3').length;
  return saveSnapshot(folder, md, media,
    `u/${who.name}: ${fmtInt(posts)} posts, ${fmtInt(pr.items.length - posts)} comments, ${pictureSummary(media)}`);
}

async function redditJson(tabId, url) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await tabFetchJson(tabId, url);
    } catch (e) {
      if (e.status === 429 && attempt < 3) {
        await step('Reddit asked us to slow down. Waiting a few seconds…');
        await sleep(6000 * attempt);
        continue;
      }
      throw e;
    }
  }
}

// The request is made from inside the Reddit tab, so it goes out exactly like your own browsing does.
async function tabFetchJson(tabId, url) {
  const r = await runInTab(tabId, async (u) => {
    try {
      const res = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      return { status: 0, error: String(e) };
    }
  }, [url]);
  if (!r) throw new Error('no answer from the tab');
  if (r.status !== 200) {
    const err = new Error(r.status ? `HTTP ${r.status}` : (r.error || 'network error'));
    err.status = r.status;
    throw err;
  }
  try {
    return JSON.parse(r.text);
  } catch {
    throw new Error('got a web page instead of data (blocked, or a login wall)');
  }
}

async function runInTab(tabId, func, args = []) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.[0]?.result;
}

// ---------------------------------------------------------------- any other page

async function snapshotPage(tab) {
  await step('Reading the page…');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['vendor/Readability.js', 'vendor/turndown.js', 'vendor/turndown-plugin-gfm.js'],
    });
  } catch (e) {
    throw new Error(`Chrome wouldn't let RedAnt read this page (${e.message}).`);
  }
  const page = await runInTab(tab.id, extractPage);
  if (!page) throw new Error('Could not read this page.');
  let host = '';
  try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
  const folder = makeFolder([host, page.title || tab.title]);
  const pics = page.images.slice(0, LIMITS.pictureCandidates);
  await savePictureList(pics, folder, 'img', LIMITS.pagePictures, newPictureBook());
  const body = String(page.markdown || '').replace(/REDANT_IMG_(\d+)/g, (_all, n) => {
    const m = page.images[Number(n)];
    if (!m) return '';
    return m.result?.ok ? m.result.file : m.url;
  });
  const md = renderPage(page, { body, version: VERSION, capturedAt: utcStamp(), url: cleanUrl(tab.url), tabTitle: tab.title });
  return saveSnapshot(folder, md, pics, `${page.mode === 'reader' ? 'main text' : 'full page text'}, ${pictureSummary(pics)}`);
}

async function snapshotPdf(tab) {
  await step('Saving the PDF…');
  const name = decodeURIComponent(baseName(new URL(tab.url).pathname)).replace(/\.pdf$/i, '');
  const folder = makeFolder(['pdf', name || tab.title]);
  const r = await offscreen({ type: 'blobFromUrl', url: tab.url, allowPdf: true });
  let item;
  if (r.ok && r.ext === 'pdf') {
    try { item = await downloadTo(r.blobUrl, `${folder}/document.pdf`); } finally { offscreen({ type: 'revoke', blobUrl: r.blobUrl }).catch(() => {}); }
  } else {
    item = await downloadTo(tab.url, `${folder}/document.pdf`);
  }
  return { path: item.filename, downloadId: item.id, stats: null, summary: 'PDF saved as it is' };
}

// ---------------------------------------------------------------- saving files

// Save a list of pictures, skipping repeats (see lib/pictures.js). `max` = new files allowed.
async function savePictureList(list, folder, prefix, max, book) {
  return savePictures(list, {
    folder, prefix, max, book,
    fetchPic, writePic, discard: discardPic,
    progress: (i, n) => step(`Saving pictures ${i}/${n}…`),
  });
}

// Fetch a picture and check what it really is (so it's saved with the right extension), trying the
// full-size address first and the preview address second.
async function fetchPic(media) {
  const candidates = [media.url, media.fallback].filter(Boolean);
  let lastError = 'no address';
  let onlyNetworkErrors = true;
  for (const url of candidates) {
    let r;
    try {
      r = await offscreen({ type: 'blobFromUrl', url });
    } catch (e) {
      r = { ok: false, kind: 'error', error: e.message };
    }
    if (r.ok) return { ok: true, from: url, blobUrl: r.blobUrl, ext: r.ext, hash: r.hash, bytes: r.bytes };
    lastError = r.error;
    if (r.kind !== 'network') onlyNetworkErrors = false;
  }
  // Last try, only if the site refused our direct request: let Chrome download it like a normal click.
  if (onlyNetworkErrors && candidates.length) {
    const ext = extFromUrl(candidates[0]);
    if (ext) return { ok: true, from: candidates[0], direct: true, ext };
  }
  return { ok: false, error: lastError };
}

async function writePic(f, relNoExt) {
  try {
    const item = await downloadTo(f.direct ? f.from : f.blobUrl, `${relNoExt}.${f.ext}`);
    return { ok: true, file: `images/${baseName(item.filename)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    discardPic(f);
  }
}

function discardPic(f) {
  if (f.blobUrl) offscreen({ type: 'revoke', blobUrl: f.blobUrl }).catch(() => {});
}

async function saveText(rel, text, mime) {
  const r = await offscreen({ type: 'blobFromText', text, mime });
  if (!r.ok) throw new Error(`couldn't prepare ${baseName(rel)}: ${r.error}`);
  try {
    return await downloadTo(r.blobUrl, rel);
  } finally {
    offscreen({ type: 'revoke', blobUrl: r.blobUrl }).catch(() => {});
  }
}

async function downloadTo(url, rel) {
  const id = await chrome.downloads.download({ url, filename: rel, conflictAction: 'uniquify', saveAs: false });
  const item = await waitDownload(id);
  if (!item || item.state !== 'complete') {
    throw new Error(`download ${item?.state || 'failed'}${item?.error ? ` (${item.error})` : ''}`);
  }
  return item; // item.filename is the full path on disk
}

function waitDownload(id, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      const [item] = await chrome.downloads.search({ id });
      resolve(item);
    };
    const onChanged = (d) => {
      if (d.id === id && d.state && (d.state.current === 'complete' || d.state.current === 'interrupted')) finish();
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.cancel(id).catch(() => {});
      resolve({ state: 'timed out' });
    }, timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then(([item]) => {
      if (item && (item.state === 'complete' || item.state === 'interrupted')) finish();
    });
  });
}

// ---------------------------------------------------------------- helper page (files + clipboard)

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS', 'CLIPBOARD'],
      justification: 'Turn saved text and pictures into files, and copy the saved file path.',
    }).catch((e) => {
      if (!/single offscreen|already/i.test(String(e?.message))) throw e;
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
}

async function offscreen(msg) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
  if (r === undefined) throw new Error('the file helper did not answer');
  return r;
}

async function copyText(text) {
  try {
    const r = await offscreen({ type: 'copy', text });
    return !!r?.ok;
  } catch {
    return false;
  }
}
