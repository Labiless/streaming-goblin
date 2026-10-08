// Gira nel contesto della pagina, in ogni frame del sito e del player: raccoglie errori e
// messaggi che altrimenti si vedrebbero solo nei DevTools (inutilizzabili sul sito).
// Li passa a logger.js (mondo isolato) solo se il toggle "Log" è attivo: logger.js lo segnala
// con l'attributo data-goblin-log sul documento.
(() => {
  if (window.__goblinMainLogReady) return;
  Object.defineProperty(window, '__goblinMainLogReady', { value: true });

  const active = () => !!document.documentElement?.hasAttribute('data-goblin-log');

  const describe = v => {
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  const emit = (level, text) => {
    if (!active()) return;
    try {
      document.dispatchEvent(new CustomEvent('__goblin_log', { detail: JSON.stringify({ level, text }) }));
    } catch {}
  };

  // console.error/warn della pagina, più i messaggi del goblin eseguiti nella pagina
  for (const level of ['error', 'warn', 'info', 'log']) {
    const orig = console[level];
    console[level] = function (...args) {
      try {
        if (active()) {
          const text = args.map(describe).join(' ');
          if (level === 'error' || level === 'warn' || text.startsWith('[Streaming Goblin]')) {
            emit(level === 'log' ? 'info' : level, text);
          }
        }
      } catch {}
      return orig.apply(this, args);
    };
  }

  // Errori non gestiti e risorse che non si caricano (script, immagini…)
  window.addEventListener('error', e => {
    if (e instanceof ErrorEvent) {
      const file = e.filename ? ` (${e.filename.split(/[?#]/)[0].split('/').pop()}:${e.lineno})` : '';
      emit('error', `${e.message}${file}`);
    } else if (e.target && e.target !== window) {
      emit('warn', `Failed to load ${e.target.tagName?.toLowerCase()}: ${e.target.src || e.target.href || ''}`);
    }
  }, true);
  window.addEventListener('unhandledrejection', e => emit('error', `Unhandled rejection: ${describe(e.reason)}`));
})();
