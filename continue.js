// Gira nel mondo isolato, nella pagina principale del sito.
// In homepage, qualche secondo dopo l'apertura, mostra in fondo alla pagina un riquadro
// "Continue watching" con l'ultima cosa guardata (la cronologia la salva background.js).
// È un elemento dell'estensione, separato dalla pagina del sito: se il sito cambia, non si rompe.
(() => {
  if (window.__goblinContinueReady || window !== window.top) return;
  window.__goblinContinueReady = true;

  const DELAY = 500;
  const FONT = 'Streaming Goblin Iso';

  // Homepage: "/" oppure "/it", "/en"…
  const isHome = () => /^\/([a-z]{2})?\/?$/.test(location.pathname);

  let host, root, fontReady, timer = null, wasHome = false;
  let currentTitleId = null; // la serie mostrata nel riquadro

  function loadFont() {
    fontReady ??= fetch(chrome.runtime.getURL('fonts/RubikIso-latin.woff2'))
      .then(r => r.arrayBuffer())
      .then(buf => new FontFace(FONT, buf).load())
      .then(face => document.fonts.add(face))
      .catch(() => {});
  }

  // Il sito è una SPA: si torna in homepage anche senza ricaricare la pagina
  function tick() {
    const home = isHome();
    if (home && !wasHome) {
      clearTimeout(timer);
      timer = setTimeout(show, DELAY);
    } else if (!home && wasHome) {
      clearTimeout(timer);
      hide();
    }
    wasHome = home;
  }
  tick();
  setInterval(tick, 1000);

  async function getHistory() {
    return (await chrome.storage.local.get({ history: [] })).history;
  }

  async function show() {
    const [entry] = await getHistory();
    if (!entry || !isHome()) return hide();
    loadFont();
    if (!host) build();
    render(entry);
    if (!host.isConnected) document.documentElement.appendChild(host);
    // Forza il calcolo del layout prima di aggiungere la classe, così l'animazione di entrata parte
    const panel = root.querySelector('.panel');
    void panel.offsetWidth;
    panel.classList.add('open');
  }

  function hide() {
    host?.remove();
    root?.querySelector('.panel').classList.remove('open');
  }

  function render(e) {
    const $ = sel => root.querySelector(sel);
    const url = new URL(e.watchPath, location.origin).href;
    // Le immagini stanno sul CDN del sito: cdn.<dominio attuale>
    const cdn = `https://cdn.${location.hostname.replace(/^www\./, '')}`;

    $('.thumb img').src = e.image ? `${cdn}/images/${e.image}` : chrome.runtime.getURL('goblin.png');
    $('.thumb').classList.toggle('no-image', !e.image);
    $('.fill').style.width = `${e.duration ? Math.min(100, e.position / e.duration * 100) : 0}%`;
    $('.name').textContent = e.titleName;
    $('.episode').textContent = e.type === 'movie' || e.season == null
      ? ''
      : `S${e.season}:E${e.number}${e.episodeName ? ` \u00b7 ${e.episodeName}` : ''}`;
    const left = Math.max(1, Math.round((e.duration - e.position) / 60));
    $('.left').textContent = e.position > 0 ? `${left} min left` : 'Up next';
    $('.resume').textContent = e.position > 0 ? 'Resume' : 'Play';
    for (const a of root.querySelectorAll('a')) a.href = url;
    currentTitleId = e.titleId;
  }

  function build() {
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;right:0;bottom:0;' +
      'display:flex;justify-content:center;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { --yellow: #ffea4f; --black: #000; }
        * { box-sizing: border-box; }
        .panel {
          pointer-events: auto;
          width: min(560px, calc(100vw - 32px));
          margin-bottom: 24px;
          background: var(--black);
          color: var(--yellow);
          border: 1px solid var(--yellow);
          box-shadow: 0 10px 40px rgba(0, 0, 0, .6);
          padding: 14px 16px 16px;
          font: 400 14px/1.3 system-ui, sans-serif;
          opacity: 0;
          transform: translateY(24px);
          transition: opacity .3s, transform .3s;
        }
        .panel.open { opacity: 1; transform: none; }
        header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        header img { height: 38px; width: auto; }
        h2 { flex: 1; margin: 0; font: 400 22px/1 '${FONT}', system-ui, sans-serif; }
        .close {
          background: none; border: 0; color: var(--yellow); cursor: pointer;
          font: 400 22px/1 system-ui, sans-serif; padding: 4px 6px; opacity: .8;
        }
        .close:hover { opacity: 1; }
        .body { display: flex; gap: 14px; }
        .thumb {
          position: relative; flex: none; display: block;
          width: 200px; aspect-ratio: 16 / 9; overflow: hidden;
          border: 1px solid var(--yellow); background: #111;
        }
        .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .thumb.no-image img { object-fit: contain; padding: 10px; }
        .thumb .play {
          position: absolute; inset: 0; display: grid; place-items: center;
          font-size: 34px; color: var(--yellow); background: rgba(0, 0, 0, .35);
          opacity: 0; transition: opacity .15s;
        }
        .thumb:hover .play { opacity: 1; }
        .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: rgba(255, 255, 255, .25); }
        .fill { height: 100%; background: var(--yellow); }
        .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .name {
          font: 400 20px/1.1 '${FONT}', system-ui, sans-serif;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .episode { color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .episode:empty { display: none; }
        .left { opacity: .75; font-size: 13px; }
        .actions { margin-top: auto; display: flex; align-items: center; gap: 14px; padding-top: 8px; }
        .resume {
          display: inline-block; text-decoration: none; cursor: pointer;
          background: var(--yellow); color: var(--black); border: 1px solid var(--yellow);
          padding: 8px 18px; font: 400 18px/1 '${FONT}', system-ui, sans-serif;
          transition: background .15s, color .15s;
        }
        .resume:hover { background: var(--black); color: var(--yellow); }
        .remove {
          background: none; border: 0; padding: 0; cursor: pointer;
          color: var(--yellow); opacity: .7; font: 400 13px/1 system-ui, sans-serif;
          text-decoration: underline;
        }
        .remove:hover { opacity: 1; }
        @media (max-width: 480px) {
          .body { flex-direction: column; }
          .thumb { width: 100%; }
        }
      </style>
      <div class="panel" role="dialog" aria-label="Continue watching">
        <header>
          <img class="goblin" alt="">
          <h2>Continue watching</h2>
          <button class="close" aria-label="Close">\u2715</button>
        </header>
        <div class="body">
          <a class="thumb">
            <img alt="">
            <span class="play">\u25b6</span>
            <div class="bar"><div class="fill"></div></div>
          </a>
          <div class="info">
            <div class="name"></div>
            <div class="episode"></div>
            <div class="left"></div>
            <div class="actions">
              <a class="resume">Resume</a>
              <button class="remove">Remove</button>
            </div>
          </div>
        </div>
      </div>`;
    root.querySelector('.goblin').src = chrome.runtime.getURL('goblin.png');

    root.querySelector('.close').addEventListener('click', hide);

    // Toglie la voce dalla cronologia e passa alla precedente, se c'è
    root.querySelector('.remove').addEventListener('click', async () => {
      const history = (await getHistory()).filter(e => e.titleId !== currentTitleId);
      await chrome.storage.local.set({ history });
      if (history.length) render(history[0]);
      else hide();
    });

    // Aprendo l'episodio da qui, il player deve partire da solo
    for (const a of root.querySelectorAll('a')) {
      a.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'resume-intent' }).catch(() => {});
      });
    }
  }
})();
