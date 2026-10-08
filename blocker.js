(() => {
  const MARK = '__scBlockerActive';
  // Evita doppie iniezioni nella stessa pagina
  if (window[MARK]) return;

  // Avvisa l'estensione (toast.js) che un tentativo è stato bloccato
  const report = () => {
    try { window.postMessage({ __scBlocker: 'blocked' }, '*'); } catch {}
  };

  // Applica tutte le protezioni a una finestra (la pagina o un iframe dello stesso dominio)
  function patch(win) {
    try {
      if (!win || win[MARK]) return;
      Object.defineProperty(win, MARK, { value: true });
    } catch {
      return; // finestra di un altro dominio: ci pensa l'estensione a iniettarci lo script
    }

    const doc = win.document;
    const isTop = win === win.top;
    const noop = () => {};

    // Rende la proprietà non sovrascrivibile, così gli script del sito non possono ripristinarla
    const lock = (obj, key, value) => {
      try { Object.defineProperty(obj, key, { value, writable: false, configurable: false }); } catch {}
    };

    // true se il target apre una nuova tab/finestra
    const opensElsewhere = t => {
      t = String(t || '').trim().toLowerCase();
      if (t === '' || t === '_self') return false;
      if (isTop && (t === '_top' || t === '_parent')) return false;
      return true;
    };
    const baseTarget = el => el?.ownerDocument?.querySelector('base[target]')?.target || '';
    const linkOf = el => el?.closest?.('a[href], area[href]');
    const linkBlocked = a => !!a && opensElsewhere(a.target || baseTarget(a));
    const formBlocked = (form, submitter) => !!form &&
      opensElsewhere(submitter?.getAttribute?.('formtarget') || form.target || baseTarget(form));
    const submitBlocked = el => (el?.type === 'submit' || el?.type === 'image') && formBlocked(el.form, el);

    // 1. window.open: restituisce una finta finestra, così lo script pubblicitario
    //    crede di esserci riuscito e non ritenta con altri metodi
    lock(win, 'open', function open() {
      report();
      return {
        closed: false, opener: null,
        close() { this.closed = true; }, focus: noop, blur: noop, postMessage: noop,
        location: { href: 'about:blank', assign: noop, replace: noop, reload: noop },
        document: { write: noop, writeln: noop, open: noop, close: noop }
      };
    });

    // 2. Link finti creati e "cliccati" da codice, anche se non sono nel DOM
    const clickOrig = win.HTMLElement.prototype.click;
    lock(win.HTMLElement.prototype, 'click', function click() {
      if (linkBlocked(linkOf(this)) || submitBlocked(this)) return report();
      return clickOrig.call(this);
    });

    const dispatchOrig = win.EventTarget.prototype.dispatchEvent;
    lock(win.EventTarget.prototype, 'dispatchEvent', function dispatchEvent(ev) {
      if (ev?.type === 'click' && (linkBlocked(linkOf(this)) || submitBlocked(this))) {
        report();
        return false;
      }
      return dispatchOrig.call(this, ev);
    });

    // 3. Form inviati verso una nuova tab
    const FP = win.HTMLFormElement.prototype;
    const submitOrig = FP.submit;
    lock(FP, 'submit', function submit() {
      if (formBlocked(this)) return report();
      return submitOrig.call(this);
    });
    const requestSubmitOrig = FP.requestSubmit;
    if (requestSubmitOrig) {
      lock(FP, 'requestSubmit', function requestSubmit(submitter) {
        if (formBlocked(this, submitter)) return report();
        return requestSubmitOrig.apply(this, arguments);
      });
    }

    // 4. Click veri su link trasparenti messi sopra il player.
    //    Registrato per primo, in fase di capture, quindi batte gli handler del sito.
    //    Ctrl/Cmd/Shift + click fatti davvero da te restano permessi.
    win.addEventListener('click', e => {
      if (e.isTrusted && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
      const path = e.composedPath ? e.composedPath() : [e.target];
      const a = path.find(n => (n?.localName === 'a' || n?.localName === 'area') && n.hasAttribute('href'));
      if (linkBlocked(a)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        report();
      }
    }, true);

    win.addEventListener('submit', e => {
      if (formBlocked(e.target, e.submitter)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        report();
      }
    }, true);

    // 5. Iframe nuovi usati per recuperare un window.open "pulito":
    //    ogni iframe dello stesso dominio riceve le stesse protezioni
    for (const name of ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement']) {
      const proto = win[name]?.prototype;
      const cw = proto && Object.getOwnPropertyDescriptor(proto, 'contentWindow');
      const cd = proto && Object.getOwnPropertyDescriptor(proto, 'contentDocument');
      if (!cw?.get) continue;
      try {
        Object.defineProperty(proto, 'contentWindow', {
          configurable: false, enumerable: cw.enumerable,
          get() { const w = cw.get.call(this); patch(w); return w; }
        });
        if (cd?.get) {
          Object.defineProperty(proto, 'contentDocument', {
            configurable: false, enumerable: cd.enumerable,
            get() { patch(cw.get.call(this)); return cd.get.call(this); }
          });
        }
      } catch {}
    }

    // 6. Permessi di autoplay e schermo intero agli iframe (il player sta su un altro
    //    dominio e senza allow="autoplay; fullscreen" Chrome non lo lascia partire da solo
    //    con l'audio né andare a schermo intero senza un click).
    //    I permessi vengono letti quando l'iframe inizia a caricare, quindi vanno messi prima.
    const seenFrames = new WeakSet();
    const allowAutoplay = f => {
      seenFrames.add(f);
      const allow = f.getAttribute('allow') || '';
      const missing = ['autoplay', 'fullscreen'].filter(p => !new RegExp(`\\b${p}\\b`).test(allow));
      if (!missing.length) return false;
      f.setAttribute('allow', [allow, ...missing].filter(Boolean).join('; '));
      return true;
    };
    // Iframe creati da codice: il permesso si mette prima che vengano inseriti
    const prepareInserted = nodes => {
      for (const n of nodes) {
        if (n?.localName === 'iframe') allowAutoplay(n);
        else if (n?.querySelectorAll) for (const f of n.querySelectorAll('iframe')) allowAutoplay(f);
      }
    };

    // Protegge gli iframe appena vengono inseriti nel DOM, prima che il sito
    // possa raggiungerli tramite window.frames[i]
    const frames = [doc.getElementsByTagName('iframe'), doc.getElementsByTagName('frame')];
    const scan = () => {
      for (const list of frames) {
        for (const f of list) {
          // Iframe scritti nell'HTML della pagina: stavano già caricando senza permesso,
          // quindi si ricaricano subito col permesso (solo se la pagina sta ancora caricando,
          // per non far ripartire un player già in uso)
          if (f.localName === 'iframe' && !seenFrames.has(f) && allowAutoplay(f) &&
              doc.readyState !== 'complete' && f.getAttribute('src')) {
            f.setAttribute('src', f.getAttribute('src'));
          }
          try { void f.contentWindow; } catch {}
        }
      }
    };

    const wrapMethods = (proto, names) => {
      for (const n of names) {
        const orig = proto?.[n];
        if (typeof orig !== 'function') continue;
        lock(proto, n, function (...args) {
          try { prepareInserted(args); } catch {}
          try { return orig.apply(this, args); } finally { scan(); }
        });
      }
    };
    wrapMethods(win.Node.prototype, ['appendChild', 'insertBefore', 'replaceChild']);
    wrapMethods(win.Element.prototype, [
      'append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren',
      'insertAdjacentElement', 'insertAdjacentHTML'
    ]);
    wrapMethods(win.Document.prototype, ['write', 'writeln']);

    for (const prop of ['innerHTML', 'outerHTML']) {
      const d = Object.getOwnPropertyDescriptor(win.Element.prototype, prop);
      if (!d?.set) continue;
      try {
        Object.defineProperty(win.Element.prototype, prop, {
          ...d, configurable: false,
          set(v) { d.set.call(this, v); scan(); }
        });
      } catch {}
    }

    // 7. Lo script pubblicitario, quando si accorge che il popup è bloccato, ridefinisce
    //    document.head perché restituisca null: <head> resta nella pagina, ma il sito non lo
    //    trova più e si rompe ("Cannot read properties of null (reading 'appendChild')").
    //    Le proprietà vengono fissate sui getter originali del browser.
    for (const prop of ['head', 'body', 'documentElement']) {
      const d = Object.getOwnPropertyDescriptor(win.Document.prototype, prop);
      if (!d?.get) continue;
      try {
        Object.defineProperty(doc, prop, { get: d.get, set: d.set, enumerable: d.enumerable, configurable: false });
      } catch {}
    }

    // Rete di sicurezza per iframe inseriti dall'HTML della pagina
    try { new win.MutationObserver(scan).observe(doc, { childList: true, subtree: true }); } catch {}
  }

  patch(window);
  console.log('Apertura nuove tab bloccata', window === window.top ? '' : `(frame: ${location.hostname})`);
})();
