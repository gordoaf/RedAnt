// Functions that run INSIDE the web page's tab (via chrome.scripting.executeScript).
// Chrome copies each function's source text into the tab, so each one must be fully self-contained:
// no imports and no helpers from outside the function body.

// Any web page -> { title, byline, ..., markdown, images }.
// Needs vendor/Readability.js, vendor/turndown.js and vendor/turndown-plugin-gfm.js injected first.
// Pictures become placeholders REDANT_IMG_<n> that the background swaps for saved file names.
export function extractPage() {
  const absolute = (u) => {
    try { return new URL(u, document.baseURI).href; } catch { return null; }
  };
  const bestSrc = (img) => {
    let best = null;
    let bestW = -1;
    for (const set of [img.getAttribute('srcset'), img.getAttribute('data-srcset')]) {
      if (!set) continue;
      for (const part of set.split(/,\s+/)) {
        const [u, d] = part.trim().split(/\s+/);
        if (!u) continue;
        const w = d ? parseFloat(d) * (/x$/i.test(d) ? 1000 : 1) : 1;
        if (w > bestW) { bestW = w; best = u; }
      }
    }
    const src = best || img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    const abs = src ? absolute(src) : null;
    return abs && /^https?:/i.test(abs) ? abs : null;
  };

  // Sizes from the live page, so tiny icons can be skipped. Use the real size once a picture has
  // loaded, otherwise the size the page declares; never the on-screen size, which can be tiny for a
  // broken or not-yet-loaded picture.
  const dim = (im, natural, attr) => im[natural] || parseInt(im.getAttribute(attr), 10) || 0;
  const sizes = new Map();
  for (const im of Array.from(document.images)) {
    const s = bestSrc(im);
    if (!s) continue;
    const w = dim(im, 'naturalWidth', 'width');
    const h = dim(im, 'naturalHeight', 'height');
    const prev = sizes.get(s);
    if (!prev || w * h > prev.w * prev.h) sizes.set(s, { w, h });
  }
  const tooSmall = (src) => {
    const z = sizes.get(src);
    return !!(z && z.w > 0 && z.h > 0 && (z.w < 64 || z.h < 64));
  };

  const images = [];
  const seen = new Map();
  const addImage = (src, alt) => {
    let i = seen.get(src);
    if (i === undefined) {
      i = images.length;
      images.push({ url: src, alt: alt || '' });
      seen.set(src, i);
    }
    return i;
  };
  const cleanAlt = (s) => String(s || '').replace(/[[\]\r\n]+/g, ' ').trim();

  let article = null;
  try {
    if (typeof Readability === 'function') article = new Readability(document.cloneNode(true), { charThreshold: 250 }).parse();
  } catch (e) {
    article = null;
  }

  let markdown = '';
  let mode = 'reader';
  const textLen = article && article.textContent ? article.textContent.trim().length : 0;
  if (article && textLen >= 250 && typeof TurndownService === 'function') {
    try {
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
      if (typeof turndownPluginGfm !== 'undefined') td.use(turndownPluginGfm.gfm);
      // No backslash-escaping: it's for markdown viewers and turns "-0.6%" into "\-0.6%" for an AI reader.
      td.escape = (s) => s;
      td.remove(['script', 'style', 'noscript', 'iframe', 'button', 'form', 'select', 'input', 'textarea', 'svg']);
      td.addRule('redantImg', {
        filter: 'img',
        replacement: (_content, node) => {
          const src = bestSrc(node);
          if (!src || tooSmall(src)) return '';
          const alt = cleanAlt(node.getAttribute('alt'));
          return `![${alt}](REDANT_IMG_${addImage(src, alt)})`;
        },
      });
      markdown = td.turndown(article.content || '');
    } catch (e) {
      markdown = article.textContent.trim();
    }
  } else {
    mode = 'fulltext';
    markdown = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim();
    const pics = [];
    for (const im of Array.from(document.images)) {
      if (images.length >= 40) break;
      const src = bestSrc(im);
      if (!src) continue;
      const w = dim(im, 'naturalWidth', 'width');
      const h = dim(im, 'naturalHeight', 'height');
      if (w < 120 || h < 80) continue;
      const alt = cleanAlt(im.getAttribute('alt'));
      pics.push(`![${alt}](REDANT_IMG_${addImage(src, alt)})`);
    }
    if (pics.length) markdown += '\n\n## Pictures on the page\n\n' + pics.join('\n\n');
  }

  const meta = (...names) => {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      const v = el && el.getAttribute('content');
      if (v && v.trim()) return v.trim();
    }
    return '';
  };
  const embeds = [...new Set(Array.from(document.querySelectorAll('iframe[src], video[src], video source[src]'))
    .map((e) => absolute(e.getAttribute('src')))
    .filter((u) => u && /^https?:/i.test(u) &&
      /youtube\.com|youtu\.be|vimeo\.com|twitter\.com|x\.com|tiktok\.com|instagram\.com|spotify\.com|soundcloud\.com|\.mp4|\.webm|\.m3u8/i.test(u)))]
    .slice(0, 20);

  return {
    title: (article && article.title) || meta('og:title', 'twitter:title') || document.title || '',
    byline: (article && article.byline) || meta('author', 'article:author') || '',
    siteName: (article && article.siteName) || meta('og:site_name') || location.hostname,
    published: (article && article.publishedTime) || meta('article:published_time', 'date', 'pubdate') || '',
    lang: document.documentElement.lang || '',
    url: location.href,
    mode,
    markdown,
    images,
    embeds,
  };
}

// Backup for Reddit when its data view is blocked: read the post and the comments showing on screen
// (new Reddit page layout). Returns null if this isn't that layout.
export function scrapeRedditDom() {
  const post = document.querySelector('shreddit-post');
  if (!post) return null;
  const attr = (el, name) => (el && el.getAttribute(name)) || '';
  const pick = (img) => {
    let best = null;
    let bestW = -1;
    for (const part of (img.getAttribute('srcset') || '').split(/,\s+/)) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = parseFloat(d) || 1;
      if (w > bestW) { bestW = w; best = u; }
    }
    const src = best || img.currentSrc || img.getAttribute('src') || '';
    try { return new URL(src, location.href).href; } catch { return ''; }
  };
  const pictures = (root) => {
    if (!root) return [];
    const urls = Array.from(root.querySelectorAll('img')).map(pick)
      .filter((u) => /^https:\/\/(?:(?:i|preview|external-preview)\.redd\.it|i\.imgur\.com)\//i.test(u))
      .filter((u) => !/snoovatar|avatar|award|emoji|communityIcon/i.test(u));
    return [...new Set(urls)];
  };
  const textOf = (el) => (el ? el.innerText : '').replace(/\n{3,}/g, '\n\n').trim();

  const out = {
    title: attr(post, 'post-title') || document.title,
    author: attr(post, 'author'),
    subreddit: attr(post, 'subreddit-prefixed-name'),
    score: attr(post, 'score'),
    comments: attr(post, 'comment-count'),
    created: attr(post, 'created-timestamp'),
    link: attr(post, 'content-href'),
    body: textOf(post.querySelector('[slot="text-body"]')),
    images: pictures(post.querySelector('[slot="post-media-container"]') || post),
    commentsList: [],
  };
  for (const c of Array.from(document.querySelectorAll('shreddit-comment'))) {
    const body = c.querySelector(':scope > [slot="comment"]') || c.querySelector('[slot="comment"]');
    out.commentsList.push({
      id: attr(c, 'thingid'),
      parent: attr(c, 'parentid'),
      depth: parseInt(attr(c, 'depth'), 10) || 0,
      author: attr(c, 'author') || '[deleted]',
      score: attr(c, 'score'),
      created: attr(c.querySelector('faceplate-timeago'), 'ts'),
      body: textOf(body),
      images: pictures(body),
    });
  }
  return out;
}
