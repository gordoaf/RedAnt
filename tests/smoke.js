// Loads every extension script against the fake chrome.* from smoke.html.
// Static imports on purpose: headless Chrome's fast-forward clock doesn't wait for on-demand imports.
import '../background.js';
import '../offscreen.js';
import '../popup.js';

const lines = ['PASS background.js, offscreen.js and popup.js all load (with lib/*)'];
let pass = 1;
let fail = 0;
const calls = window.__calls.join(' ');
const want = [
  'chrome.runtime.onMessage.addListener',      // background + offscreen listen for messages
  'chrome.commands.onCommand.addListener',     // keyboard shortcut
  'chrome.storage.onChanged.addListener',      // popup follows the job
  'chrome.runtime.sendMessage',                // popup started a snapshot
];
for (const w of want) {
  if (calls.includes(w)) { pass++; lines.push(`PASS startup calls ${w}`); } else { fail++; lines.push(`FAIL startup never called ${w}`); }
}
lines.push(`SUMMARY pass=${pass} fail=${fail}`);
document.getElementById('results').textContent = lines.join('\n');
