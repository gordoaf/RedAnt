// Markdown for an ordinary web page (anything that isn't a Reddit thread).
import { oneLine, SIZE_MARK } from './util.js';

// page: what extractPage() returned, with .result set on each picture after saving.
// o: { body (markdown with picture placeholders already swapped), version, capturedAt, url, tabTitle }
export function renderPage(page, o) {
  const L = [];
  L.push(`# ${oneLine(page.title || o.tabTitle || o.url)}`, '', SIZE_MARK, '');
  L.push(`Saved by RedAnt ${o.version} on ${o.capturedAt}. Picture files are in the images folder next to this file.`, '');
  const facts = [
    ['Site', page.siteName],
    ['Author', page.byline],
    ['Published', page.published],
    ['Source', o.url],
    ['How saved', page.mode === 'reader'
      ? 'reader view: the main text only (menus, ads and sidebars removed)'
      : 'full page text: no main article was found, so this is all the text that was on screen'],
  ];
  for (const [k, v] of facts) if (v && String(v).trim()) L.push(`- **${k}:** ${oneLine(v)}`);
  L.push('', '---', '', String(o.body || '').trim() || '_(no text found)_');
  if (page.embeds?.length) {
    L.push('', '## Embedded media (not saved)', '');
    for (const u of page.embeds) L.push(`- ${u}`);
  }
  const pics = (page.images || []).filter((m) => m.result);
  if (pics.length) {
    L.push('', '## Picture files', '');
    for (const m of pics) {
      const where = m.result.ok ? m.result.file : `NOT SAVED (${m.result.error})`;
      L.push(`- ${where} — ${m.alt ? `"${oneLine(m.alt)}" — ` : ''}original: ${m.url}`);
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
