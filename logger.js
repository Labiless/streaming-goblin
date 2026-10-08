// Gira nel mondo isolato, in ogni frame del sito e del player, prima degli altri script del
// goblin. Se il toggle "Log" è attivo manda al background (che li mostra nel popup):
// - i messaggi degli script del goblin, tramite window.__goblinLog(level, text);
// - errori e messaggi della pagina, raccolti da logger-main.js.
(() => {
  if (window.__goblinLog) return;

  let enabled = false;

  // logger-main.js (contesto della pagina) non può leggere le impostazioni: guarda l'attributo
  function applyFlag() {
    const el = document.documentElement;
    if (el) el.toggleAttribute('data-goblin-log', enabled);
    else setTimeout(applyFlag, 50);
  }
  chrome.storage.sync.get({ logging: false }).then(s => { enabled = s.logging; applyFlag(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.logging) {
      enabled = changes.logging.newValue;
      applyFlag();
    }
  });

  function send(level, ...args) {
    if (!enabled) return;
    const text = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
    chrome.runtime.sendMessage({ type: 'log', level, text: text.slice(0, 1000), source: location.hostname })
      .catch(() => {});
  }
  window.__goblinLog = send;

  document.addEventListener('__goblin_log', e => {
    try {
      const { level, text } = JSON.parse(e.detail);
      send(level, text);
    } catch {}
  });
})();
