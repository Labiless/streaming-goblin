<p align="center">
  <img src="goblin.png" alt="Streaming Goblin" width="152">
</p>

<h1 align="center">Streaming Goblin</h1>

<p align="center">
  A tiny Chrome extension that stops streaming sites from hijacking your clicks to open ads,<br>
  and adds the comforts of a real streaming platform: auto next episode, default language, skip intro and resume.
</p>

---

## The problem

On Streaming Community, the first few clicks on anything (the video, the player, the fullscreen button…) don't do what you asked: they open an ad in a new tab and switch you to it. Only after 3–4 attempts does the click actually work. **THIS IS EXTREMELY ANNOYING.**

Streaming Goblin blocks those attempts, so every click works on the first try.

## Installation

The extension isn't on the Chrome Web Store, so you load it manually:

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
4. Optional: pin the goblin to the toolbar via the puzzle-piece icon.

It should work in any Chromium-based browser; see [Tested browsers](#tested-browsers) for the ones it's been tried on.

## Tested browsers

| Browser | Status |
| --- | --- |
| Google Chrome | ✅ Tested |
| Opera | ✅ Tested |

## Usage

Click the goblin in the toolbar. Under the title, type the site's domain (e.g. `streamingcommunityz.pictures`; a full URL works too). It's saved as you type. When the site changes domain, just update it.

Each feature has its own toggle, independent of the others; when a feature has settings, they open below it. Changes apply right away, even to the episode that's playing.

| Feature | What it does |
| --- | --- |
| **Block popup** | Blocks ad tabs. A **Popup blocked** toast confirms each block. |
| **Auto next episode** | A few seconds before the end (slider, default 30 s) shows **Next episode in 5** with **Play now** / **Cancel**, then plays the next episode. |
| **Auto language** | Sets your audio and subtitles on every episode (the player otherwise resets to Italian audio and forced Italian subtitles). |
| **Skip intro** | Jumps from the intro start to its end (`minutes:seconds`). The times apply to every episode: update them when you switch series. |
| **Resume episode** | Remembers where you left off: episodes resume from that point, and the homepage shows a **Continue watching** box. |

### Good to know

- **Next episode without reloading.** The next episode is loaded in the same player, like on Netflix, so it starts **with sound** and **stays in fullscreen**. If that fails (e.g. the site changed something), the goblin shows **Reloading page** with the reason and loads the next episode the normal way. Chrome may then ask for one click (**Click to unmute** / **Click for fullscreen**).
- **Auto language** holds your choice for the first 10 seconds of each episode, then leaves it alone, so switching tracks by hand while watching still works. If an episode lacks the chosen language, the player keeps its default.
- **Skip intro** only skips when the video plays into the intro, not when you drag the progress bar back into it.
- **Continue watching** keeps the last 10 series, only in this browser. Finished an episode? The box offers the next one. **Remove** forgets a series; turning **Resume episode** off stops recording but keeps the history.
- **Links that legitimately open in a new tab** (e.g. Telegram) are blocked too: use **Ctrl/Cmd + click**.
- After turning **Block popup** off, pages already open stay protected until you reload them.

## Autoplay with sound (optional)

You normally don't need this: the first episode starts with your click, and the next ones play in the same player, so Chrome allows sound. It's only a safety net for when the page does reload (fallback above): without it, the video starts muted with **Click to unmute**.

The `AutoplayAllowlist` policy tells Chrome to always allow sound on the site and its player (hosted on `vixcloud.co`). Replace `streamingcommunityz.pictures` with your current domain, and run the command again when it changes.

**macOS** (keep the single quotes, or `defaults` fails with *Could not parse*):

```bash
defaults write com.google.Chrome AutoplayAllowlist -array '"[*.]vixcloud.co"' '"[*.]streamingcommunityz.pictures"'
# to remove it:
defaults delete com.google.Chrome AutoplayAllowlist
```

**Windows** (Command Prompt as administrator):

```bat
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" /v 1 /t REG_SZ /d "[*.]vixcloud.co" /f
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" /v 2 /t REG_SZ /d "[*.]streamingcommunityz.pictures" /f
:: to remove it:
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" /f
```

Then quit Chrome completely (**Cmd + Q** on macOS), reopen it and check `chrome://policy`: `AutoplayAllowlist` should have status **OK** (level *Recommended* on macOS is fine).

If Chrome ignores the policy, start it with `--autoplay-policy=no-user-gesture-required` instead (allows sound on **every** site): on macOS `open -a "Google Chrome" --args --autoplay-policy=no-user-gesture-required` with Chrome fully closed; on Windows add the flag at the end of the Chrome shortcut's **Target** field.

There's no equivalent for fullscreen: Chrome's `AutomaticFullscreenAllowedForUrls` policy was accepted but still ignored in our tests, so after a reload fullscreen needs one click.

> Other Chromium browsers: use `com.microsoft.Edge` / `com.brave.Browser` on macOS, `Microsoft\Edge` / `BraveSoftware\Brave` in the Windows registry path.

## How it works

- [`blocker.js`](blocker.js) (when **Block popup** is on) runs in the page before the site's scripts, in every frame including the player iframe. It replaces `window.open` with a fake, blocks programmatic and invisible-overlay clicks on links and forms that target a new tab, covers the `<base target="_blank">` and "clean `window.open` from a new iframe" tricks, and locks its patches so the site can't undo them. It also gives the player iframe the `autoplay` permission the site leaves out. It works standalone too: paste it into the DevTools console.
- [`autonext.js`](autonext.js) runs inside the player (JW Player). For the next episode it intercepts the player's own next-episode button: [`background.js`](background.js) reads the site's episode data to find the next episode and its player link, and the new stream is loaded with `jwplayer().load()` instead of reloading the page.
- The popup blocker is **not a general ad blocker**: it doesn't hide banners or stop ad scripts, it only stops new tabs, and only on your domain. Don't use it on regular sites (it would break "Sign in with Google" or PayPal popups). Pair it with [uBlock Origin Lite](https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh) for everything else.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Injects the scripts; looks up the next episode; saves the watch history |
| `blocker.js` | Popup blocker, in the page context |
| `toast.js` | "Popup blocked" toast |
| `autonext.js` | Next episode, autoplay, language, skip intro, progress and resume, in the player |
| `continue.js` | "Continue watching" box on the homepage |
| `popup.html` / `popup.js` | Toolbar popup |
| `fonts/`, `icons/`, `goblin.png` | Rubik Iso font and artwork |

## Permissions

- **scripting**, **webNavigation**, **tabs**: run the goblin on your domain and inside its player iframe.
- **storage**: your settings and the watch history (local, this browser only).
- **Access to all sites**: the domain is configurable and the player lives on another one. Nothing runs outside the tabs of your domain.

No data is collected. The only requests the extension makes on its own go to the streaming site itself, to find the next episode and its artwork.
