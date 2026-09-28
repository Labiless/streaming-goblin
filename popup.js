const DEFAULTS = {
  enabled: true,
  domain: 'streamingcommunityz.photos',
  autoNext: true,
  autoNextValue: 30,
  tracks: false,
  tracksAudio: 'ita',
  tracksSubs: 'forced-ita',
  introSkip: false,
  introStart: null,
  introEnd: null,
  continueWatching: true
};

const domainInput = document.getElementById('domain');
const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const autoNextBtn = document.getElementById('autonext');
const nextValueInput = document.getElementById('next-value');
const nextRow = document.getElementById('next-row');

let enabled = true;
let savedDomain = '';
let debounceTimer;

function render(message = '') {
  toggleBtn.textContent = enabled ? 'STOP' : 'START';
  document.body.classList.toggle('off', !enabled);
  statusEl.textContent = message;
}

// fromTyping: non riscrive il campo mentre stai digitando (sposterebbe il cursore)
async function save(newEnabled, fromTyping = false) {
  const res = await chrome.runtime.sendMessage({
    type: 'save',
    enabled: newEnabled,
    domain: domainInput.value
  });
  if (!res?.ok) {
    render(res?.error || 'Errore');
    return;
  }
  const wasEnabled = enabled;
  enabled = newEnabled;
  savedDomain = res.domain;
  if (!fromTyping) domainInput.value = res.domain;
  render(wasEnabled && !enabled ? 'Ricarica la pagina per disattivarlo del tutto' : '');
}

toggleBtn.addEventListener('click', () => save(!enabled));

// Salvataggio automatico del dominio: poco dopo che smetti di scrivere,
// oppure subito con Invio o quando il campo perde il focus
function saveDomainIfChanged(fromTyping) {
  clearTimeout(debounceTimer);
  if (!domainInput.value.trim()) return;
  if (domainInput.value.trim() === savedDomain) {
    if (!fromTyping) domainInput.value = savedDomain;
    return;
  }
  save(enabled, fromTyping);
}
domainInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => saveDomainIfChanged(true), 400);
});
domainInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveDomainIfChanged(false); });
domainInput.addEventListener('blur', () => saveDomainIfChanged(false));

// ---- Episodio successivo automatico ----
// Letto al volo da autonext.js: nessun ricaricamento necessario
let autoNext = true;
let nextValueTimer;

function renderAutoNext() {
  autoNextBtn.textContent = autoNext ? 'ON' : 'OFF';
  autoNextBtn.classList.toggle('on', autoNext);
  nextRow.classList.toggle('disabled', !autoNext);
}

autoNextBtn.addEventListener('click', () => {
  autoNext = !autoNext;
  renderAutoNext();
  chrome.storage.sync.set({ autoNext });
});

function saveNextValue() {
  clearTimeout(nextValueTimer);
  const value = Math.min(600, Math.max(0, Math.round(Number(nextValueInput.value) || 0)));
  chrome.storage.sync.set({ autoNextValue: value });
  return value;
}
nextValueInput.addEventListener('input', () => {
  clearTimeout(nextValueTimer);
  nextValueTimer = setTimeout(saveNextValue, 400);
});
nextValueInput.addEventListener('change', () => { nextValueInput.value = saveNextValue(); });

// ---- Continue watching: cronologia e ripresa (salvata solo in questo browser) ----
const continueBtn = document.getElementById('continue');
const clearHistoryBtn = document.getElementById('clear-history');
const continueRow = document.getElementById('continue-row');
let continueWatching = true;

function renderContinue() {
  continueBtn.textContent = continueWatching ? 'ON' : 'OFF';
  continueBtn.classList.toggle('on', continueWatching);
  continueRow.classList.toggle('disabled', !continueWatching);
}
continueBtn.addEventListener('click', () => {
  continueWatching = !continueWatching;
  renderContinue();
  chrome.storage.sync.set({ continueWatching });
});

function renderHistoryCount(count) {
  clearHistoryBtn.disabled = !count;
  clearHistoryBtn.textContent = count ? `Clear history (${count})` : 'No history yet';
}
chrome.storage.local.get({ history: [] }).then(({ history }) => renderHistoryCount(history.length));
clearHistoryBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove('history');
  renderHistoryCount(0);
  render('History cleared');
});

// ---- Lingua e sottotitoli predefiniti ----
// Letti al volo da autonext.js: si applicano subito anche all'episodio in corso
const tracksBtn = document.getElementById('tracks');
const tracksAudio = document.getElementById('tracks-audio');
const tracksSubs = document.getElementById('tracks-subs');
const tracksRow = document.getElementById('tracks-row');
let tracks = false;

function renderTracks() {
  tracksBtn.textContent = tracks ? 'ON' : 'OFF';
  tracksBtn.classList.toggle('on', tracks);
  tracksRow.classList.toggle('disabled', !tracks);
}
tracksBtn.addEventListener('click', () => {
  tracks = !tracks;
  renderTracks();
  chrome.storage.sync.set({ tracks });
});
tracksAudio.addEventListener('change', () => chrome.storage.sync.set({ tracksAudio: tracksAudio.value }));
tracksSubs.addEventListener('change', () => chrome.storage.sync.set({ tracksSubs: tracksSubs.value }));

// ---- Salta la sigla: orari unici, validi per ogni episodio finché non li cambi ----
const introBtn = document.getElementById('intro');
const introStart = document.getElementById('intro-start');
const introEnd = document.getElementById('intro-end');
const introRow = document.getElementById('intro-row');
let introSkip = false;
let introTimer;

// "1:30" → 90, "90" → 90, "1:02:03" → 3723; vuoto o non valido → null
function parseTime(text) {
  const parts = text.trim().split(':');
  if (!parts[0] || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  return parts.reduce((sec, p) => sec * 60 + Number(p), 0);
}
const formatTime = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function renderIntro() {
  introBtn.textContent = introSkip ? 'ON' : 'OFF';
  introBtn.classList.toggle('on', introSkip);
  introRow.classList.toggle('disabled', !introSkip);
}

introBtn.addEventListener('click', () => {
  introSkip = !introSkip;
  renderIntro();
  chrome.storage.sync.set({ introSkip });
});

// Letti al volo da autonext.js: valgono subito, anche per l'episodio in corso
function saveIntroTimes() {
  clearTimeout(introTimer);
  const start = parseTime(introStart.value);
  const end = parseTime(introEnd.value);
  if (start === null || end === null) return;
  if (end <= start) {
    render('Intro: the end must come after the start (e.g. 0:45 → 1:30)');
    return;
  }
  render('');
  chrome.storage.sync.set({ introStart: start, introEnd: end });
}
for (const input of [introStart, introEnd]) {
  input.addEventListener('input', () => {
    clearTimeout(introTimer);
    introTimer = setTimeout(saveIntroTimes, 600);
  });
  input.addEventListener('change', () => {
    saveIntroTimes();
    const t = parseTime(input.value);
    if (t !== null) input.value = formatTime(t);
  });
}

chrome.storage.sync.get(DEFAULTS).then(s => {
  enabled = s.enabled;
  domainInput.value = s.domain;
  savedDomain = s.domain;
  autoNext = s.autoNext;
  nextValueInput.value = s.autoNextValue;
  tracks = s.tracks;
  tracksAudio.value = s.tracksAudio;
  tracksSubs.value = s.tracksSubs;
  introSkip = s.introSkip;
  if (s.introStart != null) introStart.value = formatTime(s.introStart);
  if (s.introEnd != null) introEnd.value = formatTime(s.introEnd);
  render();
  renderAutoNext();
  continueWatching = s.continueWatching;
  renderTracks();
  renderIntro();
  renderContinue();
});
