const SCRIPT_ID = 'sc-blocker';
const TOAST_ID = 'sc-toast';
const DEFAULTS = { enabled: true, domain: 'streamingcommunityz.photos' };

// Accetta sia "https://sito.xyz/qualcosa" sia "sito.xyz"
function normalizeDomain(input) {
  const raw = (input || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(url, domain) {
  try {
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function matchPatterns(domain) {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

// Registra (o rimuove) lo script che Chrome inietta a ogni caricamento pagina,
// prima di qualsiasi script del sito (document_start, MAIN world).
async function syncRegistration() {
  const { enabled, domain } = await getSettings();

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, TOAST_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(s => s.id) });

  if (!enabled || !domain) return;

  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    js: ['blocker.js'],
    matches: matchPatterns(domain),
    runAt: 'document_start',
    world: 'MAIN',
    allFrames: true,
    persistAcrossSessions: true
  }, {
    // Toast e autoplay dell'episodio successivo girano nel mondo isolato dell'estensione,
    // separato dagli script del sito, da dove possono leggere le impostazioni
    id: TOAST_ID,
    js: ['toast.js', 'autonext.js'],
    matches: matchPatterns(domain),
    runAt: 'document_start',
    allFrames: true,
    persistAcrossSessions: true
  }]);

  await injectIntoOpenTabs(domain);
}

// Inietta subito nelle tab già aperte, così non serve ricaricare dopo "Start"
async function injectIntoOpenTabs(domain) {
  const tabs = await chrome.tabs.query({ url: matchPatterns(domain) });
  await Promise.all(tabs.map(tab => injectInto({ tabId: tab.id, allFrames: true })));
}

function injectInto(target, extra = {}) {
  return Promise.all([
    chrome.scripting.executeScript({ target, files: ['blocker.js'], world: 'MAIN', ...extra }),
    chrome.scripting.executeScript({ target, files: ['toast.js', 'autonext.js'], ...extra })
  ]).catch(() => {});
}

// Il player sta in un iframe di un altro dominio (es. vixcloud), dove lo script
// registrato sopra non arriva: lo iniettiamo in ogni sotto-frame delle tab del sito.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId === 0 || !/^https?:/.test(url)) return;
  const { enabled, domain } = await getSettings();
  if (!enabled || !domain) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !hostMatches(tab.url, domain)) return;
  injectInto({ tabId, frameIds: [frameId] }, { injectImmediately: true });
});

chrome.runtime.onInstalled.addListener(syncRegistration);
chrome.runtime.onStartup.addListener(syncRegistration);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'save') return;
  (async () => {
    const domain = normalizeDomain(msg.domain);
    if (!domain) {
      sendResponse({ ok: false, error: 'Dominio non valido' });
      return;
    }
    await chrome.storage.sync.set({ enabled: !!msg.enabled, domain });
    await syncRegistration();
    sendResponse({ ok: true, domain });
  })().catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // risposta asincrona
});

// ======== Episodio successivo senza ricaricare la pagina (vedi autonext.js) ========

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${url}`);
  return res.text();
}

function decodeHtml(s) {
  const named = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
  return s.replace(/&(#x[\da-f]+|#\d+|quot|amp|lt|gt|apos);/gi, (_, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : named[e.toLowerCase()]);
}

// Le pagine del sito (Inertia) contengono tutti i dati dell'episodio nell'attributo data-page
async function fetchPageProps(url) {
  const html = await fetchText(url);
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) throw new Error(`page data not found - ${url}`);
  return JSON.parse(decodeHtml(m[1])).props;
}

// Dalla pagina della tab (/it/watch/<titolo>, con o senza ?e=<episodio>) ricava l'episodio
// successivo e il link del suo player vixcloud.
// scwsId: l'id del video nel player, per essere sicuri di partire dall'episodio giusto.
async function nextEpisodeInfo(tabUrl, scwsId) {
  const url = new URL(tabUrl);
  const m = url.pathname.match(/^(.*\/watch)\/(\d+)\/?$/);
  if (!m) throw new Error('not an episode page');
  const watchUrl = id => `${url.origin}${m[1]}/${m[2]}?e=${id}`;

  // Senza ?e= (es. bottone nella scheda della serie) è il sito a scegliere l'episodio:
  // si legge quale dai dati della pagina stessa
  const current = await fetchPageProps(url.href);
  const playing = current.episode?.scws_id;
  if (scwsId && playing && String(playing) !== String(scwsId)) {
    throw new Error('current episode not recognised');
  }
  const next = current.nextEpisode;
  if (!next?.id) throw new Error('no next episode');

  const nextProps = await fetchPageProps(watchUrl(next.id));
  if (!nextProps.embedUrl) throw new Error('next episode has no player');
  const iframeHtml = await fetchText(nextProps.embedUrl);
  const src = iframeHtml.match(/<iframe[^>]*\ssrc="([^"]+\/embed\/[^"]+)"/)?.[1];
  if (!src) throw new Error('player link not found');

  const afterNext = nextProps.nextEpisode?.id;
  return {
    ok: true,
    playerUrl: decodeHtml(src),
    watchUrl: watchUrl(next.id),
    hasNext: !!afterNext,
    nextWatchUrl: afterNext ? watchUrl(afterNext) : null
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;

  if (msg?.type === 'next-episode-info') {
    nextEpisodeInfo(sender.tab.url, msg.scwsId)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true; // risposta asincrona
  }

  if (msg?.type === 'jw-load') {
    // JW Player è raggiungibile solo dal contesto della pagina del player
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
      world: 'MAIN',
      args: [msg.item],
      func: item => {
        const player = window.jwplayer?.('player');
        if (!player?.load) return { ok: false, error: 'JW Player not found' };
        player.load([item]);
        player.play();
        return { ok: true };
      }
    })
      .then(([res]) => sendResponse(res?.result || { ok: false, error: 'no result' }))
      .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
});
