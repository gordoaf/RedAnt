// Unit tests for the pure logic. Run with: python tests/run_tests.py
import * as U from '../lib/util.js';
import * as R from '../lib/reddit.js';
import { renderPage } from '../lib/page.js';
import * as P from '../lib/profile.js';
import * as PIC from '../lib/pictures.js';
import * as F from './fixtures.js';

const lines = [];
let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`PASS ${name}`); } else { fail++; lines.push(`FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const bytes = (...a) => new Uint8Array(a.flat());
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
let rendered = '';

try {
  // ---- util
  check('slug basic', U.slug('My first month of trading (futures only) 5%!') === 'My-first-month-of-trading-futures-only-5');
  check('slug accents + cap', U.slug('Café déjà vu', 6) === 'Cafe-d', U.slug('Café déjà vu', 6));
  check('slug empty', U.slug('???') === '');
  check('fromEpoch', U.fromEpoch(1763500000) === '2025-11-18 21:06 UTC', U.fromEpoch(1763500000));
  check('fromEpoch bad', U.fromEpoch(null) === '' && U.fromEpoch(0) === '');
  check('fmtInt', U.fmtInt(1234) === '1,234' && U.fmtInt('45') === '45' && U.fmtInt('1.2k') === '1.2k' && U.fmtInt(null) === '');
  check('sniff jpg', U.sniffExt(bytes(0xff, 0xd8, 0xff, 0xe0)) === 'jpg');
  check('sniff png', U.sniffExt(bytes(0x89, str('PNG'), 0x0d, 0x0a, 0x1a, 0x0a)) === 'png');
  check('sniff webp behind .jpg', U.sniffExt(bytes(str('RIFF'), 0, 0, 0, 0, str('WEBP')), 'image/jpeg', 'https://x/a.jpg') === 'webp');
  check('sniff gif', U.sniffExt(bytes(str('GIF89a'))) === 'gif');
  check('sniff mp4', U.sniffExt(bytes(0, 0, 0, 0x18, str('ftypmp42'))) === 'mp4');
  check('sniff avif', U.sniffExt(bytes(0, 0, 0, 0x18, str('ftypavif'))) === 'avif');
  check('sniff html = not a picture', U.sniffExt(bytes(str('\n <!DOCTYPE html><html>')), 'image/jpeg') === null);
  check('sniff pdf', U.sniffExt(bytes(str('%PDF-1.7'))) === 'pdf');
  check('sniff by type', U.sniffExt(bytes(1, 2, 3, 4), 'image/png; charset=x') === 'png');
  check('sniff by url', U.sniffExt(bytes(1, 2, 3, 4), '', 'https://x.com/a/b.JPEG?x=1') === 'jpg');
  check('extFromUrl', U.extFromUrl('https://i.redd.it/x.png') === 'png' && U.extFromUrl('https://x.com/page') === null);
  check('baseName', U.baseName('C:\\Users\\a\\Downloads\\RedAnt\\f\\images\\post_01.png') === 'post_01.png');

  // ---- addresses
  const u1 = R.parseRedditUrl('https://www.reddit.com/r/Daytrading/comments/q1w2e3/my_first_month_of_trading/?share_id=AbC123&utm_medium=ios_app');
  check('url: shared post link', u1 && u1.postId === 'q1w2e3' && u1.commentId === null && u1.origin === 'https://www.reddit.com', JSON.stringify(u1));
  const u2 = R.parseRedditUrl('https://old.reddit.com/r/x/comments/abc/slug/def456/');
  check('url: old reddit comment permalink', u2 && u2.postId === 'abc' && u2.commentId === 'def456' && u2.origin === 'https://old.reddit.com', JSON.stringify(u2));
  const u3 = R.parseRedditUrl('https://www.reddit.com/r/x/comments/abc/comment/def/');
  check('url: new comment permalink', u3 && u3.commentId === 'def', JSON.stringify(u3));
  check('url: no slug', R.parseRedditUrl('https://www.reddit.com/comments/abc/')?.postId === 'abc');
  check('url: user post', R.parseRedditUrl('https://www.reddit.com/user/bob/comments/q1w2/x/')?.postId === 'q1w2');
  check('url: gallery', R.parseRedditUrl('https://www.reddit.com/gallery/zz9')?.postId === 'zz9');
  check('url: subreddit front page is not a post', R.parseRedditUrl('https://www.reddit.com/r/Daytrading/') === null);
  check('url: not reddit', R.parseRedditUrl('https://notreddit.com/r/x/comments/abc/') === null && R.parseRedditUrl('nonsense') === null);

  // ---- thread building
  const t = R.newThread(clone(F.initial));
  check('initial: 4 comments indexed', t.index.size === 4, String(t.index.size));
  check('initial: roots c1,c2', t.roots.map((n) => n.id).join() === 'c1,c2', t.roots.map((n) => n.id).join());
  check('initial: c1 children', t.index.get('c1').children.map((n) => n.id).join() === 'c1a,c1b');
  check('initial: pending = more + continue', t.pending.length === 2 && t.pending.some((p) => p.kind === 'continue' && p.parent === 't1_c1a'), JSON.stringify(t.pending));

  const r1 = R.takeNextRequest(t);
  check('next: shallowest first (top-level more)', r1 && r1.kind === 'more' && r1.ids.join() === 'c3,c4,c5', JSON.stringify(r1));
  R.ingestMoreChildren(t, clone(F.moreReply));
  check('more: roots now c1,c2,c3,c4', t.roots.map((n) => n.id).join() === 'c1,c2,c3,c4', t.roots.map((n) => n.id).join());
  check('more: c3a under c3', t.index.get('c3').children.map((n) => n.id).join() === 'c3a');
  const r2 = R.takeNextRequest(t);
  check('next: depth-1 more before depth-2 continue', r2 && r2.kind === 'more' && r2.ids.join() === 'c6', JSON.stringify(r2));
  t.failed.push({ ...r2, error: 'HTTP 500' }); // pretend it failed
  const r3 = R.takeNextRequest(t);
  check('next: continue thread', r3 && r3.kind === 'continue' && r3.parent === 't1_c1a', JSON.stringify(r3));
  R.ingestContinue(t, clone(F.continueReply));
  check('continue: c1a not duplicated', t.index.get('c1').children.filter((n) => n.id === 'c1a').length === 1);
  check('continue: kept original c1a text', t.index.get('c1a').body.startsWith('Here you go'));
  check('continue: deep reply attached', t.index.get('c1a').children.map((n) => n.id).join() === 'c1a1');
  check('next: nothing left', R.takeNextRequest(t) === null);
  check('leftover counts failed request', JSON.stringify(R.leftover(t)) === '{"ids":1,"threads":0}', JSON.stringify(R.leftover(t)));

  let threw = false;
  try { R.ingestMoreChildren(t, { json: { errors: [['RATELIMIT', 'slow down']] } }); } catch (e) { threw = /RATELIMIT/.test(e.message); }
  check('more: error reply raises a clear error', threw);
  threw = false;
  try { R.newThread({ nope: 1 }); } catch { threw = true; }
  check('newThread rejects junk', threw);

  // big "more" gets split into 100-id requests
  const tb = R.newThread([F.initial[0], { data: { children: [{ kind: 'more', data: { count: 250, parent_id: 't3_x', depth: 0, children: Array.from({ length: 250 }, (_, i) => `id${i}`) } }] } }]);
  const sizes = [];
  for (let q; (q = R.takeNextRequest(tb));) sizes.push(q.ids.length);
  check('more: 250 ids -> 100,100,50', sizes.join() === '100,100,50', sizes.join());

  R.numberTree(t);
  const nums = ['c1', 'c1a', 'c1a1', 'c1b', 'c2', 'c3', 'c3a', 'c4'].map((id) => `${id}=${t.index.get(id).num}`).join(' ');
  check('numbering', nums === 'c1=1 c1a=1.1 c1a1=1.1.1 c1b=1.2 c2=2 c3=3 c3a=3.1 c4=4', nums);

  // ---- pictures
  const pm = R.collectPostMedia(t.post);
  check('post pics: 2 gallery + 1 text link (failed one skipped)', pm.length === 3, JSON.stringify(pm.map((m) => m.url)));
  check('post pics: gallery original on i.redd.it', pm[0].url === 'https://i.redd.it/gal001.png' && pm[0].fallback.startsWith('https://preview.redd.it/gal001.png'));
  check('post pics: jpg gallery item', pm[1].url === 'https://i.redd.it/gal002.jpg');
  check('post pics: caption in label', /gallery picture 1 of 3 — caption: "Week P&L"/.test(pm[0].label), pm[0].label);
  check('post pics: preview link -> original', pm[2].url === 'https://i.redd.it/abc111.png' && pm[2].token === 'abc111', JSON.stringify(pm[2]));

  const cm = R.collectCommentMedia(t);
  check('comment pics: img777 once + imgur jpg (no gifv, no emote, no giphy)', cm.length === 2, JSON.stringify(cm.map((m) => m.url)));
  check('comment pics: owner + label', cm[0].owner === t.index.get('c1a') && cm[0].label === 'in comment [1.1] by u/trader1', cm[0].label);
  check('comment pics: imgur link', cm[1].url === 'https://i.imgur.com/XyZ.jpg');

  const single = R.collectPostMedia({ url: 'https://i.redd.it/one.jpeg', selftext: '' });
  check('single picture post', single.length === 1 && single[0].url === 'https://i.redd.it/one.jpeg');
  const vid = R.collectPostMedia({ is_video: true, url: 'https://v.redd.it/x', preview: { images: [{ source: { url: 'https://external-preview.redd.it/v.png?s=1' } }] } });
  check('video post: still frame', vid.length === 1 && /still frame/.test(vid[0].label));
  const xp = R.collectPostMedia({ url: 'https://www.reddit.com/r/a/comments/1/x', crosspost_parent_list: [{ url: 'https://i.redd.it/orig.png' }] });
  check('crosspost: picture from original', xp.length === 1 && xp[0].url === 'https://i.redd.it/orig.png' && /crossposted/.test(xp[0].label));
  const capped = R.collectPostMedia({ is_gallery: true, gallery_data: { items: Array.from({ length: 50 }, (_, i) => ({ media_id: `m${i}` })) },
    media_metadata: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`m${i}`, { status: 'valid', e: 'Image', m: 'image/jpg' }])) }, 40);
  check('post pics capped at 40', capped.length === 40);

  // pretend downloads: first post picture saved, second failed, third saved; comment pictures saved
  pm[0].result = { ok: true, file: 'images/post_01.png', from: pm[0].url };
  pm[1].result = { ok: false, error: 'HTTP 404' };
  pm[2].result = { ok: true, file: 'images/post_03.png', from: pm[2].url };
  cm[0].result = { ok: true, file: 'images/comment_01.png', from: cm[0].url };
  cm[1].result = { ok: true, file: 'images/comment_02.jpg', from: cm[1].url };

  rendered = R.renderThread(t, { version: '0.1.0', capturedAt: '2026-11-19 10:00 UTC', sourceUrl: 'https://www.reddit.com/r/Daytrading/comments/abc123/first_month/', focus: 'c3', mode: 'json', stopped: false, maxRequests: 40, postMedia: pm, commentMedia: cm });
  const has = (s) => rendered.includes(s);
  check('md: title', rendered.startsWith('# My first month of trading, AMA\n'));
  check('md: facts', has('- **Subreddit:** r/Daytrading') && has('- **Posted by:** u/trader1 (flair: Futures)') && has('- **Score:** 1,234 (87% upvoted)'));
  check('md: comment count', has("- **Comments:** 8 saved (Reddit's count: 12"), rendered.match(/Comments:\*\*.*/)?.[0]);
  check('md: no Links-to for a gallery', !has('Links to'));
  check('md: post link swapped for file', has('Here is my P&L [picture: images/post_03.png]'));
  check('md: post pictures list', has('1. images/post_01.png — gallery picture 1 of 3') && has('2. NOT SAVED (HTTP 404) — gallery picture 2 of 3'));
  check('md: OP tag + edited', has('[1.1] u/trader1 (OP) · 50 pts · 2025-11-18 21:10 UTC · edited'), rendered.match(/\[1\.1\].*/)?.[0]);
  check('md: indentation', has('\n  [1.1] u/trader1') && has('\n    [1.1.1] u/deep · 3 pts') && has('\n  line two'));
  check('md: comment picture swapped', has('  Here you go: [picture: images/comment_01.png]'));
  check('md: markdown link picture', has('see this chart [picture: images/comment_02.jpg] and https://i.imgur.com/XyZ.gifv'), rendered.match(/see .*/)?.[0]);
  check('md: mod comment tags + hidden score', has('[2] u/automod (MOD, pinned) · score hidden'));
  check('md: emote + gif placeholders', has('Reminder: no shilling [reaction gif] [emote]'));
  check('md: linked comment marked', has('[3] u/a3 (THE COMMENT THE LINK POINTED TO)'));
  check('md: negative score', has('[4] u/a4 · -3 pts'));
  check('md: not-saved section', has('## Not saved') && has('about 1 comment behind "load more" links') && has('[1.2] u/[deleted] · 1 pt ·'));
  check('md: picture index', has('## Picture files') && has('- images/comment_02.jpg — in comment [3.1] by u/a3b — original: https://i.imgur.com/XyZ.jpg'));
  check('md: no junk values', !/undefined|NaN|\[object /.test(rendered), rendered.match(/.*(undefined|NaN|\[object ).*/)?.[0]);
  check('md: no triple blank lines', !/\n\n\n/.test(rendered));

  // ---- screen-read fallback
  const td = R.threadFromDom(clone(F.domRead));
  R.numberTree(td);
  check('dom: tree', td.roots.length === 2 && td.index.get('d1').children[0]?.id === 'd1a' && td.index.get('d1a').num === '1.1');
  check('dom: OP detected', td.index.get('d1a').isOp === true);
  const dpm = R.collectPostMedia(td.post);
  const dcm = R.collectCommentMedia(td);
  check('dom: pictures', dpm.length === 1 && dpm[0].url === 'https://i.redd.it/sss999.jpg' && dcm.length === 1 && dcm[0].url === 'https://i.redd.it/qqq111.png', JSON.stringify([dpm, dcm].map((l) => l.map((m) => m.url))));
  const dmd = R.renderThread(td, { version: '0.1.0', capturedAt: 'now', sourceUrl: 'u', mode: 'dom', postMedia: dpm, commentMedia: dcm });
  check('dom: md', dmd.includes('- **Score:** 1.2k') && dmd.includes('How saved') && dmd.includes('[1.1] u/op1 (OP) · 3 pts') && dmd.includes('[2] u/y\n'), dmd);
  check('dom: md clean', !/undefined|NaN|\[object /.test(dmd));

  // ---- clean source links
  check('clean: reddit share codes dropped', U.cleanUrl('https://www.reddit.com/r/Daytrading/comments/q1w2e3/first_month/?share_id=AbC123&utm_medium=ios_app&utm_term=1') ===
    'https://www.reddit.com/r/Daytrading/comments/q1w2e3/first_month/', U.cleanUrl('https://www.reddit.com/r/Daytrading/comments/q1w2e3/first_month/?share_id=AbC123&utm_medium=ios_app'));
  check('clean: x.com share codes dropped', U.cleanUrl('https://x.com/a/status/123?s=20&t=abc') === 'https://x.com/a/status/123');
  check('clean: other sites keep real params, lose trackers', U.cleanUrl('https://news.example.com/item?id=42&utm_source=tw&fbclid=x&page=2') ===
    'https://news.example.com/item?id=42&page=2', U.cleanUrl('https://news.example.com/item?id=42&utm_source=tw&fbclid=x&page=2'));
  check('clean: plain link unchanged', U.cleanUrl('https://example.com/a#b') === 'https://example.com/a#b');
  check('clean: junk in, junk out', U.cleanUrl('not a url') === 'not a url');
  check('rendered thread has no share code', !rendered.includes('share_id'));

  // ---- exact size line
  const sized = U.fillSizeLine(rendered, ' · plus 4 picture files in images/');
  const real = U.textStats(sized.md);
  check('size: placeholder replaced', !sized.md.includes(U.SIZE_MARK) && sized.md.split('\n')[2].startsWith('**Size of this file:** '), sized.md.split('\n')[2]);
  check('size: numbers describe the finished file exactly', JSON.stringify(sized.stats) === JSON.stringify(real) &&
    sized.md.includes(`${U.fmtInt(real.lines)} lines · ${U.fmtInt(real.words)} words · ${U.fmtInt(real.chars)} characters · plus 4 picture files`),
    JSON.stringify([sized.stats, real, sized.md.split('\n')[2]]));
  check('size: line count matches what an editor shows', real.lines === sized.md.split('\n').length - 1);
  const emoji = U.fillSizeLine(`# x\n\n${U.SIZE_MARK}\n\n🤦🏻‍♂️ hi\n`);
  check('size: emoji counted as characters, not code units', emoji.stats.chars === [...emoji.md].length && JSON.stringify(emoji.stats) === JSON.stringify(U.textStats(emoji.md)));
  // a file right at a digit boundary (e.g. 9,99x characters) still settles on exact numbers
  let edge = true;
  for (let n = 9940; n < 10010; n++) {
    const f = U.fillSizeLine(`# t\n\n${U.SIZE_MARK}\n\n${'a'.repeat(n)}\n`);
    if (JSON.stringify(f.stats) !== JSON.stringify(U.textStats(f.md))) { edge = false; break; }
  }
  check('size: exact across a digit boundary', edge);

  // ---- profiles
  const p1 = P.parseProfileUrl('https://www.reddit.com/user/example_trader/?share_id=x');
  check('profile url: overview by default', p1 && p1.name === 'example_trader' && p1.list === 'overview' && p1.sort === 'new' && p1.t === '', JSON.stringify(p1));
  check('profile url: /u/ + posts tab', P.parseProfileUrl('https://old.reddit.com/u/Bob_9/posts/')?.list === 'submitted');
  check('profile url: comments tab + top/year', (() => { const x = P.parseProfileUrl('https://www.reddit.com/user/bob/comments/?sort=top&t=year'); return x.list === 'comments' && x.sort === 'top' && x.t === 'year'; })());
  check('profile url: unknown tab -> overview, bad sort -> new', (() => { const x = P.parseProfileUrl('https://www.reddit.com/user/bob/weird?sort=evil'); return x.list === 'overview' && x.sort === 'new'; })());
  check('profile url: a post on a profile is a thread, not a profile', P.parseProfileUrl('https://www.reddit.com/user/bob/comments/abc/slug/') === null &&
    R.parseRedditUrl('https://www.reddit.com/user/bob/comments/abc/slug/')?.postId === 'abc');
  check('profile url: subreddit is not a profile', P.parseProfileUrl('https://www.reddit.com/r/Daytrading/') === null && P.parseProfileUrl('https://example.com/user/bob') === null);
  check('profile url: list address', P.listingUrl(p1, 't1_x') === 'https://www.reddit.com/user/example_trader/overview.json?limit=100&raw_json=1&sort=new&after=t1_x', P.listingUrl(p1, 't1_x'));

  const pr = P.newProfile(p1);
  P.ingestAbout(pr, clone(F.aboutReply));
  check('profile: page 1', P.ingestPage(pr, clone(F.profilePage1)) === 3 && pr.after === 't1_pc2');
  check('profile: page 2 skips the repeat', P.ingestPage(pr, clone(F.profilePage2)) === 1 && pr.after === null && pr.items.length === 4);
  threw = false;
  try { P.ingestPage(pr, { error: 403 }); } catch { threw = true; }
  check('profile: junk page raises an error', threw);
  const pmedia = P.collectProfileMedia(pr);
  check('profile pics: comment picture once + 2 gallery pictures', pmedia.length === 3 && pmedia[0].url === 'https://i.redd.it/zzz999.png' &&
    pmedia[1].url === 'https://i.redd.it/gg1.jpg' && pmedia[2].url === 'https://i.redd.it/gg2.jpg', JSON.stringify(pmedia.map((m) => m.url)));
  check('profile pics: labels', pmedia[0].label === 'in comment [1]' && pmedia[1].label.startsWith('in post [2] (gallery picture 1 of 2'), JSON.stringify(pmedia.map((m) => m.label)));
  pmedia[0].result = { ok: true, file: 'images/pic_01.png', from: pmedia[0].url };
  pmedia[1].result = { ok: true, file: 'images/pic_02.jpg', from: pmedia[1].url };
  pmedia[2].result = { ok: false, error: 'HTTP 404' };
  const pmd = P.renderProfile(pr, { version: '0.2.0', capturedAt: 'now', sourceUrl: U.cleanUrl('https://www.reddit.com/user/example_trader/?share_id=x'), stopped: false, maxPages: 10, media: pmedia });
  const phas = (s) => pmd.includes(s);
  check('profile md: title + size mark', pmd.startsWith(`# u/example_trader: Reddit profile\n\n${U.SIZE_MARK}\n`));
  check('profile md: account facts', phas('- **Account created:** 2015-12-13 09:46 UTC (') && phas('- **Karma:** 4,600 total (1,200 from posts, 3,400 from comments)') &&
    phas('- **Profile description:** Futures trader. NQ only.') && phas('- **Also:** verified'), pmd.slice(0, 900));
  check('profile md: saved count + date range', phas('- **Saved:** 4 items (2 posts, 2 comments), from 2025-11-19 08:13 UTC back to 2025-07-08'), pmd.match(/Saved:.*/)?.[0]);
  check('profile md: most active', phas('- **Most active in:** r/Daytrading (3), r/FuturesTrading (1)'), pmd.match(/Most active in:.*/)?.[0]);
  check('profile md: clean source', phas('- **Source:** https://www.reddit.com/user/example_trader/') && !phas('share_id'));
  check('profile md: comment entry', phas('### [1] COMMENT in r/Daytrading · 1 pt · ') && phas('On "My first month of trading" by u/example_trader (their own post) · https://www.reddit.com/r/Daytrading/comments/q1w2e3/first_month/pc1/') &&
    phas('Your proof is above [picture: images/pic_01.png]'), pmd);
  check('profile md: post entry', phas('### [2] POST in r/Daytrading · 333 pts · 477 comments · ') && phas('**My first month of trading**') &&
    phas('- Thread: https://www.reddit.com/r/Daytrading/comments/pp1/first_month/') && phas('- Flair: AMA') && phas('- Pictures: images/pic_02.jpg, NOT SAVED (HTTP 404)') && !phas('Links to: https://www.reddit.com/gallery'));
  check('profile md: negative score + edited', phas('### [3] COMMENT in r/FuturesTrading · -4 pts · 2025-11-16 13:33 UTC · edited'), pmd.match(/### \[3\].*/)?.[0]);
  check('profile md: oldest post kept, repeat not doubled', phas('### [4] POST in r/Daytrading · 12 pts · 1 comment') && !phas('dup'));
  check('profile md: picture index', phas('## Picture files') && phas('- images/pic_01.png — in comment [1] — original: https://i.redd.it/zzz999.png'));
  check('profile md: clean', !/undefined|NaN|\[object /.test(pmd) && !/\n\n\n/.test(pmd), pmd.match(/.*(undefined|NaN|\[object ).*/)?.[0]);
  const stoppedMd = P.renderProfile(P.newProfile(p1), { version: 'v', capturedAt: 'now', sourceUrl: 's', stopped: true, maxPages: 10, media: [] });
  check('profile md: empty + stopped note', stoppedMd.includes('_(nothing listed)_') && stoppedMd.includes('stopped after 10 pages') && stoppedMd.includes('- **Saved:** 0 items (0 posts, 0 comments)'), stoppedMd);

  // ---- profile note: say plainly when the list is complete
  check('profile note: list ended under the cap = everything', pmd.includes('- **Note:** This is everything Reddit lists for this account.'), pmd.match(/Note:.*/)?.[0]);
  const errMd = P.renderProfile(P.newProfile(p1), { version: 'v', capturedAt: 'now', sourceUrl: 's', stopped: true, stoppedNote: 'Reddit stopped answering after 3 pages, so older items are not included.', maxPages: 10, media: [] });
  check('profile note: Reddit stopped answering', errMd.includes('- **Note:** Reddit stopped answering after 3 pages'), errMd.match(/Note:.*/)?.[0]);
  const big = P.newProfile(p1);
  for (let i = 0; i < 1000; i++) big.items.push({ kind: 't1', d: { subreddit: 'x', body: 'b', created_utc: 1700000000 - i } });
  const bigMd = P.renderProfile(big, { version: 'v', capturedAt: 'now', sourceUrl: 's', stopped: false, maxPages: 10, media: [] });
  check('profile note: ended at ~1,000 = Reddit cap', bigMd.includes("- **Note:** Reddit stops listing at about 1,000 items, so anything older isn't included."), bigMd.match(/Note:.*/)?.[0]);
  big.after = 't1_more';
  const openMd = P.renderProfile(big, { version: 'v', capturedAt: 'now', sourceUrl: 's', stopped: false, maxPages: 10, media: [] });
  check('profile note: list not finished = may be missing', openMd.includes('older history may be missing'), openMd.match(/Note:.*/)?.[0]);

  // ---- pictures: no repeats, limit counts new files only
  const fetched = [];
  const written = [];
  const discarded = [];
  const bytesOf = { A: 'h1', B: 'h2', C: 'h2', D: 'h3', E: 'h4', F: 'h5' }; // C is B under a new address
  const picList = ['A', 'B', 'A', 'C', 'BAD', 'D', 'E', 'F'].map((u) => ({ url: `https://i.redd.it/${u}.jpg`, label: u }));
  const book = PIC.newPictureBook();
  const made = await PIC.savePictures(picList, {
    folder: 'RedAnt/x', prefix: 'pic', max: 3, book,
    fetchPic: async (m) => {
      const k = m.url.match(/\/(\w+)\.jpg/)[1];
      fetched.push(k);
      return k === 'BAD' ? { ok: false, error: 'HTTP 404' } : { ok: true, from: m.url, ext: 'jpg', hash: bytesOf[k] };
    },
    writePic: async (f, rel) => { written.push(rel); return { ok: true, file: `images/${rel.split('/').pop()}.${f.ext}` }; },
    discard: (f) => discarded.push(f.from),
  });
  const res = picList.map((m) => `${m.label}:${m.result.ok ? m.result.file + (m.result.duplicate ? '(dup)' : '') : m.result.error}`).join(' ');
  check('pictures: repeats reuse the first file, limit counts new files only', made === 3 && res ===
    'A:images/pic_01.jpg B:images/pic_02.jpg A:images/pic_01.jpg(dup) C:images/pic_02.jpg(dup) BAD:HTTP 404 D:images/pic_03.jpg E:over the picture limit F:over the picture limit', res);
  check('pictures: same address never fetched twice, same bytes never written twice', fetched.join() === 'A,B,C,BAD,D' &&
    written.join() === 'RedAnt/x/images/pic_01,RedAnt/x/images/pic_02,RedAnt/x/images/pic_03' && discarded.join() === 'https://i.redd.it/C.jpg', JSON.stringify([fetched, written, discarded]));
  check('pictures: counts', JSON.stringify(PIC.pictureCounts(picList)) === '{"files":3,"repeats":2,"failed":1,"skipped":2}', JSON.stringify(PIC.pictureCounts(picList)));
  check('pictures: repeat described', PIC.pictureWhere(picList[3]) === 'images/pic_02.jpg (same picture as an earlier one)' &&
    PIC.pictureWhere(picList[6]) === 'NOT SAVED (over the picture limit)');
  // a second list sharing the book (comments after the post): the post's picture is a repeat there too
  const second = [{ url: 'https://i.redd.it/A.jpg', label: 'again' }, { url: 'https://i.redd.it/Z.jpg', label: 'z' }];
  await PIC.savePictures(second, { folder: 'RedAnt/x', prefix: 'comment', max: 40, book,
    fetchPic: async (m) => ({ ok: true, from: m.url, ext: 'png', hash: 'hz' }), writePic: async (f, rel) => ({ ok: true, file: `images/${rel.split('/').pop()}.png` }) });
  check('pictures: shared book across lists + own numbering per prefix', second[0].result.duplicate && second[0].result.file === 'images/pic_01.jpg' &&
    second[1].result.file === 'images/comment_01.png', JSON.stringify(second.map((m) => m.result)));
  // a picture fetched without a fingerprint (direct download) is still saved
  const direct = [{ url: 'https://x.com/a.png' }];
  await PIC.savePictures(direct, { folder: 'f', prefix: 'img', max: 5, book: PIC.newPictureBook(),
    fetchPic: async (m) => ({ ok: true, from: m.url, direct: true, ext: 'png' }), writePic: async () => ({ ok: true, file: 'images/img_01.png' }) });
  check('pictures: no fingerprint still saved', direct[0].result.ok && direct[0].result.file === 'images/img_01.png');

  // ---- page markdown
  const page = { title: 'An Article', byline: 'Jane', siteName: 'Example', published: '', mode: 'reader', embeds: ['https://www.youtube.com/embed/x'],
    images: [{ url: 'https://e.com/a.png', alt: 'chart', result: { ok: true, file: 'images/img_01.png' } }, { url: 'https://e.com/b.png', alt: '', result: { ok: false, error: 'HTTP 403' } }] };
  const pageMd = renderPage(page, { body: 'Hello ![chart](images/img_01.png)', version: '0.1.0', capturedAt: 'now', url: 'https://e.com/p', tabTitle: 't' });
  check('page md', pageMd.includes('# An Article') && pageMd.includes('- **Author:** Jane') && pageMd.includes('reader view') &&
    pageMd.includes('- images/img_01.png — "chart" — original: https://e.com/a.png') && pageMd.includes('- NOT SAVED (HTTP 403) — original: https://e.com/b.png') &&
    pageMd.includes('## Embedded media (not saved)') && !pageMd.includes('Published'), pageMd);
} catch (e) {
  fail++;
  lines.push(`CRASH ${e && e.stack ? e.stack : e}`);
}

lines.push(`SUMMARY pass=${pass} fail=${fail}`);
document.getElementById('results').textContent = lines.join('\n');
document.getElementById('sample').textContent = rendered;
