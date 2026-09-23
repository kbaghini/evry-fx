/** EV-RY FX Free loader (MIT) — https://ev-ry.com/fx/ */
import {bootstrapFree} from './dom-free-bootstrap.js';

/** Explicit npm/module entry. The first call selects auto mode; later calls reuse readiness. */
export function loadFree(options={}){
  const window=(options.document??globalThis.document)?.defaultView;
  if(!window)throw TypeError('THD Free needs a browser document');
  if(window.THDFree)return window.THDFree.ready;
  const ready=bootstrapFree(options);
  const namespace=Object.freeze({ready});
  window.THDFree=namespace;
  ready.catch(error=>{
    if(window.THDFree===namespace)delete window.THDFree;
    console.error(error);
    window.dispatchEvent(new window.CustomEvent('thd:error',{detail:error}));
  });
  return ready;
}
