const DEFAULTS = {
  enabled: true,
  domain: 'streamingcommunityz.photos',
  autoNext: true,
  autoNextValue: 30,
  autoNextUnit: 's'
};

const domainInput = document.getElementById('domain');
const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const autoNextBtn = document.getElementById('autonext');
const nextValueInput = document.getElementById('next-value');
const nextUnitSelect = document.getElementById('next-unit');
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
  const max = nextUnitSelect.value === '%' ? 50 : 600;
  const value = Math.min(max, Math.max(0, Math.round(Number(nextValueInput.value) || 0)));
  chrome.storage.sync.set({ autoNextValue: value, autoNextUnit: nextUnitSelect.value });
  return value;
}
nextValueInput.addEventListener('input', () => {
  clearTimeout(nextValueTimer);
  nextValueTimer = setTimeout(saveNextValue, 400);
});
nextValueInput.addEventListener('change', () => { nextValueInput.value = saveNextValue(); });
nextUnitSelect.addEventListener('change', () => { nextValueInput.value = saveNextValue(); });

// ---- Cronologia di "Continue watching" (salvata solo in questo browser) ----
const clearHistoryBtn = document.getElementById('clear-history');

chrome.storage.local.get({ history: [] }).then(({ history }) => {
  clearHistoryBtn.hidden = !history.length;
});
clearHistoryBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove('history');
  clearHistoryBtn.hidden = true;
  render('History cleared');
});

chrome.storage.sync.get(DEFAULTS).then(s => {
  enabled = s.enabled;
  domainInput.value = s.domain;
  savedDomain = s.domain;
  autoNext = s.autoNext;
  nextValueInput.value = s.autoNextValue;
  nextUnitSelect.value = s.autoNextUnit;
  render();
  renderAutoNext();
});
