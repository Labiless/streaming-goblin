// Gira nel mondo isolato, dentro il frame del player (vixcloud / JW Player).
// Quando l'episodio sta per finire mostra un conto alla rovescia e poi preme il bottone
// "prossimo episodio" del player, che manda NEXT_EPISODE al sito e fa caricare l'episodio dopo.
// Quando il nuovo episodio si carica, lo fa partire da solo (e a schermo intero, se lo eri).
(() => {
  if (window.__goblinAutoNextReady) return;
  window.__goblinAutoNextReady = true;

  const DEFAULTS = { autoNext: true, autoNextValue: 30, autoNextUnit: 's' };
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
    overlay.show(`Next episode in ${remaining}`, true);
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

  // ======== Avvio automatico del nuovo episodio ========

  // Il click sul bottone "prossimo episodio" (nostro o tuo) lascia un segno che il player
  // del nuovo episodio trova appena si carica: sessionStorage resta nella stessa tab.
  // Il segno ricorda anche se eri a schermo intero.
  document.addEventListener('click', e => {
    if (!e.target.closest?.('.next-episode')) return;
    const flag = { t: Date.now(), fullscreen: !!document.fullscreenElement };
    try { sessionStorage.setItem(AUTOPLAY_KEY, JSON.stringify(flag)); } catch {}
  }, true);

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
    overlay.show(text, false);

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
    let host, box, label, fontReady;

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
          button {
            font: 600 13px/1 system-ui, sans-serif; cursor: pointer;
            padding: 8px 12px; border: 1px solid #000;
          }
          .now { background: #000; color: #ffea4f; }
          .cancel { background: transparent; color: #000; }
          button:hover { filter: brightness(1.25); }
          .box:not(.actions) button { display: none; }
        </style>
        <div class="box">
          <img alt="">
          <span class="label"></span>
          <button class="now">Play now</button>
          <button class="cancel">Cancel</button>
        </div>`;
      root.querySelector('img').src = chrome.runtime.getURL('goblin.png');
      box = root.querySelector('.box');
      label = root.querySelector('.label');
      root.querySelector('.now').addEventListener('click', goNext);
      root.querySelector('.cancel').addEventListener('click', () => {
        dismissed = true;
        cancel();
      });
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
      // actions: mostra i bottoni "Play now" / "Cancel"; senza, il riquadro lascia
      // passare i click al player (serve per "Click to unmute")
      show(text, actions) {
        loadFont();
        if (!host) build();
        label.textContent = text;
        box.classList.toggle('actions', actions);
        host.style.pointerEvents = actions ? 'auto' : 'none';
        mount();
      },
      hide() {
        host?.remove();
      }
    };
  })();

  const autoplayFlag = takeAutoplayFlag();
  if (autoplayFlag) autoplay(autoplayFlag);
})();
