(() => {
  // Evita doppie iniezioni nella stessa pagina
  if (window.__scBlockerActive) return;
  window.__scBlockerActive = true;

  const noop = () => null;

  // 1. Il metodo classico
  window.open = noop;

  // 2. Link finti creati e "cliccati" da codice
  const clickOrig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.target && this.target !== '_self') return;
    return clickOrig.call(this);
  };

  const dispatchOrig = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (this instanceof HTMLAnchorElement && ev.type === 'click' &&
        this.target && this.target !== '_self') return false;
    return dispatchOrig.call(this, ev);
  };

  // 3. Form inviati verso una nuova tab
  const submitOrig = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (this.target && this.target !== '_self') return;
    return submitOrig.call(this);
  };

  // 4. Trucco per recuperare un window.open "pulito" da un iframe nuovo
  const cwOrig = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get() {
      const w = cwOrig.get.call(this);
      try { if (w) w.open = noop; } catch {}
      return w;
    }
  });

  console.log('Apertura nuove tab bloccata');
})();