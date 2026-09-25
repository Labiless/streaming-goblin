<p align="center">
  <img src="goblin.png" alt="Streaming Goblin" width="152">
</p>

<h1 align="center">Streaming Goblin</h1>

<p align="center">
  A tiny Chrome extension that stops streaming sites from hijacking your clicks to open ads in new tabs.
</p>

---

## The problem

On some streaming sites, the first few clicks on anything (the video, the player, the fullscreen button…) don't do what you asked: instead they open an ad in a new tab and switch you to it. Only after 3–4 attempts does the click actually work.

Streaming Goblin blocks those attempts, so every click does what it should on the first try.

## Installation

The extension isn't on the Chrome Web Store, so you load it manually:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Optional: pin the goblin to the toolbar via the puzzle-piece icon.

It works in any Chromium-based browser that supports extensions (Chrome, Edge, Brave, Opera…).

## Usage

Click the goblin in the toolbar to open the popup:

- **START / STOP**: turns the blocker on or off. The button shows the action you can take, so it reads **STOP** while the blocker is active. When it's off the goblin turns grey.
- **Update Domain**: the site to protect. Type or paste the domain (`streamingcommunityz.photos`) or a full URL (`https://streamingcommunityz.photos/...`). It's saved automatically as soon as you stop typing, or right away when you press Enter. Subdomains are covered too.

When a popup attempt is blocked, a small yellow **Popup blocked** toast appears at the bottom of the page (also in fullscreen). If several attempts are blocked in a row it shows a counter (`×2`, `×3`…).

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

`blocker.js` also works standalone: paste it into the DevTools console of the site to protect that single page, without the toast.

## What it is not

Streaming Goblin is **not a general ad blocker**. It doesn't hide banners, block video ads, or stop trackers or ad scripts from loading. It only stops new tabs from being opened, and only on the domain you choose.

Don't use it on regular websites: it would also break legitimate popups like "Sign in with Google" or PayPal checkouts. For everything else, pair it with a real ad blocker such as [uBlock Origin Lite](https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh). The two work fine together.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Registers and injects the scripts on the chosen domain and its iframes |
| `blocker.js` | The popup blocker itself, running in the page context |
| `toast.js` | Shows the "Popup blocked" toast |
| `popup.html` / `popup.js` | The toolbar popup |
| `fonts/` | Rubik Iso font, bundled locally |
| `icons/`, `goblin.png` | Icons and artwork |

## Permissions

- **scripting**, **webNavigation**, **tabs**: inject the blocker into the chosen site and its player iframe.
- **storage**: remember the domain and the on/off state.
- **Access to all sites**: needed because the domain is configurable and the player is hosted elsewhere. The blocker only runs on tabs of the domain you set.

No data is collected or sent anywhere.
