const SCRIPT_ID = 'sc-blocker';
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

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });

  if (!enabled || !domain) return;

  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    js: ['blocker.js'],
    matches: matchPatterns(domain),
    runAt: 'document_start',
    world: 'MAIN',
    allFrames: true,
    persistAcrossSessions: true
  }]);

  await injectIntoOpenTabs(domain);
}

// Inietta subito nelle tab già aperte, così non serve ricaricare dopo "Start"
async function injectIntoOpenTabs(domain) {
  const tabs = await chrome.tabs.query({ url: matchPatterns(domain) });
  await Promise.all(tabs.map(tab =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['blocker.js'],
      world: 'MAIN'
    }).catch(() => {})
  ));
}

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
