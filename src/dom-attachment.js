import {withRevealOnView} from './dom-reveal.js';
import {attachSVGSurface} from './dom-svg-surface.js';
import {swapDOMImage} from './dom-image-swap.js';
import {animateDOMOnce} from './dom-once.js';
import {attachImageSurface} from './dom-image-surface.js';
import {createRenderOwner} from './render-owner.js';
import {createViewportRenderOwner} from './viewport-render-owner.js';
import {attachTextSurface} from './dom-text-surface.js';
import {chooseDOMPresentation} from './dom-auto-route.js';

// One optional visual owner. Application components retain their DOM, values,
// events, fonts and lifecycle; this module knows nothing about EV or its theme.
const attached = new WeakMap();
const rendererOwners=new WeakMap();

// Explicit mixed presentation. Existing owners retain rendering and surface state.
export function createDOMInstallation(THREE, document, {presentation='local', documentCanvas=true, ...rendererOptions} = {}) {
  rendererOptions.documentCanvas=documentCanvas;
  const modes = {local:'local', global:'viewport',auto:'auto'};
  const validate = mode => { if (!Object.hasOwn(modes, mode)) throw TypeError('Expected local, global or auto presentation'); };
  validate(presentation);
  const owners = new Map(), surfaces = new Map(), layers = new Map();
  let disposed = false;
  const automatic=new Map(),window=document.defaultView;
  const routeEvents=['toggle','close','fullscreenchange','compositionend','transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel'];
  let observer=null,routeFrame=null;
  function schedule(){if(!disposed&&automatic.size&&routeFrame===null){routeFrame=true;queueMicrotask(reconcile);}}
  function watch(){
    if(observer)return;
    observer=new window.MutationObserver(records=>{
      const owned=node=>node.nodeType===1&&node.matches('[data-thd-viewport-anchor],[data-thd-global-canvas]');
      if(records.some(r=>!r.target.closest?.('[data-thd-viewport-anchor],[data-thd-global-canvas]')&&!(r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(owned))))schedule();
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','open','hidden','popover']});
    for(const event of routeEvents)document.addEventListener(event,schedule,true);
    window.addEventListener('resize',schedule);
  }
  function unwatch(){
    if(automatic.size)return;
    observer?.disconnect();observer=null;
    routeFrame=null;
    for(const event of routeEvents)document.removeEventListener(event,schedule,true);
    window.removeEventListener('resize',schedule);
  }
  function reconcile(){
    routeFrame=null;
    if(disposed)return;
    const styles=new WeakMap(),readStyle=node=>{let value=styles.get(node);if(!value){value=window.getComputedStyle(node);styles.set(node,value);}return value;};
    for(const [surface,state] of automatic){
      const target=chooseDOMPresentation(surface.element,layers,readStyle);
      state.reason=target.reason;state.pending=false;state.error=null;
      try{handoff(surface,target,true);}
      catch(error){state.pending=true;state.error=error.message;}
    }
  }
  function follow(surface){automatic.set(surface,{reason:'pending',pending:true,error:null});watch();schedule();surface.ready.then(schedule);}
  function attach(method, element, {presentation:mode=presentation, layer=null, ...options} = {}) {
    if (disposed) throw Error('DOM installation disposed');
    validate(mode);
    const auto=mode==='auto';
    if(auto){if(layer!==null)throw TypeError('Auto selects its layer; use global for an explicit layer');const target=chooseDOMPresentation(element,layers);mode=target.presentation;layer=target.layer;}
    if(layer!==null&&(mode!=='global'||!layers.has(layer)))throw TypeError('Unknown layer or non-global layer request');
    const key=layer===null?mode:'layer:'+layer;
    let owner = owners.get(key);
    if (!owner) {
      owner = wrapOwner(createViewportRenderOwner(THREE, document, {...rendererOptions, ...(layer===null?{}:layers.get(layer)), local:mode==='local'}));
      owners.set(key, owner);
    }
    let surface;
    try { surface = owner[method](element, options); }
    catch (error) {
      if (!owner.stats().controls) { owners.delete(key); owner.destroy(); }
      throw error;
    }
    surfaces.set(surface, key);
    if(auto)follow(surface);
    const destroy = surface.destroy;
    surface.destroy = () => {
      if (!surfaces.has(surface)) return;
      const currentKey=surfaces.get(surface),currentOwner=owners.get(currentKey);
      surfaces.delete(surface);
      automatic.delete(surface);unwatch();
      try { destroy(); }
      finally {
        if (!currentOwner.stats().controls && owners.get(currentKey) === currentOwner) {
          owners.delete(currentKey); currentOwner.destroy();
        }
      }
    };
    return surface;
  }
  function handoff(surface,{presentation:mode='global',layer=null}={},recover=false){
      if(disposed||!surfaces.has(surface))throw Error('Surface is not owned by this installation');
      const from=surfaces.get(surface),to=layer===null?mode:'layer:'+layer;
      if(layer!==null&&(mode!=='global'||!layers.has(layer)))throw TypeError('Unknown layer or non-global layer request');
      if(from===to)return;
      const previous=owners.get(from);
      let next=owners.get(to);
      if(!next){next=wrapOwner(createViewportRenderOwner(THREE,document,{...rendererOptions,...(layer===null?{}:layers.get(layer)),local:mode==='local'}));owners.set(to,next);}
      try{rendererOwners.get(previous).transfer(surface,rendererOwners.get(next),{recover});}
      catch(error){if(!next.stats().controls){owners.delete(to);next.destroy();}throw error;}
      surfaces.set(surface,to);
      if(!previous.stats().controls){owners.delete(from);previous.destroy();}
    }
  return {
    transfer(surface,{presentation:mode='global',layer=null}={}){
      if(disposed||!surfaces.has(surface))throw Error('Surface is not owned by this installation');
      validate(mode);
      if(mode==='auto'){if(layer!==null)throw TypeError('Auto selects its layer');follow(surface);return;}
      handoff(surface,{presentation:mode,layer});automatic.delete(surface);unwatch();
    },
    routing(surface){
      if(!surfaces.has(surface))throw Error('Unknown surface');
      const key=surfaces.get(surface),state=automatic.get(surface);
      return {requested:state?'auto':key==='local'?'local':'global',presentation:key==='local'?'local':'global',layer:key.startsWith('layer:')?key.slice(6):null,reason:state?.reason||'explicit',pending:state?.pending||false,error:state?.error||null};
    },
    registerLayer(name, {root, zIndex=100} = {}) {
      if(disposed)throw Error('DOM installation disposed');
      if(typeof name!=='string'||!name||layers.has(name))throw TypeError('Unique layer name required');
      if(root?.ownerDocument!==document||root.tagName!=='DIALOG'||!Number.isFinite(zIndex))throw TypeError('Layer requires a dialog in the owner document');
      layers.set(name,{root,zIndex});
      schedule();
    },
    unregisterLayer(name) {
      if([...surfaces.values()].includes('layer:'+name))throw Error('Detach layer surfaces before unregistering');
      layers.delete(name);
      schedule();
    },
    attachText:(element, options) => attach('attachText', element, options),
    attachImage:(element, options) => attach('attachImage', element, options),
    attachSVG:(element, options) => attach('attachSVG', element, options),
    animateOnce:(element, options) => animateDOMOnce(attach,element,options),
    swapImage:(previous,next,options)=>swapDOMImage((element,settings)=>animateDOMOnce(attach,element,settings),previous,next,options),
    refresh() {
      if (disposed) throw Error('DOM installation disposed');
      for (const owner of owners.values()) owner.refresh();
      schedule();
    },
    stats() {
      const entries = [...owners].map(([mode, owner]) => [mode, owner.stats()]);
      return {disposed, controls:surfaces.size, contexts:entries.reduce((n,[,s])=>n+s.contexts,0),
        copies:entries.reduce((n,[,s])=>n+s.copies,0), owners:Object.fromEntries(entries)};
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const surface of [...surfaces.keys()]) try { surface.destroy(); } catch (error) { errors.push(error); }
      for (const owner of owners.values()) try { owner.destroy(); } catch (error) { errors.push(error); }
      owners.clear();layers.clear();
      if (errors.length) throw new AggregateError(errors, 'DOM installation cleanup failed');
    }
  };
}

export function createDOMRenderer(THREE, document, options = {}) {
  const owner = createRenderOwner(THREE, document, options);
  return wrapOwner(owner);
}
function wrapOwner(owner){
  function attach(factory, element, options) {
    if (attached.has(element)) throw new Error('Element already has a THD attachment');
    const surface = owner.create((element,namespace,settings)=>withRevealOnView(factory,element,namespace,settings), element, options);
    attached.set(element, surface);
    const destroy = surface.destroy;
    surface.destroy = () => {
      try { destroy(); }
      finally { if (attached.get(element) === surface) attached.delete(element); }
    };
    return surface;
  }
  const api={
    get domElement() { return owner.domElement ?? null; },
    attachText: (element, options = {}) => attach(attachTextSurface, element, options),
    attachImage: (element, options = {}) => attach(attachImageSurface, element, options),
    attachSVG: (element, options = {}) => attach(attachSVGSurface, element, options),
    stats: owner.stats,
    refresh: owner.refresh,
    destroy: owner.destroy
  };
  rendererOwners.set(api,owner);return api;
}





