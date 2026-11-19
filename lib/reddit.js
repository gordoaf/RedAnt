// Reddit threads: build the comment tree from Reddit's JSON, find the pictures, write the markdown.
// No chrome.* calls in here, so the tests can run all of it directly.
import { fromEpoch, fmtInt, oneLine, SIZE_MARK } from './util.js';
import { pictureWhere } from './pictures.js';

const IMG_PATH = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const URL_RE = /https?:\/\/[^\s<>()[\]"']+/g;

// ---------------------------------------------------------------- addresses

// Works for www / old / new reddit, /r/sub/comments/ID/..., /user/x/comments/ID/..., comment
// permalinks (/comments/ID/slug/COMMENTID or /comments/ID/comment/COMMENTID) and /gallery/ID.
export function parseRedditUrl(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/(^|\.)reddit\.com$/i.test(u.hostname)) return null;
  let m = u.pathname.match(/^\/(?:(?:r|u|user)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/[^/]*(?:\/([a-z0-9]+))?)?/i);
  if (m) return { postId: m[1].toLowerCase(), commentId: m[2] ? m[2].toLowerCase() : null, origin: u.origin };
  m = u.pathname.match(/^\/gallery\/([a-z0-9]+)/i);
  if (m) return { postId: m[1].toLowerCase(), commentId: null, origin: u.origin };
  return null;
}

// ---------------------------------------------------------------- comment tree

function blankThread(post) {
  return { post, roots: [], index: new Map(), pending: [], failed: [], continued: new Set(), requests: 0 };
}

// json = what /comments/ID/.json returns: [post listing, comment listing]
export function newThread(json) {
  if (!Array.isArray(json) || json.length < 2) throw new Error('Reddit sent something other than a post with comments');
  const post = json[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('Reddit reply had no post in it');
  const t = blankThread(post);
  ingestChildren(t, json[1]?.data?.children || []);
  return t;
}

// Answer to /api/morechildren ("load more comments"): a flat list of comments.
export function ingestMoreChildren(t, resp) {
  const things = resp?.json?.data?.things;
  if (!Array.isArray(things)) {
    const errs = resp?.json?.errors;
    throw new Error(errs?.length ? `Reddit said: ${JSON.stringify(errs).slice(0, 200)}` : 'unexpected reply to "load more"');
  }
  return ingestChildren(t, things);
}

// Answer to /comments/POST/_/COMMENT/.json ("continue this thread"): that comment with its replies.
export function ingestContinue(t, json) {
  const children = Array.isArray(json) ? json[1]?.data?.children : null;
  if (!Array.isArray(children)) throw new Error('unexpected reply to "continue this thread"');
  return ingestChildren(t, children);
}

function makeNode(d) {
  return {
    id: d.id,
    parent: d.parent_id || '',
    author: d.author || '[unknown]',
    body: d.body ?? '',
    score: d.score ?? null,
    scoreHidden: !!d.score_hidden,
    created: d.created_utc ?? null,
    edited: !!d.edited,
    isOp: !!d.is_submitter,
    distinguished: d.distinguished || null,
    stickied: !!d.stickied,
    media: d.media_metadata || null,
    domImages: null,
    children: [],
    num: '',
    orphan: false,
  };
}

function collect(t, children, fresh) {
  for (const ch of children || []) {
    const d = ch && ch.data;
    if (!d) continue;
    if (ch.kind === 't1') {
      if (!t.index.has(d.id)) {
        const n = makeNode(d);
        t.index.set(d.id, n);
        fresh.push(n);
      }
      const replies = d.replies && d.replies.data && d.replies.data.children;
      if (replies) collect(t, replies, fresh);
    } else if (ch.kind === 'more') {
      addMore(t, d);
    }
  }
}

function addMore(t, d) {
  const parent = d.parent_id || '';
  const ids = (d.children || []).filter((id) => !t.index.has(id));
  if (ids.length) {
    t.pending.push({ kind: 'more', parent, ids, depth: d.depth ?? 0 });
    return;
  }
  // "continue this thread": an empty 'more' whose replies live on the parent comment's own page
  const isContinue = (d.id === '_' || !d.count) && parent.startsWith('t1_');
  if (isContinue && !t.continued.has(parent) && !t.pending.some((p) => p.kind === 'continue' && p.parent === parent)) {
    t.pending.push({ kind: 'continue', parent, depth: d.depth ?? 99 });
  }
}

function ingestChildren(t, children) {
  const fresh = [];
  collect(t, children, fresh);
  for (const n of fresh) {
    const parent = n.parent.startsWith('t1_') ? t.index.get(n.parent.slice(3)) : null;
    if (parent && parent !== n) {
      parent.children.push(n);
    } else {
      if (n.parent.startsWith('t1_')) n.orphan = true;
      t.roots.push(n);
    }
  }
  return fresh.length;
}

// Next "load more" to fetch. Shallowest first, so top-level comments come before deep reply chains.
export function takeNextRequest(t) {
  while (t.pending.length) {
    let bi = 0;
    for (let i = 1; i < t.pending.length; i++) if (t.pending[i].depth < t.pending[bi].depth) bi = i;
    const p = t.pending[bi];
    if (p.kind === 'continue') {
      t.pending.splice(bi, 1);
      t.continued.add(p.parent);
      return p;
    }
    const ids = p.ids.splice(0, 100).filter((id) => !t.index.has(id));
    if (!p.ids.length) t.pending.splice(bi, 1);
    if (ids.length) return { kind: 'more', parent: p.parent, ids, depth: p.depth };
  }
  return null;
}

export function leftover(t) {
  let ids = 0;
  let threads = 0;
  for (const p of [...t.pending, ...t.failed]) {
    if (p.kind === 'continue') threads++;
    else ids += (p.ids || []).length;
  }
  return { ids, threads };
}

export function numberTree(t) {
  const walk = (nodes, prefix) => nodes.forEach((n, i) => {
    n.num = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    walk(n.children, n.num);
  });
  walk(t.roots, '');
}

// Fallback when Reddit's data view is blocked: build the same shape from what scrapeRedditDom() read.
export function threadFromDom(d) {
  const toSec = (s) => {
    const ms = Date.parse(s || '');
    return isNaN(ms) ? null : ms / 1000;
  };
  const post = {
    title: d.title,
    author: d.author || '',
    subreddit_name_prefixed: d.subreddit || '',
    score: d.score,
    num_comments: d.comments,
    created_utc: toSec(d.created),
    selftext: d.body || '',
    url: d.link || '',
    is_self: !d.link || /reddit\.com/i.test(d.link),
    domImages: d.images || [],
  };
  const t = blankThread(post);
  const stack = [];
  (d.commentsList || []).forEach((c, i) => {
    const id = (c.id || '').replace(/^t1_/, '') || `screen${i + 1}`;
    if (t.index.has(id)) return;
    const n = makeNode({ id, parent_id: c.parent || '', author: c.author, body: c.body, created_utc: toSec(c.created) });
    n.score = c.score === '' || c.score == null ? null : c.score;
    n.isOp = !!(c.author && post.author && c.author === post.author);
    n.domImages = c.images || [];
    t.index.set(id, n);
    const depth = Math.max(0, c.depth | 0);
    stack.length = Math.min(stack.length, depth);
    const parent = depth > 0 ? stack[stack.length - 1] : null;
    if (parent) parent.children.push(n);
    else t.roots.push(n);
    stack.push(n);
  });
  return t;
}

// ---------------------------------------------------------------- pictures

export function metaImage(key, meta) {
  if (!meta || (meta.status && meta.status !== 'valid')) return null;
  if (String(key).includes('|')) return null; // emotes and giphy reaction gifs
  const s = meta.s || {};
  if (meta.e === 'AnimatedImage') {
    const url = s.gif || s.mp4;
    return url ? { url, fallback: s.gif && s.mp4 ? s.mp4 : null, token: key } : null;
  }
  if (meta.e && meta.e !== 'Image') return null; // videos etc.
  const preview = s.u || (Array.isArray(meta.p) && meta.p.length ? meta.p[meta.p.length - 1].u : null) || null;
  if (!/^[a-z0-9]+$/i.test(key)) return preview ? { url: preview, fallback: null, token: key } : null;
  const ext = (String(meta.m || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  return { url: `https://i.redd.it/${key}.${ext}`, fallback: preview, token: key };
}

// preview.redd.it pictures are resized copies; the full-size original sits on i.redd.it.
export function redditImageUrl(u) {
  try {
    const x = new URL(u);
    if (x.hostname === 'preview.redd.it') {
      const m = x.pathname.match(/^\/(?:.*-v0-)?([a-z0-9]+)\.(jpe?g|png|gif|webp)$/i);
      if (m) return { url: `https://i.redd.it/${m[1]}.${m[2].toLowerCase().replace('jpeg', 'jpg')}`, fallback: u, token: m[1] };
    }
  } catch { /* not a valid address */ }
  return { url: u, fallback: null, token: null };
}

export const withToken = (m, u) => ({ ...m, token: m.token || u });

function isImageUrl(u) {
  try {
    const x = new URL(u);
    return /^i\.redd\.it$/i.test(x.hostname) || IMG_PATH.test(x.pathname);
  } catch {
    return false;
  }
}

const isVideo = (p) => !!(p.is_video || /video/i.test(p.post_hint || '') || p.secure_media?.reddit_video || p.media?.reddit_video);

export function findImageLinks(text) {
  const out = [];
  for (const raw of String(text || '').match(URL_RE) || []) {
    const u = raw.replace(/[.,;:!?]+$/, '');
    if (isImageUrl(u) && !/^https?:\/\/i\.redd\.it\/?$/i.test(u)) out.push(u);
  }
  return [...new Set(out)];
}

export function collectPostMedia(post, limit = 40) {
  const out = [];
  const add = (m, label) => {
    if (!m || !m.url || out.length >= limit) return;
    if (out.some((x) => x.url === m.url || (m.token && x.token === m.token))) return;
    out.push({ ...m, label, owner: 'post' });
  };
  const sources = [post, ...(Array.isArray(post.crosspost_parent_list) ? post.crosspost_parent_list : [])];
  sources.forEach((p, si) => {
    const from = si ? ' (from the original post this was crossposted from)' : '';
    if (p.is_gallery && p.gallery_data?.items?.length) {
      const items = p.gallery_data.items;
      items.forEach((it, i) => add(
        metaImage(it.media_id, p.media_metadata?.[it.media_id]),
        `gallery picture ${i + 1} of ${items.length}` +
          (it.caption ? ` — caption: "${oneLine(it.caption)}"` : '') +
          (it.outbound_url ? ` — links to ${it.outbound_url}` : '') + from,
      ));
    } else {
      const url = p.url_overridden_by_dest || p.url || '';
      if (isImageUrl(url)) {
        add(withToken(redditImageUrl(url), url), `the post's picture${from}`);
      } else {
        const src = p.preview?.images?.[0]?.source?.url;
        if (src) add({ url: src, fallback: null, token: null }, (isVideo(p) ? 'still frame from the video' : 'preview picture of the linked page') + from);
      }
      if (p.media_metadata) {
        for (const [k, meta] of Object.entries(p.media_metadata)) add(metaImage(k, meta), `picture inside the post text${from}`);
      }
    }
    for (const u of findImageLinks(p.selftext)) add(withToken(redditImageUrl(u), u), `picture linked in the post text${from}`);
  });
  for (const u of post.domImages || []) add(withToken(redditImageUrl(u), u), 'picture in the post');
  return out;
}

// Pictures in one comment: Reddit-hosted ones (media_metadata), picture links in its text,
// and ones read from the screen.
export function mediaInComment(media, body, domImages) {
  const mine = [];
  const add = (m) => {
    if (!m || !m.url) return;
    if (mine.some((x) => x.url === m.url || (m.token && x.token === m.token))) return;
    mine.push(m);
  };
  if (media) for (const [k, meta] of Object.entries(media)) add(metaImage(k, meta));
  for (const u of findImageLinks(body)) add(withToken(redditImageUrl(u), u));
  for (const u of domImages || []) add(withToken(redditImageUrl(u), u));
  return mine;
}

export function collectCommentMedia(t, limit = 40) {
  const out = [];
  const visit = (n) => {
    for (const m of mediaInComment(n.media, n.body, n.domImages)) {
      if (out.length >= limit) break;
      out.push({ ...m, owner: n, label: `in comment [${n.num}] by u/${n.author}` });
    }
    n.children.forEach(visit);
  };
  t.roots.forEach(visit);
  return out;
}

// ---------------------------------------------------------------- markdown

function tagFor(m) {
  if (!m.result) return null;
  return m.result.ok ? `[picture: ${m.result.file}]` : `[picture not saved: ${m.url}]`;
}

// Swap picture links in a post or comment for the saved file's name.
export function replaceMedia(text, items) {
  let s = String(text ?? '');
  const find = (target) => items.find((m) => m.token && target.includes(m.token));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (all, _alt, target) => {
    if (/^giphy\|/i.test(target)) return '[reaction gif]';
    if (/^emote\|/i.test(target)) return '[emote]';
    const m = find(target);
    return (m && tagFor(m)) || all;
  });
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (all, label, target) => {
    const m = find(target);
    const tag = m && tagFor(m);
    return tag ? `${label} ${tag}` : all;
  });
  s = s.replace(URL_RE, (u) => {
    const m = find(u);
    return (m && tagFor(m)) || u;
  });
  return s;
}

function pictureLine(m) {
  return `${pictureWhere(m)} — ${m.label}`;
}

// o: { version, capturedAt, sourceUrl, focus, mode: 'json'|'dom', stopped, maxRequests, postMedia, commentMedia }
export function renderThread(t, o) {
  const p = t.post;
  const postMedia = o.postMedia || [];
  const commentMedia = o.commentMedia || [];
  const byNode = new Map();
  for (const m of commentMedia) {
    if (!byNode.has(m.owner)) byNode.set(m.owner, []);
    byNode.get(m.owner).push(m);
  }
  const L = [];

  L.push(`# ${oneLine(p.title) || '(untitled post)'}`, '', SIZE_MARK, '');
  L.push(`Saved by RedAnt ${o.version} on ${o.capturedAt}. Comments are numbered by their place in the thread: ` +
    '[2.1] is the first reply to comment [2]. Picture files are in the images folder next to this file.', '');

  const facts = [];
  facts.push(['Subreddit', p.subreddit_name_prefixed || (p.subreddit ? `r/${p.subreddit}` : '')]);
  facts.push(['Posted by', p.author ? `u/${p.author}${p.author_flair_text ? ` (flair: ${oneLine(p.author_flair_text)})` : ''}` : '']);
  const edited = typeof p.edited === 'number' ? fromEpoch(p.edited) : '';
  facts.push(['Posted', fromEpoch(p.created_utc) + (p.edited ? ` (edited${edited ? ' ' + edited : ''})` : '')]);
  const ratio = typeof p.upvote_ratio === 'number' ? ` (${Math.round(p.upvote_ratio * 100)}% upvoted)` : '';
  facts.push(['Score', p.score != null && p.score !== '' ? fmtInt(p.score) + ratio : '']);
  let comments = `${fmtInt(t.index.size)} saved`;
  if (p.num_comments != null && p.num_comments !== '') {
    comments += ` (Reddit's count: ${fmtInt(p.num_comments)}, which also counts deleted and removed ones)`;
  }
  facts.push(['Comments', comments]);
  if (p.link_flair_text) facts.push(['Post flair', oneLine(p.link_flair_text)]);
  const link = p.url_overridden_by_dest || p.url || '';
  if (link && !p.is_self && !/^https?:\/\/(?:[\w-]+\.)?reddit\.com\//i.test(link)) facts.push(['Links to', link]);
  const video = p.secure_media?.reddit_video?.fallback_url || p.media?.reddit_video?.fallback_url;
  if (video) facts.push(['Video', `${video.split('?')[0]} (the video itself is not saved)`]);
  const flags = [p.over_18 && 'NSFW', p.spoiler && 'spoiler', p.locked && 'locked',
    p.removed_by_category && `removed (${p.removed_by_category})`].filter(Boolean);
  if (flags.length) facts.push(['Flags', flags.join(', ')]);
  facts.push(['Source', o.sourceUrl]);
  if (o.mode === 'dom') {
    facts.push(['How saved', "read from the page on screen because Reddit's data view was blocked, so only " +
      'comments that were showing are included and scores may be rounded']);
  }
  for (const [k, v] of facts) if (v) L.push(`- **${k}:** ${v}`);

  L.push('', '## Post', '');
  L.push(replaceMedia(p.selftext || '', postMedia).trim() || '_(no text in the post itself)_');

  const x = Array.isArray(p.crosspost_parent_list) ? p.crosspost_parent_list[0] : null;
  if (x) {
    L.push('', `### Crossposted from ${x.subreddit_name_prefixed || 'another subreddit'}: "${oneLine(x.title)}" ` +
      `by u/${x.author} (score ${fmtInt(x.score)}, ${fromEpoch(x.created_utc)})`, '');
    L.push(replaceMedia(x.selftext || '', postMedia).trim() || '_(no text)_');
  }

  if (p.poll_data?.options?.length) {
    L.push('', '### Poll', '');
    for (const op of p.poll_data.options) L.push(`- ${oneLine(op.text)}${op.vote_count != null ? ` — ${fmtInt(op.vote_count)} votes` : ''}`);
    if (p.poll_data.total_vote_count != null) L.push(`- (total votes: ${fmtInt(p.poll_data.total_vote_count)})`);
  }

  if (postMedia.length) {
    L.push('', '### Pictures in the post', '');
    postMedia.forEach((m, i) => L.push(`${i + 1}. ${pictureLine(m)}`));
  }

  L.push('', `## Comments (${fmtInt(t.index.size)} saved)`, '');
  if (!t.roots.length) L.push('_(no comments saved)_', '');
  const walk = (n) => {
    const depth = n.num ? n.num.split('.').length - 1 : 0;
    const ind = '  '.repeat(depth);
    const tags = [];
    if (n.isOp) tags.push('OP');
    if (n.distinguished === 'moderator') tags.push('MOD');
    else if (n.distinguished === 'admin') tags.push('ADMIN');
    if (n.stickied) tags.push('pinned');
    if (o.focus && n.id === o.focus) tags.push('THE COMMENT THE LINK POINTED TO');
    const score = n.scoreHidden ? 'score hidden'
      : (n.score != null && n.score !== '' ? `${fmtInt(n.score)} pt${Math.abs(Number(n.score)) === 1 ? '' : 's'}` : '');
    const head = [
      `[${n.num}] u/${n.author}${tags.length ? ` (${tags.join(', ')})` : ''}`,
      score,
      fromEpoch(n.created),
      n.edited ? 'edited' : '',
      n.orphan ? 'reply to a comment that was not saved' : '',
    ].filter(Boolean).join(' · ');
    L.push(ind + head);
    const text = replaceMedia(n.body, byNode.get(n) || []).trim() || '(no text)';
    for (const line of text.split(/\r?\n/)) L.push(line.trim() ? ind + line : '');
    L.push('');
    n.children.forEach(walk);
  };
  t.roots.forEach(walk);

  const lo = leftover(t);
  if (lo.ids || lo.threads || o.stopped) {
    const bits = [];
    if (lo.ids) bits.push(`about ${fmtInt(lo.ids)} comment${lo.ids === 1 ? '' : 's'} behind "load more" links`);
    if (lo.threads) bits.push(`${fmtInt(lo.threads)} deep reply chain${lo.threads === 1 ? '' : 's'} ("continue this thread")`);
    L.push('## Not saved', '');
    L.push(`Some replies were not loaded${bits.length ? ': ' + bits.join(' and ') : ''}.` +
      (o.stopped ? ` RedAnt stops after ${o.maxRequests} extra requests, or when Reddit stops answering, to stay polite to Reddit.` : ''), '');
  }

  const all = [...postMedia, ...commentMedia];
  if (all.length) {
    L.push('## Picture files', '');
    for (const m of all) L.push(`- ${pictureLine(m)} — original: ${m.result?.from || m.url}`);
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
