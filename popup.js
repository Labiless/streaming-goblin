const DEFAULTS = { enabled: true, domain: 'streamingcommunityz.photos' };

const domainInput = document.getElementById('domain');
const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');

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

chrome.storage.sync.get(DEFAULTS).then(s => {
  enabled = s.enabled;
  domainInput.value = s.domain;
  savedDomain = s.domain;
  render();
});
