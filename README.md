<p align="center">
  <img src="goblin.png" alt="Streaming Goblin" width="152">
</p>

<h1 align="center">Streaming Goblin</h1>

<p align="center">
  A tiny Chrome extension that stops streaming sites from hijacking your clicks to open ads in new tabs.
</p>

---

## The problem

On some streaming sites, the first few clicks on anything (the video, the player, the fullscreen button…) don't do what you asked: instead they open an ad in a new tab and switch you to it. Only after 3–4 attempts does the click actually work. **THIS IS EXTREMELY ANNOING**

Streaming Goblin blocks those attempts, so every click does what it should on the first try.

## Installation

The extension isn't on the Chrome Web Store, so you load it manually:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Optional: pin the goblin to the toolbar via the puzzle-piece icon.

It works in any Chromium-based browser that supports extensions (but i tested it only on Chrome).

## Usage

Click the goblin in the toolbar to open the popup:

- **START / STOP**: turns the blocker on or off. The button shows the action you can take, so it reads **STOP** while the blocker is active. When it's off the goblin turns grey.
- **Update Domain**: the site to protect. Type or paste the domain (`streamingcommunityz.photos`) or a full URL (`https://streamingcommunityz.photos/...`). It's saved automatically as soon as you stop typing, or right away when you press Enter. Subdomains are covered too.
- **Next Episode**: plays the next episode automatically. **ON / OFF** toggles it; the value next to it says how many **seconds** before the end to start (default: 30). Changes apply immediately, even to an episode that's already playing.

When a popup attempt is blocked, a small yellow **Popup blocked** toast appears at the bottom of the page (also in fullscreen). If several attempts are blocked in a row it shows a counter (`×2`, `×3`…).

### Next episode

When the episode reaches the threshold, a yellow box appears over the player: **Next episode in 5**. When the countdown ends, the next episode loads and starts on its own. From the box you can:

- **Play now**: skip the countdown;
- **Cancel**: stay on this episode (it won't ask again unless you seek back before the threshold).

The countdown pauses while the video is paused. Nothing happens on the last episode of a series, or on videos shorter than 2 minutes.

The next episode is loaded **inside the same player, without reloading the page**, like on Netflix. It starts right away, **with sound**, and **stays in fullscreen** if you were in fullscreen. No Chrome settings are needed for this. The same happens when you press the player's next-episode button yourself. The address bar is updated too, so reloading the page keeps you on the new episode. A yellow box briefly shows the episode that's now playing.

If that fails (for example because the site changed something), the box shows **Reloading page** with the reason, and the goblin falls back to the site's normal behaviour: it reloads the page on the next episode. The new episode then still starts on its own, but Chrome may not allow sound or fullscreen on a freshly loaded page without a click:

- **Sound**: if Chrome refuses to start the video with sound, it starts muted and a box says **Click to unmute**. You can avoid this with the optional policy below.
- **Fullscreen**: if you were watching in fullscreen, the box says **Click for fullscreen** (or **Click for sound & fullscreen**). One click or key press puts the new episode back in fullscreen, without pausing it. This click can't be avoided after a page reload. Chrome does have a policy for fullscreen without a click (`AutomaticFullscreenAllowedForUrls`), but in our tests on a personal Mac, Chrome accepted the policy and still refused fullscreen without a click.

### Language

The player normally goes back to its defaults (Italian audio, forced Italian subtitles) every time an episode starts, even if you had picked something else. In the popup's **Language** section you can choose your own defaults:

- **ON / OFF**: turns the feature on or off (off by default, which keeps the site's defaults);
- **Audio**: Italian or English;
- **Subs**: Off, Forced IT (only the parts in a foreign language, the site's default), Italian, English or English CC.

They're applied every time an episode starts, including when the next episode loads on its own. During the first 10 seconds the goblin keeps them in place, in case the player switches back to its defaults. After that it stops, so if you switch audio or subtitles in the player while watching, your choice stays until the next episode. If an episode doesn't have the language you chose, the player keeps its default. Changes in the popup apply right away, even to the episode that's playing.

### Skip Intro

In the popup's **Skip Intro** section, enter when the intro starts and ends as `minutes:seconds` (e.g. **from** `0:45` **to** `1:30`) and turn it **ON**. You can do this from any page, you don't need to be on the player.

Whenever playback reaches the start of the intro, the player jumps to its end and briefly shows **Intro skipped**. It only skips when the video *plays into* the intro: if you drag the progress bar back into it yourself, the goblin leaves it alone.

The times apply to **every episode** and stay saved until you change them, so when you switch to a series whose intro is at a different time, update them (or turn the feature off). Changes apply right away, even to the episode that's playing.

### Continue watching

The goblin remembers what you watch: series, episode and the minute you stopped at. You can turn this on or off in the popup's **Continue Watching** section (on by default); when it's off, nothing is recorded, episodes don't resume and the homepage box doesn't appear. The data never leaves the browser (it's kept only in the extension's local storage, no account or server) and covers the last 10 series.

A few seconds after you open the site's **homepage**, a yellow-and-black **Continue watching** box appears at the bottom of the page with the last thing you watched:

- the episode's image with a progress bar, the series name, season and episode, and the time left;
- **Resume**: opens the episode and starts it on its own, **from the minute you stopped at**. The same happens whenever you open that episode and press play: it picks up where you left off;
- **Remove**: forgets that series and shows the previous one, if any;
- **✕**: hides the box until the next time you open the homepage.

If you finished an episode, the box offers the **next one** from the start. After the last episode of a series, or after a movie, the entry disappears. The box only appears on the homepage, and it's added by the extension on top of the page, so it doesn't depend on the site's layout.

To wipe the history, use **Clear history** in the same section (it shows how many series are saved). Turning the feature off keeps the history, in case you turn it back on.

### Autoplay with sound (optional)

**You normally don't need this.** Chrome allows sound on a page you've already clicked or pressed a key on. You start the first episode yourself by clicking play in the player, and the following ones are loaded in that same player, so they already get sound.

The `AutoplayAllowlist` browser policy is a safety net for the cases where the page does reload:

- the seamless switch fails and the goblin falls back to reloading the page;
- the first episode started without you ever clicking or pressing a key inside the player (for example after such a reload).

Without the policy, in those cases the video starts muted with **Click to unmute**. With it, Chrome always allows autoplay with sound on the streaming site and its player. No extension can override Chrome's autoplay rules, but this policy can. Setting it up once is enough, and it only affects the sites you list.

The player is hosted on `vixcloud.co`. Replace `streamingcommunityz.photos` with the domain you're currently using.

#### macOS

1. Run in the Terminal:

   ```bash
   defaults write com.google.Chrome AutoplayAllowlist -array '"[*.]vixcloud.co"' '"[*.]streamingcommunityz.photos"'
   ```

2. Quit Chrome completely (**Cmd + Q**, not just closing the window) and reopen it.
3. Open `chrome://policy`, click **Reload policies** and check that `AutoplayAllowlist` is listed with status **OK**. The level shows as *Recommended*: that's expected on macOS, and it works.

Keep the single quotes around each value: without them `defaults` reads `[` as the start of a list and fails with *Could not parse*.

When the site changes domain, run the same command with the new domain (it replaces the old list). To remove the setting:

```bash
defaults delete com.google.Chrome AutoplayAllowlist
```

#### Windows

1. Open **Command Prompt as administrator** (Start → type `cmd` → right-click → *Run as administrator*).
2. Run:

   ```bat
   reg add "HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" /v 1 /t REG_SZ /d "[*.]vixcloud.co" /f
   reg add "HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" /v 2 /t REG_SZ /d "[*.]streamingcommunityz.photos" /f
   ```

3. Close all Chrome windows, reopen Chrome, go to `chrome://policy`, click **Reload policies** and check that `AutoplayAllowlist` is listed with status **OK**.

When the site changes domain, run the second command again with the new domain (it overwrites entry `2`). To remove the setting:

```bat
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" /f
```

#### If the policy doesn't show up

On some personal computers Chrome may ignore the policy. As an alternative, start Chrome with a flag that allows autoplay with sound on **every** site. Chrome must be fully closed first.

- **macOS**:

  ```bash
  open -a "Google Chrome" --args --autoplay-policy=no-user-gesture-required
  ```

- **Windows**: right-click the Chrome shortcut → **Properties** and add ` --autoplay-policy=no-user-gesture-required` at the end of the **Target** field, after the closing quote. Then always open Chrome from that shortcut.

> Using another Chromium browser? Replace the Chrome-specific parts: on macOS `com.microsoft.Edge` or `com.brave.Browser` instead of `com.google.Chrome`; on Windows `Microsoft\Edge` or `BraveSoftware\Brave` instead of `Google\Chrome` in the registry path.

### Good to know

- **The site changed domain?** Just type the new one in the popup. Open tabs of the new domain are protected immediately, no reload needed.
- **After pressing STOP**, pages you already have open stay protected until you reload them.
- **Links that legitimately open in a new tab** (e.g. a Telegram link) are blocked too. Use **Ctrl/Cmd + click** to open them anyway.

## How it works

The core is [`blocker.js`](blocker.js), injected into the page before any site script runs. It:

- replaces `window.open` with a fake that returns a dummy window, so ad scripts think they succeeded and don't retry;
- blocks programmatic clicks on links (and form submissions) that target a new tab, including links that aren't even in the page;
- intercepts real clicks on invisible `target="_blank"` links placed over the player;
- covers the `<base target="_blank">` trick and the "grab a clean `window.open` from a fresh iframe" trick;
- locks all of these patches so the site can't restore the originals.

The extension injects it on every page load of the chosen domain (single-page navigations keep the patches, since the page never reloads), and also into the player iframe, which usually lives on a different domain.

The next-episode feature ([`autonext.js`](autonext.js)) runs inside the player iframe. It watches the `<video>` playback time and, when the threshold is reached, presses the player's own "next episode" button. That button only exists when there is a next episode, so on the last one the goblin does nothing.

The click on that button never reaches the site, which would reload the page. Instead:

1. `background.js` reads the episode page of the site, whose embedded data includes the next episode, then fetches that episode's player link;
2. `autonext.js` reads the stream address from the new player page, the same way the player's own script does;
3. the stream is loaded into the JW Player that's already open (`jwplayer().load()`), and the title, the next-episode button and the address bar are updated.

Since the page never reloads, Chrome still counts your earlier clicks on it, so the video can play with sound and stay in fullscreen. If any step fails, the goblin asks the site to load the next episode the normal way. After that reload it presses play for you. To make that possible with sound, `blocker.js` also grants the player iframe the `autoplay` permission, which the site doesn't give it.

`blocker.js` also works standalone: paste it into the DevTools console of the site to protect that single page, without the toast.

## What it is not

Streaming Goblin is **not a general ad blocker**. It doesn't hide banners, block video ads, or stop trackers or ad scripts from loading. It only stops new tabs from being opened, and only on the domain you choose.

Don't use it on regular websites: it would also break legitimate popups like "Sign in with Google" or PayPal checkouts. For everything else, pair it with a real ad blocker such as [uBlock Origin Lite](https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh). The two work fine together.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Registers and injects the scripts on the chosen domain and its iframes; looks up the next episode for the seamless switch; keeps the watch history |
| `blocker.js` | The popup blocker itself, running in the page context |
| `toast.js` | Shows the "Popup blocked" toast |
| `autonext.js` | Next-episode countdown, seamless episode switch, autoplay, watch progress, resume, default audio/subtitles and intro skipping, inside the player |
| `continue.js` | The "Continue watching" box on the homepage |
| `popup.html` / `popup.js` | The toolbar popup |
| `fonts/` | Rubik Iso font, bundled locally |
| `icons/`, `goblin.png` | Icons and artwork |

## Permissions

- **scripting**, **webNavigation**, **tabs**: inject the blocker into the chosen site and its player iframe.
- **storage**: remember the domain, the on/off state, the next-episode, language and intro settings and the watch history for **Continue watching** (stored locally, in this browser only).
- **Access to all sites**: needed because the domain is configurable and the player is hosted elsewhere. The blocker only runs on tabs of the domain you set.

No data is collected or sent anywhere.
