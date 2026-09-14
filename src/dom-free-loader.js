import {bootstrapFree} from './dom-free-bootstrap.js';

/** Explicit npm/module entry. The first call selects auto mode; later calls reuse readiness. */
export function loadFree(options={}){
  const window=(options.document??globalThis.document)?.defaultView;
  if(!window)throw TypeError('THD Free needs a browser document');
  if(window.THDFree)return window.THDFree.ready;
  const ready=bootstrapFree(options);
  window.THDFree=Object.freeze({ready});
  ready.catch(error=>{console.error(error);window.dispatchEvent(new window.CustomEvent('thd:error',{detail:error}));});
  return ready;
}
