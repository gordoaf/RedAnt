// Reddit profiles: a user's posts and comments, newest first, from the list the profile page shows.
// No chrome.* calls in here, so the tests can run all of it directly.
import { fromEpoch, fmtInt, oneLine, SIZE_MARK } from './util.js';
import { collectPostMedia, mediaInComment, replaceMedia } from './reddit.js';
import { pictureWhere } from './pictures.js';

const LISTS = {
  overview: 'posts and comments',
  submitted: 'posts only',
  comments: 'comments only',
  saved: 'saved items',
  upvoted: 'upvoted items',
  downvoted: 'downvoted items',
  hidden: 'hidden items',
  gilded: 'awarded items',
};
const SORTS = ['new', 'top', 'hot', 'controversial'];
const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'];

// /user/NAME or /u/NAME, optionally with the profile tab (/submitted, /posts, /comments, ...).
// A post made on a profile (/user/NAME/comments/ID/...) is a thread, not a profile.
export function parseProfileUrl(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/(^|\.)reddit\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:user|u)\/([A-Za-z0-9_-]{1,40})(?:\/([A-Za-z]+))?\/?$/);
  if (!m) return null;
  let list = (m[2] || 'overview').toLowerCase();
  if (list === 'posts') list = 'submitted';
  if (!LISTS[list]) list = 'overview';
  const sort = SORTS.includes(u.searchParams.get('sort')) ? u.searchParams.get('sort') : 'new';
  const t = TIMES.includes(u.searchParams.get('t')) ? u.searchParams.get('t') : '';
  return { name: m[1], list, sort, t, origin: u.origin };
}

export function listingUrl(who, after) {
  return `${who.origin}/user/${who.name}/${who.list}.json?limit=100&raw_json=1&sort=${who.sort}` +
    (who.t ? `&t=${who.t}` : '') + (after ? `&after=${after}` : '');
}

export function aboutUrl(who) {
  return `${who.origin}/user/${who.name}/about.json?raw_json=1`;
}

export function newProfile(who) {
  return { who, about: null, items: [], seen: new Set(), pages: 0, after: null };
}

export function ingestAbout(pr, json) {
  pr.about = json?.data || null;
}

// One page (up to 100 items) of the profile list. Returns how many new items it added.
export function ingestPage(pr, json) {
  const d = json?.data;
  if (!d || !Array.isArray(d.children)) throw new Error('unexpected reply for the profile list');
  let added = 0;
  for (const ch of d.children) {
    const x = ch && ch.data;
    if (!x || (ch.kind !== 't1' && ch.kind !== 't3')) continue;
    const key = x.name || `${ch.kind}_${x.id}`;
    if (pr.seen.has(key)) continue;
    pr.seen.add(key);
    pr.items.push({ kind: ch.kind, d: x, num: 0 });
    added++;
  }
  pr.pages++;
  pr.after = d.after || null;
  return added;
}

export function collectProfileMedia(pr, limit = 40) {
  pr.items.forEach((it, i) => { it.num = i + 1; });
  const out = [];
  for (const it of pr.items) {
    if (out.length >= limit) break;
    const found = it.kind === 't3'
      ? collectPostMedia(it.d, 10).map((m) => ({ ...m, label: `in post [${it.num}] (${m.label})` }))
      : mediaInComment(it.d.media_metadata, it.d.body).map((m) => ({ ...m, label: `in comment [${it.num}]` }));
    for (const m of found) {
      if (out.length >= limit) break;
      out.push({ ...m, owner: it });
    }
  }
  return out;
}

function topSubreddits(items, n = 10) {
  const counts = new Map();
  for (const it of items) {
    const s = it.d.subreddit_name_prefixed || (it.d.subreddit ? `r/${it.d.subreddit}` : '');
    if (s) counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const plural = (n, word) => `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`;
const points = (score) => (score == null || score === '' ? '' : `${fmtInt(score)} pt${Math.abs(Number(score)) === 1 ? '' : 's'}`);

// o: { version, capturedAt, sourceUrl, stopped, maxPages, media }
export function renderProfile(pr, o) {
  const who = pr.who;
  const a = pr.about || {};
  const media = o.media || [];
  const byItem = new Map();
  for (const m of media) {
    if (!byItem.has(m.owner)) byItem.set(m.owner, []);
    byItem.get(m.owner).push(m);
  }
  const posts = pr.items.filter((it) => it.kind === 't3').length;
  const comments = pr.items.length - posts;
  const L = [];

  L.push(`# u/${who.name}: Reddit profile`, '', SIZE_MARK, '');
  L.push(`Saved by RedAnt ${o.version} on ${o.capturedAt}. Activity is numbered from newest [1] to oldest. ` +
    'Picture files are in the images folder next to this file.', '');

  const facts = [];
  if (a.is_suspended) facts.push(['Status', 'suspended by Reddit']);
  if (a.created_utc) {
    const years = (Date.now() / 1000 - a.created_utc) / (365.25 * 86400);
    facts.push(['Account created', `${fromEpoch(a.created_utc)} (${years.toFixed(1)} years ago)`]);
  }
  if (a.total_karma != null || a.link_karma != null) {
    facts.push(['Karma', `${fmtInt(a.total_karma ?? (a.link_karma || 0) + (a.comment_karma || 0))} total ` +
      `(${fmtInt(a.link_karma ?? 0)} from posts, ${fmtInt(a.comment_karma ?? 0)} from comments)`]);
  }
  const desc = a.subreddit?.public_description;
  if (desc && desc.trim()) facts.push(['Profile description', oneLine(desc)]);
  const extras = [a.is_mod && 'moderates at least one subreddit', a.is_employee && 'Reddit employee',
    a.verified && 'verified', a.is_gold && 'Reddit Premium'].filter(Boolean);
  if (extras.length) facts.push(['Also', extras.join(', ')]);
  facts.push(['Showing', `${LISTS[who.list] || who.list}, sorted by ${who.sort}${who.t ? ` (${who.t})` : ''}`]);
  let saved = `${plural(pr.items.length, 'item')} (${plural(posts, 'post')}, ${plural(comments, 'comment')})`;
  if (pr.items.length) {
    const times = pr.items.map((it) => it.d.created_utc).filter((x) => typeof x === 'number');
    if (times.length) saved += `, from ${fromEpoch(Math.max(...times))} back to ${fromEpoch(Math.min(...times))}`;
  }
  facts.push(['Saved', saved]);
  let note;
  if (o.stopped) note = o.stoppedNote || `RedAnt stopped after ${o.maxPages} pages, so older items are not included.`;
  else if (!pr.after && pr.items.length < 950) {
    note = 'This is everything Reddit lists for this account. Posts and comments that were deleted or removed are not listed.';
  } else if (!pr.after) note = "Reddit stops listing at about 1,000 items, so anything older isn't included.";
  else note = "Reddit only lists about a user's latest 1,000 items per list, so older history may be missing.";
  facts.push(['Note', note]);
  const subs = topSubreddits(pr.items);
  if (subs.length) facts.push(['Most active in', subs.map(([s, n]) => `${s} (${fmtInt(n)})`).join(', ')]);
  facts.push(['Source', o.sourceUrl]);
  for (const [k, v] of facts) if (v) L.push(`- **${k}:** ${v}`);

  L.push('', '## Activity (newest first)', '');
  if (!pr.items.length) L.push('_(nothing listed)_', '');
  for (const it of pr.items) {
    const x = it.d;
    const sub = x.subreddit_name_prefixed || (x.subreddit ? `r/${x.subreddit}` : '');
    const pics = byItem.get(it) || [];
    if (it.kind === 't3') {
      const head = [`### [${it.num}] POST in ${sub}`, points(x.score),
        x.num_comments != null ? plural(x.num_comments, 'comment') : '', fromEpoch(x.created_utc), x.edited ? 'edited' : '']
        .filter(Boolean).join(' · ');
      L.push(head, '', `**${oneLine(x.title) || '(untitled)'}**`, '');
      if (x.permalink) L.push(`- Thread: https://www.reddit.com${x.permalink}`);
      const link = x.url_overridden_by_dest || x.url || '';
      if (link && !x.is_self && !/^https?:\/\/(?:[\w-]+\.)?reddit\.com\//i.test(link)) L.push(`- Links to: ${link}`);
      if (x.link_flair_text) L.push(`- Flair: ${oneLine(x.link_flair_text)}`);
      if (x.over_18) L.push('- NSFW');
      if (pics.length) L.push(`- Pictures: ${pics.map(pictureWhere).join(', ')}`);
      const body = replaceMedia(x.selftext || '', pics).trim();
      L.push('', body || '_(no text in the post itself)_', '');
    } else {
      const head = [`### [${it.num}] COMMENT in ${sub}`, points(x.score), fromEpoch(x.created_utc), x.edited ? 'edited' : '']
        .filter(Boolean).join(' · ');
      L.push(head, '');
      const on = x.link_title ? `On "${oneLine(x.link_title)}"${x.link_author ? ` by u/${x.link_author}` : ''}` : 'On a post';
      L.push(`${on}${x.is_submitter ? ' (their own post)' : ''}${x.permalink ? ` · https://www.reddit.com${x.permalink}` : ''}`, '');
      L.push(replaceMedia(x.body || '', pics).trim() || '(no text)', '');
    }
  }

  if (media.length) {
    L.push('## Picture files', '');
    for (const m of media) L.push(`- ${pictureWhere(m)} — ${m.label} — original: ${m.result?.from || m.url}`);
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
