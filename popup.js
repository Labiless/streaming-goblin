const DEFAULTS = {
  enabled: true,              // "Block popup"
  domain: 'streamingcommunityz.pictures',
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

const $ = id => document.getElementById(id);
const statusEl = $('status');
const domainInput = $('domain');

let savedDomain = '';
let enabled = true;

function showStatus(message = '') {
  statusEl.textContent = message;
}

// ======== Toggle delle funzioni ========
// Ogni sezione ha data-key = impostazione che accende/spegne. Da accesa il nome è pieno
// e si apre l'accordion con le impostazioni (se ne ha).

function setFeature(key, on) {
  const section = document.querySelector(`.feature[data-key="${key}"]`);
  section.classList.toggle('on', on);
  $(`sw-${key}`).setAttribute('aria-checked', String(on));
}

for (const section of document.querySelectorAll('.feature')) {
  const key = section.dataset.key;
  $(`sw-${key}`).addEventListener('click', async () => {
    const on = !section.classList.contains('on');
    setFeature(key, on);
    // "Block popup" cambia gli script iniettati: ci pensa il background
    if (key === 'enabled') {
      const ok = await saveDomainAndBlocker(on, savedDomain);
      if (ok && !on) showStatus('Reload the page to fully turn off popup blocking');
      return;
    }
    chrome.storage.sync.set({ [key]: on });
  });
}

// ======== Dominio (salvato da solo mentre scrivi) ========

async function saveDomainAndBlocker(newEnabled, domain, fromTyping = false) {
  const res = await chrome.runtime.sendMessage({ type: 'save', enabled: newEnabled, domain });
  if (!res?.ok) {
    showStatus(res?.error || 'Error');
    return false;
  }
  enabled = newEnabled;
  savedDomain = res.domain;
  if (!fromTyping) domainInput.value = res.domain;
  showStatus('');
  return true;
}

let domainTimer;
// fromTyping: non riscrive il campo mentre stai digitando (sposterebbe il cursore)
function saveDomainIfChanged(fromTyping) {
  clearTimeout(domainTimer);
  const value = domainInput.value.trim();
  if (!value) return;
  if (value === savedDomain) {
    if (!fromTyping) domainInput.value = savedDomain;
    return;
  }
  saveDomainAndBlocker(enabled, domainInput.value, fromTyping);
}
domainInput.addEventListener('input', () => {
  clearTimeout(domainTimer);
  domainTimer = setTimeout(() => saveDomainIfChanged(true), 400);
});
domainInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveDomainIfChanged(false); });
domainInput.addEventListener('blur', () => saveDomainIfChanged(false));

// ======== Auto next episode: secondi prima della fine ========

const nextValue = $('next-value');
const nextLabel = $('next-label');
const renderNextValue = () => { nextLabel.textContent = `${nextValue.value}S`; };
nextValue.addEventListener('input', renderNextValue);
nextValue.addEventListener('change', () => chrome.storage.sync.set({ autoNextValue: Number(nextValue.value) }));

// ======== Auto language ========

const tracksAudio = $('tracks-audio');
const tracksSubs = $('tracks-subs');
tracksAudio.addEventListener('change', () => chrome.storage.sync.set({ tracksAudio: tracksAudio.value }));
tracksSubs.addEventListener('change', () => chrome.storage.sync.set({ tracksSubs: tracksSubs.value }));

// ======== Skip intro: orari validi per ogni episodio finché non li cambi ========

const introStart = $('intro-start');
const introEnd = $('intro-end');
let introTimer;

// "1:30" → 90, "90" → 90, "1:02:03" → 3723; vuoto o non valido → null
function parseTime(text) {
  const parts = text.trim().split(':');
  if (!parts[0] || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  return parts.reduce((sec, p) => sec * 60 + Number(p), 0);
}
const formatTime = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function saveIntroTimes() {
  clearTimeout(introTimer);
  const start = parseTime(introStart.value);
  const end = parseTime(introEnd.value);
  if (start === null || end === null) return;
  if (end <= start) {
    showStatus('Skip intro: the end must come after the start');
    return;
  }
  showStatus('');
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

// ======== Stato iniziale ========

chrome.storage.sync.get(DEFAULTS).then(s => {
  enabled = s.enabled;
  savedDomain = s.domain;
  domainInput.value = s.domain;

  nextValue.value = Math.min(Number(nextValue.max), s.autoNextValue);
  renderNextValue();
  tracksAudio.value = s.tracksAudio;
  tracksSubs.value = s.tracksSubs;
  if (s.introStart != null) introStart.value = formatTime(s.introStart);
  if (s.introEnd != null) introEnd.value = formatTime(s.introEnd);

  // Niente animazione dell'accordion all'apertura del popup
  document.body.classList.add('no-anim');
  for (const key of ['enabled', 'autoNext', 'tracks', 'introSkip', 'continueWatching']) setFeature(key, !!s[key]);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('no-anim')));
});
