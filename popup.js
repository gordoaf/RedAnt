// The popup only shows the job; the background worker does the work, so closing the popup is fine.
// Opening it starts a snapshot of the current tab, unless one is running or this page was just saved.
const $ = (id) => document.getElementById(id);
$('ver').textContent = `v${chrome.runtime.getManifest().version}`;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let current = (await chrome.storage.session.get('lastJob')).lastJob || null;

function render(job) {
  current = job;
  if (!job) return;
  document.body.dataset.status = job.status;
  $('title').textContent = job.title || job.url || '';
  $('step').textContent = job.step || '';
  $('log').textContent = (job.log || []).join('\n');
  const done = job.status === 'done';
  const failed = job.status === 'error';
  $('result').hidden = !done;
  $('error').hidden = !failed;
  $('again').hidden = job.status === 'running';
  if (done) {
    $('path').textContent = job.path || '';
    const s = job.stats;
    const size = s ? ` · ${s.lines.toLocaleString('en-US')} lines, ${s.words.toLocaleString('en-US')} words` : '';
    $('summary').textContent = `${job.summary || ''}${size}${job.copied ? ' · path copied' : ''}`;
  }
  if (failed) $('error').textContent = job.error || 'Something went wrong.';
}

async function start() {
  if (!tab) return;
  $('step').textContent = 'Starting…';
  const r = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id }).catch(() => null);
  if (r && !r.ok && r.error === 'busy') $('step').textContent = 'Another snapshot is still running.';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.lastJob) render(changes.lastJob.newValue);
});

$('copy').addEventListener('click', async () => {
  if (!current?.path) return;
  try {
    await navigator.clipboard.writeText(current.path);
    $('copy').textContent = 'Copied ✓';
  } catch {
    $('copy').textContent = 'Copy failed: select the path above';
  }
});
$('show').addEventListener('click', () => {
  if (current?.downloadId != null) chrome.downloads.show(current.downloadId);
});
$('again').addEventListener('click', () => start());

const justSavedHere = current && current.status !== 'running' && tab && current.url === tab.url &&
  Date.now() - (current.finishedAt || 0) < 60_000;
if (current?.status === 'running' || justSavedHere) render(current);
else start();
