<p align="center"><img src="docs/logo.png" width="128" alt="RedAnt logo"></p>

# RedAnt

RedAnt is a Chrome extension that saves a web page as a clean text file, with its pictures, so you
can hand it to an AI chat or keep it.

One click saves the page into a folder in your Downloads and copies the file's path. Paste that path
into an AI that can read files on your computer, or drag the file and its pictures into a chat. No
more copying text and screenshotting pictures one by one.

It is built for Reddit, which many AI tools can't open:

- **a Reddit thread:** the post, every comment it can load (with authors, scores and times, threaded
  so replies stay under the comment they answer), and the pictures in the post and the comments;
- **a Reddit profile:** the account's age and karma, then its posts and comments, newest first, with
  pictures;
- **any other page:** the main text, the way Chrome's reader view shows it (menus and ads removed),
  and its pictures;
- **a PDF:** the file itself.

> [!WARNING]
> **Use it at your own risk.** Reddit's [User Agreement](https://www.redditinc.com/policies/user-agreement)
> limits automated access to the site. RedAnt only reads what you are already looking at, from your
> own browser, and it paces its requests like a person browsing. But nobody can promise Reddit will
> never object. Treat other people's posts with care.
>
> RedAnt is an independent project. It is not affiliated with or endorsed by Reddit.

## Install (about a minute)

Chrome only installs extensions from its Web Store with one click. RedAnt isn't there, so it's
installed by hand:

1. Download **RedAnt-v…zip** from the [latest release](https://github.com/gordoaf/RedAnt/releases/latest)
   and unzip it somewhere it can stay, for example `Documents\RedAnt`. Chrome runs it from that
   folder, so don't delete it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped **RedAnt** folder (the one with `manifest.json` in it).
5. Optional: click the puzzle-piece icon on the toolbar and pin RedAnt.

**To update:** unzip the new version over the old folder, then click the reload arrow on RedAnt's
card in `chrome://extensions`.

It needs Chrome 116 or newer. Other Chromium browsers (Edge, Brave) should work the same way but
haven't been tested.

## Use

Click the RedAnt icon, or press **Alt+Shift+S**. You can change the key at
`chrome://extensions/shortcuts`. The snapshot starts by itself and the popup shows progress. Closing
the popup doesn't stop it. When it finishes, the path is on your clipboard, for example:

    C:\Users\you\Downloads\RedAnt\2026-11-19_103012_reddit_AskHistorians_Why-did-Rome-fall\snapshot.md

For a profile, open `reddit.com/user/NAME` and click RedAnt the same way. It follows the tab you're
on: **Posts**, **Comments**, or **Overview** for both.

Each snapshot folder holds:

| File | What it is |
| --- | --- |
| `snapshot.md` | The file to hand over. Plain text. The top gives its exact size (lines, words, characters), so whoever reads it knows what's coming. Thread comments are numbered by position: [2.1] is the first reply to comment [2]. |
| `images/` | The pictures. Each one is named in `snapshot.md` where it appeared. A picture posted more than once (the same address, or the same image under a new address) is saved once, and every mention points to that file. |
| `raw.json` | Reddit only: everything Reddit sent, untouched, in case you ever need it. |

## Privacy

Everything stays on your computer. RedAnt has no server and no analytics, and it never sends what it
saves anywhere. It reads the page from your own browser, so it sees what you see when you're logged
in. Share codes and ad trackers (`share_id`, `utm_…`, `fbclid` and the like) are removed from links
before they're written into a snapshot.

**Why it asks for access to all websites:** so one click works on any page you choose, and so it can
fetch a page's pictures from wherever they're hosted. It only acts when you click it or press the
shortcut.

## How it reads Reddit

It asks Reddit for the thread's data from inside your own tab, the same way the page itself does.
Then it clicks "load more comments" for you: up to 40 extra requests, 1.2 seconds apart. If Reddit
refuses the data request, it falls back to saving the comments showing on screen, and the file says
so. Profiles are read 100 items at a time, up to Reddit's own limit of about 1,000.

## Limits

- **Very big threads:** anything past 40 "load more" requests is skipped, and `snapshot.md` says how
  much was left out.
- **Pictures:** up to 40 new pictures for a post, 40 for its comments, 40 for a profile and 60 for
  any other page. The rest are listed with their addresses.
- **Videos** aren't saved. You get a still frame and the link.
- **Other sites:** only what has loaded. On endless-scroll pages, scroll down first.
- **Profiles:** posts and comments that were deleted or removed don't appear, because Reddit doesn't
  list them.
- Chrome doesn't let extensions run on its own pages (`chrome://`, the Web Store).

## For developers

Plain JavaScript (Manifest V3), with no build step. The files in this repository are the extension.

- `background.js` runs each snapshot. `lib/reddit.js`, `lib/profile.js` and `lib/page.js` turn what
  was read into `snapshot.md`. `lib/inject.js` runs inside the page. `lib/pictures.js` saves pictures
  without repeats.
- Tests: `python tests/run_tests.py` runs them all in headless Chrome, with a throwaway profile and
  the network blocked.
- Icons: `python tools/make_icons.py` redraws them (needs Pillow).

Third-party code in `vendor/` is unchanged from npm (see `vendor/VERSIONS.txt`): Mozilla Readability
(Apache-2.0), Turndown and turndown-plugin-gfm (MIT).

## License

[MIT](LICENSE)
