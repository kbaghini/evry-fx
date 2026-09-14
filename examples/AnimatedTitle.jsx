import {useEffect, useRef} from 'react';

// Load /thd/src/dom-free-script.js before mounting React (without data-thd-auto).
// React owns the element/text; THD owns only its optional presentation.
export function AnimatedTitle({children = 'Hello EV-RY FX'}) {
  const element = useRef(null);
  useEffect(() => {
    let cancelled = false, owner;
    const ready = window.THDFree?.ready;
    if (!ready) { console.error('Load the EV-RY FX Free script before mounting React'); return; }
    ready.then(async api => {
      if (cancelled || !element.current) return;
      owner = api.create(element.current, {auto: false});
      const surface = owner.attachText(element.current);
      await surface.ready;
      if (!cancelled) surface.play('enter');
    }).catch(console.error);
    return () => { cancelled = true; owner?.destroy(); };
  }, [children]);
  return <h2 ref={element}>{children}</h2>;
}
