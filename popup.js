const DEFAULTS = { enabled: true, domain: 'streamingcommunityz.photos' };

const domainInput = document.getElementById('domain');
const toggleBtn = document.getElementById('toggle');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

let enabled = true;

function render(extra = '') {
  toggleBtn.textContent = enabled ? 'Stop' : 'Start';
  toggleBtn.className = enabled ? 'on' : 'off';
  const color = enabled ? '#27ae60' : '#999';
  statusEl.innerHTML =
    `<span class="dot" style="background:${color}"></span>` +
    (enabled ? 'Attivo' : 'Disattivato') +
    (extra ? ` — ${extra}` : '');
}

async function save(newEnabled) {
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
  domainInput.value = res.domain;
  render(wasEnabled && !enabled ? 'ricarica la pagina per rimuoverlo' : 'salvato');
}

saveBtn.addEventListener('click', () => save(enabled));
toggleBtn.addEventListener('click', () => save(!enabled));
domainInput.addEventListener('keydown', e => { if (e.key === 'Enter') save(enabled); });

chrome.storage.sync.get(DEFAULTS).then(s => {
  enabled = s.enabled;
  domainInput.value = s.domain;
  render();
});
