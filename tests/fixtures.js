// Made-up Reddit replies shaped like the real JSON (field names as Reddit sends them with raw_json=1).

export const POST_ID = 'abc123';

export const initial = [
  { kind: 'Listing', data: { children: [{ kind: 't3', data: {
    id: POST_ID, name: `t3_${POST_ID}`, title: 'My first month of trading, AMA',
    author: 'trader1', author_flair_text: 'Futures', subreddit: 'Daytrading', subreddit_name_prefixed: 'r/Daytrading',
    score: 1234, upvote_ratio: 0.87, num_comments: 12, created_utc: 1763500000, edited: false,
    selftext: 'Here is my P&L https://preview.redd.it/pnl-shot-v0-abc111.png?width=640&format=png&auto=webp&s=xyz\n\nThoughts?',
    is_self: false, is_gallery: true, url: 'https://www.reddit.com/gallery/abc123',
    link_flair_text: 'Strategy', permalink: '/r/Daytrading/comments/abc123/first_month/',
    gallery_data: { items: [{ media_id: 'gal001', id: 1, caption: 'Week P&L' }, { media_id: 'gal002', id: 2 }, { media_id: 'bad003', id: 3 }] },
    media_metadata: {
      gal001: { status: 'valid', e: 'Image', m: 'image/png', s: { u: 'https://preview.redd.it/gal001.png?width=1080&s=sig1', x: 1080, y: 800 } },
      gal002: { status: 'valid', e: 'Image', m: 'image/jpg', s: { u: 'https://preview.redd.it/gal002.jpg?width=1080&s=sig2' } },
      bad003: { status: 'failed' },
    },
  } }] } },
  { kind: 'Listing', data: { children: [
    { kind: 't1', data: {
      id: 'c1', name: 't1_c1', parent_id: `t3_${POST_ID}`, author: 'skeptic', body: "Screenshot or it didn't happen",
      score: 300, created_utc: 1763500100, depth: 0,
      replies: { kind: 'Listing', data: { children: [
        { kind: 't1', data: {
          id: 'c1a', name: 't1_c1a', parent_id: 't1_c1', author: 'trader1', is_submitter: true, depth: 1,
          body: 'Here you go: https://preview.redd.it/proof-v0-img777.png?width=640&format=png&auto=webp&s=q\nline two',
          media_metadata: { img777: { status: 'valid', e: 'Image', m: 'image/png', s: { u: 'https://preview.redd.it/img777.png?width=640&s=q2' } } },
          score: 50, created_utc: 1763500200, edited: 1763500300,
          replies: { kind: 'Listing', data: { children: [
            { kind: 'more', data: { count: 0, name: 't1__', id: '_', parent_id: 't1_c1a', depth: 2, children: [] } },
          ] } },
        } },
        { kind: 't1', data: { id: 'c1b', name: 't1_c1b', parent_id: 't1_c1', author: '[deleted]', body: '[deleted]', score: 1, created_utc: 1763500250, depth: 1, replies: '' } },
      ] } },
    } },
    { kind: 't1', data: {
      id: 'c2', name: 't1_c2', parent_id: `t3_${POST_ID}`, author: 'automod', distinguished: 'moderator', stickied: true,
      body: 'Reminder: no shilling ![gif](giphy|abcGif) ![img](emote|t5_x|123)', score: 5, score_hidden: true, depth: 0,
      media_metadata: {
        'giphy|abcGif': { status: 'valid', e: 'AnimatedImage', s: { gif: 'https://giphy.com/x.gif' } },
        'emote|t5_x|123': { status: 'valid', e: 'Image', m: 'image/png', s: { u: 'https://emote.example/e.png' } },
      },
      created_utc: 1763500050, replies: '',
    } },
    { kind: 'more', data: { count: 3, name: 't1_c3', id: 'c3', parent_id: `t3_${POST_ID}`, depth: 0, children: ['c3', 'c4', 'c5'] } },
  ] } },
];

// /api/morechildren reply for c3, c4, c5 (c5 deleted, so missing) - flat, with a nested "more"
export const moreReply = { json: { errors: [], data: { things: [
  { kind: 't1', data: { id: 'c3', name: 't1_c3', parent_id: `t3_${POST_ID}`, author: 'a3', body: 'copy trading who?', score: 10, created_utc: 1763500400, replies: '', depth: 0 } },
  { kind: 't1', data: { id: 'c3a', name: 't1_c3a', parent_id: 't1_c3', author: 'a3b', body: 'see [this chart](https://i.imgur.com/XyZ.jpg) and https://i.imgur.com/XyZ.gifv', score: 2, created_utc: 1763500500, replies: '', depth: 1 } },
  { kind: 't1', data: { id: 'c4', name: 't1_c4', parent_id: `t3_${POST_ID}`, author: 'a4', body: 'gl', score: -3, created_utc: 1763500600, replies: '', depth: 0 } },
  { kind: 'more', data: { count: 1, name: 't1_c6', id: 'c6', parent_id: 't1_c4', depth: 1, children: ['c6'] } },
] } } };

// "continue this thread" reply for c1a: the comment again, now with its deeper replies
export const continueReply = [
  initial[0],
  { kind: 'Listing', data: { children: [
    { kind: 't1', data: {
      id: 'c1a', name: 't1_c1a', parent_id: 't1_c1', author: 'trader1', body: 'dup', score: 50, depth: 0,
      replies: { kind: 'Listing', data: { children: [
        { kind: 't1', data: { id: 'c1a1', name: 't1_c1a1', parent_id: 't1_c1a', author: 'deep', body: 'deep reply', score: 3, created_utc: 1763500700, replies: '', depth: 1 } },
      ] } },
    } },
  ] } },
];

// What scrapeRedditDom() returns on the new Reddit layout
export const domRead = {
  title: 'A post read from screen', author: 'op1', subreddit: 'r/test', score: '1.2k', comments: '45',
  created: '2026-11-18T14:03:00.000Z', link: 'https://www.reddit.com/r/test/comments/zz/x/', body: 'post text',
  images: ['https://preview.redd.it/screen-v0-sss999.jpg?width=640&s=a'],
  commentsList: [
    { id: 't1_d1', parent: 't3_zz', depth: 0, author: 'x', score: '12', created: '2026-11-18T15:00:00Z', body: 'top', images: [] },
    { id: 't1_d1a', parent: 't1_d1', depth: 1, author: 'op1', score: '3', created: '', body: 'reply', images: ['https://i.redd.it/qqq111.png'] },
    { id: 't1_d2', parent: 't3_zz', depth: 0, author: 'y', score: '', created: '', body: 'second top', images: [] },
  ],
};

// ---- profile (/user/NAME/about.json and /user/NAME/overview.json pages)
export const aboutReply = { kind: 't2', data: {
  name: 'example_trader', created_utc: 1450000000, link_karma: 1200, comment_karma: 3400, total_karma: 4600,
  is_mod: false, is_employee: false, verified: true, is_gold: false,
  subreddit: { public_description: 'Futures trader.\nNQ only.' },
} };

export const profilePage1 = { kind: 'Listing', data: { after: 't1_pc2', children: [
  { kind: 't1', data: {
    id: 'pc1', name: 't1_pc1', subreddit: 'Daytrading', subreddit_name_prefixed: 'r/Daytrading', score: 1,
    created_utc: 1763540000, body: 'Your proof is above https://preview.redd.it/proof-v0-zzz999.png?width=640&s=a',
    media_metadata: { zzz999: { status: 'valid', e: 'Image', m: 'image/png', s: { u: 'https://preview.redd.it/zzz999.png?width=640&s=b' } } },
    link_title: 'My first month of trading', link_author: 'example_trader', is_submitter: true,
    permalink: '/r/Daytrading/comments/q1w2e3/first_month/pc1/',
  } },
  { kind: 't3', data: {
    id: 'pp1', name: 't3_pp1', subreddit: 'Daytrading', subreddit_name_prefixed: 'r/Daytrading', score: 333, num_comments: 477,
    created_utc: 1763436060, title: 'My first month of trading', selftext: 'No larp here.', is_self: false, is_gallery: true,
    url: 'https://www.reddit.com/gallery/pp1', link_flair_text: 'AMA', permalink: '/r/Daytrading/comments/pp1/first_month/',
    gallery_data: { items: [{ media_id: 'gg1' }, { media_id: 'gg2' }] },
    media_metadata: { gg1: { status: 'valid', e: 'Image', m: 'image/jpg' }, gg2: { status: 'valid', e: 'Image', m: 'image/jpg' } },
  } },
  { kind: 't1', data: {
    id: 'pc2', name: 't1_pc2', subreddit: 'FuturesTrading', subreddit_name_prefixed: 'r/FuturesTrading', score: -4,
    created_utc: 1763300000, body: 'Order flow is the way.', link_title: 'Best tools?', link_author: 'someone',
    permalink: '/r/FuturesTrading/comments/qq/best/pc2/', edited: 1763300500,
  } },
] } };

// second page repeats pc2 (Reddit pages can overlap) and has no "after"
export const profilePage2 = { kind: 'Listing', data: { after: null, children: [
  { kind: 't1', data: { id: 'pc2', name: 't1_pc2', subreddit: 'FuturesTrading', body: 'dup', created_utc: 1763300000 } },
  { kind: 't3', data: {
    id: 'pp2', name: 't3_pp2', subreddit: 'Daytrading', subreddit_name_prefixed: 'r/Daytrading', score: 12, num_comments: 1,
    created_utc: 1752000000, title: 'My first post: how I trade', selftext: 'Mindset is 90%.', is_self: true,
    url: 'https://www.reddit.com/r/Daytrading/comments/pp2/first/', permalink: '/r/Daytrading/comments/pp2/first/',
  } },
] } };
