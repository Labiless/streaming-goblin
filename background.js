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
    // Toast, episodio successivo e "Continue watching" girano nel mondo isolato
    // dell'estensione, separato dagli script del sito, da dove possono leggere le impostazioni
    id: TOAST_ID,
    js: ['toast.js', 'autonext.js', 'continue.js'],
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
    chrome.scripting.executeScript({ target, files: ['toast.js', 'autonext.js', 'continue.js'], ...extra })
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

// La soglia dell'episodio successivo ora è solo in secondi: una vecchia soglia in percentuale
// (es. 5%) diventerebbe 5 secondi, quindi si torna al valore predefinito
chrome.runtime.onInstalled.addListener(async () => {
  const { autoNextUnit } = await chrome.storage.sync.get('autoNextUnit');
  if (autoNextUnit === '%') await chrome.storage.sync.remove('autoNextValue');
  if (autoNextUnit) await chrome.storage.sync.remove('autoNextUnit');
});
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

// ======== "Continue watching": cronologia di visione (vedi autonext.js e continue.js) ========

const HISTORY_KEY = 'history';
const HISTORY_MAX = 10;          // una voce per serie, la più recente per prima
const FINISHED_RATIO = 0.95;     // oltre questa percentuale l'episodio conta come visto

// Dati di episodio e serie già letti dal sito, per non riscaricarli a ogni aggiornamento
const metaCache = new Map();
// Tab in cui hai premuto "Resume" nella homepage: il player deve partire da solo
const resumeIntents = new Map();

async function getHistory() {
  return (await chrome.storage.local.get({ [HISTORY_KEY]: [] }))[HISTORY_KEY];
}

function setHistory(list) {
  return chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_MAX) });
}

// Immagine dell'episodio (dalla scheda della sua stagione), altrimenti quella della serie.
// Si salva solo il nome del file: il dominio del sito (e del suo CDN) cambia spesso.
async function findImage(watchBase, title, season, episodeId) {
  const titlesBase = watchBase.replace(/\/watch$/, '/titles');
  const url = `${titlesBase}/${title.id}-${title.slug}${season > 1 ? `/season-${season}` : ''}`;
  const pick = (images, types) =>
    types.map(t => images?.find(i => i.type === t)).find(Boolean)?.filename;
  try {
    const props = await fetchPageProps(url);
    const ep = props.loadedSeason?.episodes?.find(e => e.id === episodeId);
    return pick(ep?.images, ['cover']) || pick(props.title?.images, ['background', 'cover', 'poster']) || null;
  } catch {
    return null;
  }
}

// Legge dalla pagina dell'episodio (o del film) tutto quello che serve alla sezione.
// scwsId: l'id del video nel player, per essere sicuri che la pagina parli dello stesso video.
async function resolveMeta(pageUrl, scwsId) {
  const url = new URL(pageUrl);
  const m = url.pathname.match(/^(.*\/watch)\/(\d+)\/?$/);
  if (!m) throw new Error('not a watch page');
  const props = await fetchPageProps(url.href);
  const { title, episode: ep } = props;
  if (!title) throw new Error('no title data');
  const playing = ep?.scws_id ?? title.scws_id;
  if (scwsId && playing && String(playing) !== String(scwsId)) throw new Error('video not recognised');

  return {
    titleId: title.id,
    titleName: title.name,
    type: title.type,
    episodeId: ep?.id ?? null,
    season: ep?.season?.number ?? null,
    number: ep?.number ?? null,
    episodeName: ep?.name ?? '',
    scwsId: String(playing ?? scwsId),
    // Solo il percorso, per lo stesso motivo dell'immagine
    watchPath: `${m[1]}/${m[2]}` + (ep ? `?e=${ep.id}` : ''),
    nextEpisodeId: props.nextEpisode?.id ?? null,
    durationMin: ep?.duration ?? title.runtime ?? null,
    image: await findImage(url.origin + m[1], title, ep?.season?.number, ep?.id)
  };
}

function getMeta(key, pageUrl, scwsId) {
  if (!metaCache.has(key)) {
    const p = resolveMeta(pageUrl, scwsId);
    p.catch(() => metaCache.delete(key));
    metaCache.set(key, p);
  }
  return metaCache.get(key);
}

async function saveProgress(tabUrl, { scwsId, position, duration }) {
  let list = await getHistory();
  // I dati del video sono già nella cronologia se lo stavi guardando (anche dopo un riavvio)
  const meta = list.find(e => e.scwsId === scwsId) || await getMeta(scwsId, tabUrl, scwsId);
  let entry = { ...meta, position, duration, updatedAt: Date.now() };

  if (position / duration >= FINISHED_RATIO) {
    // Episodio finito: la sezione propone il successivo da capo, come Netflix.
    // Film o ultimo episodio della serie: non c'è altro da continuare.
    if (!meta.nextEpisodeId) {
      return setHistory(list.filter(e => e.titleId !== meta.titleId));
    }
    const nextUrl = new URL(`${meta.watchPath.replace(/\?.*$/, '')}?e=${meta.nextEpisodeId}`, tabUrl).href;
    const next = await getMeta(`e${meta.nextEpisodeId}`, nextUrl, null);
    entry = { ...next, position: 0, duration: (next.durationMin || 0) * 60, updatedAt: Date.now() };
  }

  await setHistory([entry, ...list.filter(e => e.titleId !== entry.titleId)]);
}

// Gli aggiornamenti arrivano ogni ~10 s: si mettono in fila per non sovrascriversi a vicenda
let historyQueue = Promise.resolve();
function queueHistory(task) {
  historyQueue = historyQueue.then(task).catch(() => {});
  return historyQueue;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;

  if (msg?.type === 'watch-progress') {
    queueHistory(() => saveProgress(sender.tab.url, msg));
    return;
  }

  if (msg?.type === 'resume-intent') {
    resumeIntents.set(sender.tab.id, Date.now());
    return;
  }

  if (msg?.type === 'take-resume-intent') {
    const t = resumeIntents.get(sender.tab.id);
    resumeIntents.delete(sender.tab.id);
    sendResponse(!!t && Date.now() - t < 60000);
  }
});

// ======== Lingua e sottotitoli predefiniti (vedi autonext.js) ========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'jw-tracks' || !sender.tab) return;
  // JW Player è raggiungibile solo dal contesto della pagina del player
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    world: 'MAIN',
    args: [msg.prefs],
    func: prefs => {
      const player = window.jwplayer?.('player');
      if (!player?.getAudioTracks) return { ok: false, error: 'JW Player not found' };

      const norm = s => String(s ?? '').trim().toLowerCase();
      // Prima per nome esatto ("Italian [Forced]"), poi per codice lingua ("ita")
      const find = (list, want, key) => {
        let i = list.findIndex(t => norm(t[key]) === norm(want.label));
        if (i < 0) i = list.findIndex(t => norm(t.language) === norm(want.lang));
        return i;
      };

      const state = (window.__goblinTracks ??= { prefs: null, item: null, until: {}, lastSet: {}, timer: null });
      state.prefs = prefs;

      const itemKey = () => player.getPlaylistItem()?.sources?.[0]?.file || player.getPlaylistItem()?.file || '';
      const kinds = {
        audio: {
          list: () => player.getAudioTracks() || [],
          current: () => player.getCurrentAudioTrack(),
          set: i => player.setCurrentAudioTrack(i),
          index: (list, want) => find(list, want, 'name')
        },
        subs: {
          list: () => player.getCaptionsList() || [],
          current: () => player.getCurrentCaptions(),
          set: i => player.setCurrentCaptions(i),
          index: (list, want) => (want.off ? 0 : find(list, want, 'label'))
        }
      };

      // Per i primi 10 s dopo che le tracce di un episodio sono pronte, la scelta viene
      // imposta (il player a volte torna da solo a quelle predefinite dello stream).
      // Dopo, un cambio fatto a mano nel player resta.
      const WINDOW = 10000;
      function tick() {
        const key = itemKey();
        if (key !== state.item) {
          // Nuovo episodio (anche dopo un cambio al volo): si riparte
          state.item = key;
          state.until = {};
        }
        if (!state.prefs) return;
        const now = Date.now();
        for (const [kind, k] of Object.entries(kinds)) {
          const want = state.prefs[kind];
          const list = k.list();
          if (!want || list.length < 2) continue; // tracce non ancora pronte (o una sola)
          state.until[kind] ??= now + WINDOW;
          if (now > state.until[kind]) continue;
          // Dopo un cambio si lascia al player il tempo di applicarlo, per non ripeterlo a raffica
          if (now - (state.lastSet[kind] || 0) < 2000) continue;
          const i = k.index(list, want);
          if (i >= 0 && i !== k.current()) {
            state.lastSet[kind] = now;
            k.set(i);
            console.info('[Streaming Goblin]', kind, '->', list[i]?.name || list[i]?.label);
          }
        }
      }

      if (!state.timer) {
        state.timer = setInterval(tick, 500);
        // Gli eventi di JW Player fanno solo arrivare prima il controllo
        for (const ev of ['playlistItem', 'audioTracks', 'captionsList', 'firstFrame']) player.on(ev, tick);
      }
      // Impostazioni appena cambiate (o player appena pronto): si applicano di nuovo
      state.until = {};
      tick();
      return { ok: true };
    }
  })
    .then(([res]) => sendResponse(res?.result || { ok: false, error: 'no result' }))
    .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // risposta asincrona
});

// ======== Salta la sigla (vedi autonext.js e popup.js) ========

// Gli orari della sigla erano salvati per serie: si tiene l'ultimo impostato come valore unico
chrome.runtime.onInstalled.addListener(async () => {
  const { intros } = await chrome.storage.sync.get('intros');
  if (!intros) return;
  const last = Object.values(intros).reverse().find(i => i.end > i.start);
  if (last) await chrome.storage.sync.set({ introSkip: !!last.on, introStart: last.start, introEnd: last.end });
  await chrome.storage.sync.remove('intros');
});
