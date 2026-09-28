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
