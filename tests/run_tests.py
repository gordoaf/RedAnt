"""Run RedAnt's tests in headless Chrome (no Node needed).

    python tests/run_tests.py

Uses a throwaway Chrome profile in the system temp folder, never your own profile.
"""
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]
PAGES = ["unit.html", "page.html", "page.html#short", "shreddit.html", "smoke.html"]


def chrome_path() -> str:
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    sys.exit("Chrome not found")


def run_page(chrome: str, profile: str, page: str) -> str:
    name, _, frag = page.partition("#")
    url = (ROOT / "tests" / name).as_uri() + (f"#{frag}" if frag else "")
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
           "--disable-extensions", f"--user-data-dir={profile}", "--allow-file-access-from-files",
           "--host-resolver-rules=MAP * ~NOTFOUND",  # no network: results never depend on outside sites
           "--virtual-time-budget=8000", "--dump-dom", url]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    m = re.search(r'<pre id="results">(.*?)</pre>', out.stdout, re.S)
    return html.unescape(m.group(1)) if m else f"NO RESULTS (stderr: {out.stderr[-500:]})"


def check_manifest() -> list:
    problems = []
    man = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    refs = [man["background"]["service_worker"], man["action"]["default_popup"], "offscreen.html", "offscreen.js",
            "vendor/Readability.js", "vendor/turndown.js", "vendor/turndown-plugin-gfm.js"]
    refs += list(man["icons"].values()) + list(man["action"]["default_icon"].values())
    for r in refs:
        if not (ROOT / r).exists():
            problems.append(f"missing file {r}")
    return problems


def main() -> int:
    chrome = chrome_path()
    total_fail = 0
    problems = check_manifest()
    print("manifest:", "OK" if not problems else problems)
    total_fail += len(problems)
    with tempfile.TemporaryDirectory(prefix="redant_test_") as profile:
        for page in PAGES:
            res = run_page(chrome, profile, page)
            fails = [ln for ln in res.splitlines() if ln.startswith(("FAIL", "CRASH", "NO RESULTS"))]
            summary = next((ln for ln in res.splitlines() if ln.startswith("SUMMARY")), "SUMMARY missing")
            print(f"{page:18} {summary}")
            for ln in fails:
                print("    " + ln)
            if fails or "SUMMARY" not in res or "NOT RUN" in res:
                total_fail += max(1, len(fails))
    print("ALL PASSED" if total_fail == 0 else f"FAILURES: {total_fail}")
    return 1 if total_fail else 0


if __name__ == "__main__":
    sys.exit(main())
