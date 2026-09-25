// Gira nel mondo isolato dell'estensione: riceve i segnali da blocker.js
// (che gira nella pagina) e mostra il toast.
(() => {
  if (window.__scToastReady) return;
  window.__scToastReady = true;

  const FONT = 'Streaming Goblin Iso'; // nome univoco per non scontrarsi con i font del sito
  let host, box, label, count = 0, hideTimer, fontReady;

  // Il font va registrato sul documento (dentro lo shadow DOM @font-face non funziona).
  // Lo carichiamo come dati, così la CSP del sito non può bloccarlo.
  function loadFont() {
    fontReady ??= fetch(chrome.runtime.getURL('fonts/RubikIso-latin.woff2'))
      .then(r => r.arrayBuffer())
      .then(buf => new FontFace(FONT, buf).load())
      .then(face => document.fonts.add(face))
      .catch(() => {});
    // Al massimo aspettiamo poco: meglio un toast col font di riserva che in ritardo
    return Promise.race([fontReady, new Promise(r => setTimeout(r, 300))]);
  }

  function mount() {
    if (!host) {
      host = document.createElement('div');
      host.style.cssText =
        'all:initial;position:fixed;z-index:2147483647;left:0;right:0;bottom:32px;' +
        'display:flex;justify-content:center;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .t {
            display: flex; align-items: center; gap: 10px;
            font: 400 18px/1 '${FONT}', system-ui, sans-serif; color: #000;
            background: #ffea4f; border: 1px solid #000; padding: 6px 18px 6px 10px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, .45); white-space: nowrap;
            opacity: 0; transform: translateY(8px); transition: opacity .2s, transform .2s;
          }
          .t.show { opacity: 1; transform: none; }
          /* Il goblin è giallo: lo rendiamo nero per farlo risaltare sul giallo */
          img { height: 34px; width: auto; filter: brightness(0); }
        </style>
        <div class="t"><img alt=""><span></span></div>`;
      box = root.querySelector('.t');
      label = root.querySelector('span');
      root.querySelector('img').src = chrome.runtime.getURL('goblin.png');
    }
    // In schermo intero è visibile solo l'elemento fullscreen: il toast va messo lì dentro
    const fs = document.fullscreenElement;
    const parent = fs && !/^(video|iframe|img|canvas)$/i.test(fs.tagName)
      ? fs
      : document.body || document.documentElement;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  }

  async function show() {
    await loadFont();
    mount();
    count = box.classList.contains('show') ? count + 1 : 1;
    label.textContent = count > 1 ? `Popup blocked ×${count}` : 'Popup blocked';
    box.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => box.classList.remove('show'), 2000);
  }

  // Più intercettazioni per lo stesso click (es. click + window.open) contano una volta sola
  let last = 0;
  window.addEventListener('message', e => {
    if (e.data?.__scBlocker !== 'blocked') return;
    const now = Date.now();
    if (now - last < 300) return;
    last = now;
    show();
  });
})();
