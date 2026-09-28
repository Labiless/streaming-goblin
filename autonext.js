// Gira nel mondo isolato, dentro il frame del player (vixcloud / JW Player).
// Quando l'episodio sta per finire mostra un conto alla rovescia e poi preme il bottone
// "prossimo episodio" del player. Il cambio avviene "al volo": il nuovo episodio viene caricato
// nello stesso player, senza ricaricare la pagina, così audio e schermo intero restano.
// Se il cambio al volo fallisce, si ricarica la pagina come fa il sito e il nuovo episodio
// parte da solo appena caricato.
(() => {
  if (window.__goblinAutoNextReady) return;
  window.__goblinAutoNextReady = true;

  const DEFAULTS = {
    autoNext: true, autoNextValue: 30, autoNextUnit: 's',
    tracks: false, tracksAudio: 'ita', tracksSubs: 'forced-ita'
  };
  const COUNTDOWN = 5;          // secondi di preavviso prima di cambiare episodio
  const MIN_DURATION = 120;     // ignora video troppo corti (trailer, intro…)
  const AUTOPLAY_KEY = '__goblinAutoplay';
  const AUTOPLAY_WINDOW = 60000; // il nuovo episodio deve caricarsi entro 1 minuto
  const FONT = 'Streaming Goblin Iso';

  let settings = { ...DEFAULTS };
  chrome.storage.sync.get(DEFAULTS).then(s => { settings = s; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(DEFAULTS)) if (changes[k]) settings[k] = changes[k].newValue;
    if (!settings.autoNext) cancel();
    if (changes.tracks || changes.tracksAudio || changes.tracksSubs) applyTracks();
  });

  // Il bottone esiste solo se c'è un episodio successivo (parametro nextEpisode=1)
  const nextButton = () => document.querySelector('.jw-icon.next-episode');
  const getVideo = () => document.querySelector('video.jw-video') || document.querySelector('video');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, timeout) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(200)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  }

  // ======== Conto alla rovescia verso l'episodio successivo ========

  let dismissed = false;  // hai premuto "Cancel" per questo episodio
  let triggered = false;
  let remaining = 0;
  let timer = null;
  let video = null;

  const threshold = duration => {
    const v = Math.max(0, Number(settings.autoNextValue) || 0);
    return settings.autoNextUnit === '%' ? duration * v / 100 : v;
  };

  function goNext() {
    const btn = nextButton();
    if (triggered || !btn) return;
    triggered = true;
    cancel();
    btn.click();
  }

  function start() {
    remaining = COUNTDOWN;
    renderCountdown();
    timer = setInterval(() => {
      if (video?.paused) return; // in pausa si ferma anche il conto alla rovescia
      remaining -= 1;
      if (remaining <= 0) goNext();
      else renderCountdown();
    }, 1000);
  }

  function cancel() {
    clearInterval(timer);
    timer = null;
    overlay.hide();
  }

  function renderCountdown() {
    overlay.show(`Next episode in ${remaining}`, [
      { label: 'Play now', primary: true, onClick: goNext },
      { label: 'Cancel', onClick: () => { dismissed = true; cancel(); } }
    ]);
  }

  // Gli eventi dei media non fanno bubbling, ma in fase di capture arrivano al document
  document.addEventListener('timeupdate', e => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    video = e.target;
    const d = video.duration;
    if (!settings.autoNext || triggered || !isFinite(d) || d < MIN_DURATION || !nextButton()) return;
    const left = d - video.currentTime;
    if (left > threshold(d)) {
      // Sei tornato indietro prima della soglia: si riarma
      dismissed = false;
      if (timer) cancel();
      return;
    }
    if (!dismissed && !timer) start();
  }, true);

  // Soglia a 0 o video finito prima della fine del conto alla rovescia
  document.addEventListener('ended', e => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    if (settings.autoNext && !dismissed) goNext();
  }, true);

  // ======== Episodio successivo senza ricaricare la pagina ========

  const log = (...args) => console.info('[Streaming Goblin]', ...args);
  let switching = false;
  // Dopo un cambio al volo la pagina del sito crede di essere ancora sull'episodio vecchio:
  // se serve ricaricare, bisogna dirle noi dove andare
  let upcomingWatchUrl = null;

  // Il click sul bottone "prossimo episodio" (nostro o tuo) non arriva al sito, che
  // ricaricherebbe la pagina: il cambio lo facciamo noi
  document.addEventListener('click', e => {
    if (!e.target.closest?.('.next-episode')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!switching) switchEpisode();
  }, true);

  async function switchEpisode() {
    switching = true;
    const wasFullscreen = !!document.fullscreenElement;
    try {
      // Il background legge dal sito qual è l'episodio dopo e il link del suo player
      const scwsId = location.pathname.match(/\/embed\/(\d+)/)?.[1];
      const info = await chrome.runtime.sendMessage({ type: 'next-episode-info', scwsId });
      if (!info?.ok) throw new Error(info?.error || 'no response');
      const item = await buildPlaylistItem(info.playerUrl);
      // Solo dal contesto della pagina si può comandare JW Player
      const loaded = await chrome.runtime.sendMessage({ type: 'jw-load', item });
      if (!loaded?.ok) throw new Error(loaded?.error || 'player not updated');

      updatePlayerUi(item, info.hasNext);
      try { history.replaceState(history.state, '', info.playerUrl); } catch {}
      window.top.postMessage({ __goblin: 'episode-changed', url: info.watchUrl }, '*');
      upcomingWatchUrl = info.nextWatchUrl;
      triggered = false;
      dismissed = false;
      cancel();
      log('next episode loaded without reloading:', item.description || item.title);
      overlay.flash(`Now playing ${item.description || item.title}`, 3000);
      if (!(await waitFor(isPlaying, 8000))) pressPlay();
    } catch (err) {
      const reason = err?.message || String(err);
      log('seamless next episode failed, reloading the page -', reason);
      // Il motivo resta visibile qualche secondo: la console dentro il player non è comoda da usare
      overlay.show(`Reloading page (${reason.slice(0, 70)})`);
      await sleep(3000);
      reloadToNext(wasFullscreen);
    } finally {
      switching = false;
    }
  }

  // Ricava l'indirizzo dello stream dalla pagina del player del nuovo episodio,
  // come fa lo script del player stesso
  async function buildPlaylistItem(playerUrl) {
    const res = await fetch(playerUrl, { credentials: 'include' });
    if (!res.ok) throw new Error(`player page HTTP ${res.status}`);
    const html = await res.text();
    const pick = re => html.match(re)?.[1];
    const unescapeJs = v => v.replace(/\\\//g, '/');

    const master = pick(/masterPlaylist\s*=\s*\{[\s\S]*?url:\s*'([^']+)'/);
    if (!master) throw new Error('stream not found in player page');
    const file = new URL(unescapeJs(master));
    for (const key of ['token', 'expires', 'asn']) {
      const v = pick(new RegExp(`'${key}'\\s*:\\s*'([^']*)'`));
      if (v) file.searchParams.append(key, v);
    }
    const q = new URL(playerUrl).searchParams;
    if (q.get('canPlayFHD')) file.searchParams.append('h', 1);
    if (q.get('scz')) file.searchParams.append('scz', 1);
    file.searchParams.append('lang', q.get('lang') ?? 'en');

    const thumbnails = pick(/thumbnailsUrl\s*=\s*'([^']*)'/);
    return {
      sources: [{ default: false, type: 'hls', file: file.toString(), label: '0', preload: 'metadata' }],
      title: decodeParam(q.get('t')),
      description: decodeParam(q.get('d')),
      tracks: thumbnails ? [{ file: unescapeJs(thumbnails), kind: 'thumbnails' }] : []
    };
  }

  // Titolo e descrizione arrivano nel link del player codificati in base64 (UTF-8)
  function decodeParam(v) {
    if (!v) return '';
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0)));
    } catch {
      return '';
    }
  }

  function updatePlayerUi(item, hasNext) {
    const setText = (selector, text) =>
      document.querySelectorAll(selector).forEach(el => { el.textContent = text; });
    setText('.video-title', item.title);
    setText('.video-description', item.description);
    setText('.video-title-mobile', [item.title, item.description].filter(Boolean).join(' '));
    // Ultimo episodio: niente bottone, quindi niente conto alla rovescia
    if (!hasNext) nextButton()?.remove();
  }

  // Riserva: si cambia episodio ricaricando la pagina, come fa il sito.
  // Il segno in sessionStorage (resta nella stessa tab) fa partire da solo il nuovo episodio
  // appena caricato, e ricorda se eri a schermo intero.
  function reloadToNext(fullscreen) {
    const flag = { t: Date.now(), fullscreen };
    try { sessionStorage.setItem(AUTOPLAY_KEY, JSON.stringify(flag)); } catch {}
    if (upcomingWatchUrl) window.top.postMessage({ __goblin: 'navigate', url: upcomingWatchUrl }, '*');
    else window.top.postMessage('NEXT_EPISODE', '*');
  }

  // Nella pagina principale del sito: aggiorna l'indirizzo dopo un cambio al volo
  // (così ricaricando resti sull'episodio giusto) o ci naviga se serve ricaricare
  if (window === window.top) {
    window.addEventListener('message', e => {
      const type = e.data?.__goblin;
      if (type !== 'episode-changed' && type !== 'navigate') return;
      let url;
      try { url = new URL(e.data.url, location.href); } catch { return; }
      if (url.origin !== location.origin || !/\/watch\/\d+/.test(url.pathname)) return;
      if (type === 'navigate') location.href = url.href;
      else history.replaceState(history.state, '', url.href);
    });
  }

  // ======== Avvio automatico dopo un ricaricamento ========

  function takeAutoplayFlag() {
    try {
      const flag = JSON.parse(sessionStorage.getItem(AUTOPLAY_KEY));
      sessionStorage.removeItem(AUTOPLAY_KEY);
      return flag?.t > 0 && Date.now() - flag.t < AUTOPLAY_WINDOW ? flag : null;
    } catch {
      return null;
    }
  }

  const isPlaying = () => {
    const v = getVideo();
    return !!v && !v.paused;
  };

  // Usa il bottone play di JW Player, così il player aggiorna correttamente il suo stato
  function pressPlay() {
    const player = document.querySelector('.jwplayer');
    if (!player || !/jw-state-(idle|paused|complete)/.test(player.className)) return;
    const btn = document.querySelector('.jw-display-icon-display .jw-icon-display') ||
                document.querySelector('.jw-icon-playback');
    btn?.click();
  }

  // Restituisce true se il video è partito con l'audio, false se è partito muto
  async function startPlayback() {
    // Il sito prova già a far partire il video da solo: gli lasciamo un attimo
    if (await waitFor(isPlaying, 1500)) return true;

    pressPlay();
    if (await waitFor(isPlaying, 2500)) return true;

    // Chrome ha bloccato l'avvio con l'audio: si parte senza audio (sempre permesso)
    const v = getVideo();
    v.muted = true;
    pressPlay();
    if (!(await waitFor(isPlaying, 2500))) {
      try { await v.play(); } catch {}
    }
    return false;
  }

  // Senza un tuo click Chrome rifiuta lo schermo intero: su un Chrome personale nemmeno la
  // regola AutomaticFullscreenAllowedForUrls basta. Qui si prova comunque (per esempio subito
  // dopo un tuo click); se Chrome rifiuta, ci pensa il riquadro "Click for fullscreen".
  async function enterFullscreen() {
    if (document.fullscreenElement) return true;
    const el = document.querySelector('.jwplayer');
    if (!el) return false;
    try {
      // Se Chrome non risponde entro poco, lo consideriamo rifiutato
      await Promise.race([el.requestFullscreen(), sleep(1500).then(() => { throw new Error('timeout'); })]);
      return !!document.fullscreenElement;
    } catch {
      return false;
    }
  }

  async function autoplay(flag) {
    // Aspetta che JW Player sia pronto (la barra dei controlli viene completata dal sito)
    const ready = await waitFor(() => document.querySelector('.jwplayer .jw-button-container') && getVideo(), 30000);
    if (!ready) return;

    const needsSound = !(await startPlayback()) && isPlaying();
    const needsFullscreen = flag.fullscreen && !(await enterFullscreen());
    if (needsSound || needsFullscreen) waitForGesture(needsSound, needsFullscreen);
  }

  // Quello che Chrome ha rifiutato (audio, schermo intero) si recupera al primo click o tasto
  function waitForGesture(needsSound, needsFullscreen) {
    const text = needsSound && needsFullscreen ? 'Click for sound & fullscreen'
      : needsSound ? 'Click to unmute'
      : 'Click for fullscreen';
    overlay.show(text);

    const onGesture = e => {
      if (!e.isTrusted || e.key === 'Escape') return;
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      overlay.hide();
      if (needsSound) {
        const v = getVideo();
        if (v) v.muted = false;
      }
      if (needsFullscreen) enterFullscreen();
      // Il click serviva solo per questo: non deve mettere in pausa il video
      if (e.type === 'pointerdown') {
        window.addEventListener('click', ev => {
          ev.stopImmediatePropagation();
          ev.preventDefault();
        }, { capture: true, once: true });
      }
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
  }

  // ======== Riquadro giallo (conto alla rovescia / avvisi) ========
  const overlay = (() => {
    let host, box, label, buttonsEl, buttonsKey = null, fontReady, flashTimer;

    function loadFont() {
      fontReady ??= fetch(chrome.runtime.getURL('fonts/RubikIso-latin.woff2'))
        .then(r => r.arrayBuffer())
        .then(buf => new FontFace(FONT, buf).load())
        .then(face => document.fonts.add(face))
        .catch(() => {});
    }

    function build() {
      host = document.createElement('div');
      host.style.cssText =
        'all:initial;position:fixed;z-index:2147483647;right:24px;bottom:84px;';
      // Evita che i click sul riquadro arrivino al player (che andrebbe in pausa)
      for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
        host.addEventListener(type, e => e.stopPropagation());
      }
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .box {
            display: flex; align-items: center; gap: 12px;
            background: #ffea4f; color: #000; border: 1px solid #000;
            padding: 10px 12px; box-shadow: 0 6px 24px rgba(0, 0, 0, .5);
            font: 400 18px/1 '${FONT}', system-ui, sans-serif;
          }
          img { height: 44px; width: auto; filter: brightness(0); }
          .label { white-space: nowrap; margin-right: 4px; }
          .buttons { display: flex; gap: 12px; }
          .buttons:empty { display: none; }
          button {
            font: 600 13px/1 system-ui, sans-serif; cursor: pointer;
            padding: 8px 12px; border: 1px solid #000;
            background: transparent; color: #000;
          }
          button.primary { background: #000; color: #ffea4f; }
          button:hover { filter: brightness(1.25); }
        </style>
        <div class="box">
          <img alt="">
          <span class="label"></span>
          <div class="buttons"></div>
        </div>`;
      root.querySelector('img').src = chrome.runtime.getURL('goblin.png');
      box = root.querySelector('.box');
      label = root.querySelector('.label');
      buttonsEl = root.querySelector('.buttons');
    }

    // Ricrea i bottoni solo se cambiano (il conto alla rovescia aggiorna il testo ogni secondo)
    function setButtons(buttons) {
      const key = buttons.map(b => b.label).join('|');
      if (key === buttonsKey) return;
      buttonsKey = key;
      buttonsEl.replaceChildren(...buttons.map(b => {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.primary) el.className = 'primary';
        el.addEventListener('click', b.onClick);
        return el;
      }));
    }

    // In schermo intero è visibile solo l'elemento fullscreen: il riquadro va messo lì dentro
    function mount() {
      const fs = document.fullscreenElement;
      const parent = fs && !/^(video|iframe|img|canvas)$/i.test(fs.tagName)
        ? fs
        : document.body || document.documentElement;
      if (parent && host.parentNode !== parent) parent.appendChild(host);
    }
    document.addEventListener('fullscreenchange', () => { if (host?.isConnected) mount(); });

    return {
      // buttons: [{ label, primary, onClick }]. Senza bottoni il riquadro lascia passare
      // i click al player (serve per "Click to unmute")
      show(text, buttons = []) {
        loadFont();
        if (!host) build();
        clearTimeout(flashTimer);
        label.textContent = text;
        setButtons(buttons);
        host.style.pointerEvents = buttons.length ? 'auto' : 'none';
        mount();
      },
      hide() {
        clearTimeout(flashTimer);
        host?.remove();
      },
      // Messaggio che sparisce da solo, se nel frattempo non è stato sostituito
      flash(text, ms, buttons = []) {
        this.show(text, buttons);
        flashTimer = setTimeout(() => { if (label.textContent === text) this.hide(); }, ms);
      }
    };
  })();

  // ======== Cronologia per "Continue watching" (vedi background.js e continue.js) ========

  // L'id del video nel player: dopo un cambio al volo l'indirizzo del frame viene aggiornato
  const scwsIdOf = () => location.pathname.match(/\/embed\/(\d+)/)?.[1];
  let lastReport = 0;

  function reportProgress(force) {
    const v = getVideo();
    const scwsId = scwsIdOf();
    if (!v || !scwsId || !isFinite(v.duration) || v.duration < MIN_DURATION || v.currentTime < 10) return;
    const now = Date.now();
    if (!force && now - lastReport < 10000) return;
    lastReport = now;
    chrome.runtime.sendMessage({
      type: 'watch-progress',
      scwsId,
      position: Math.floor(v.currentTime),
      duration: Math.floor(v.duration)
    }).catch(() => {});
  }
  document.addEventListener('timeupdate', () => reportProgress(false), true);
  document.addEventListener('pause', () => reportProgress(true), true);
  window.addEventListener('pagehide', () => reportProgress(true));

  // Se questo video era a metà, la prima volta che parte riprende da dove eri rimasto
  async function setupResume() {
    const scwsId = scwsIdOf();
    if (!scwsId) return;
    const { history = [] } = await chrome.storage.local.get({ history: [] });
    const saved = history.find(e => e.scwsId === scwsId);
    if (!saved || saved.position < 30 || saved.duration - saved.position < 60) return;

    document.addEventListener('playing', function onPlaying(e) {
      if (!(e.target instanceof HTMLVideoElement)) return;
      document.removeEventListener('playing', onPlaying, true);
      const v = e.target;
      if (v.currentTime > 5) return; // un punto di partenza l'ha già scelto il sito
      v.currentTime = saved.position;
    }, true);
  }

  // ======== Lingua e sottotitoli predefiniti (vedi background.js) ========

  // Nomi e codici lingua come compaiono nelle tracce del player
  const AUDIO = {
    ita: { label: 'Italian', lang: 'ita' },
    eng: { label: 'English', lang: 'eng' }
  };
  const SUBS = {
    off: { off: true },
    'forced-ita': { label: 'Italian [Forced]', lang: 'forced-ita' },
    ita: { label: 'Italian', lang: 'ita' },
    eng: { label: 'English', lang: 'eng' },
    'eng-cc': { label: 'English [CC]', lang: 'eng' }
  };

  function applyTracks() {
    if (!scwsIdOf()) return; // non è il frame del player
    const prefs = settings.tracks
      ? { audio: AUDIO[settings.tracksAudio] || null, subs: SUBS[settings.tracksSubs] || null }
      : null;
    chrome.runtime.sendMessage({ type: 'jw-tracks', prefs }).catch(() => {});
  }

  (async () => {
    if (scwsIdOf()) {
      // Appena il player è pronto; le impostazioni vanno lette prima
      Promise.all([
        chrome.storage.sync.get(DEFAULTS).then(s => { settings = s; }),
        waitFor(() => document.querySelector('.jwplayer .jw-button-container'), 30000)
      ]).then(([, ready]) => { if (ready) applyTracks(); });
    }
    setupResume();
    const autoplayFlag = takeAutoplayFlag();
    if (autoplayFlag) return autoplay(autoplayFlag);
    // Hai premuto "Resume" nella homepage: il video parte da solo
    if (scwsIdOf() && await chrome.runtime.sendMessage({ type: 'take-resume-intent' }).catch(() => false)) {
      autoplay({ fullscreen: false });
    }
  })();
})();
