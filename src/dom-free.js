/** EV-RY FX Free (MIT) — https://ev-ry.com/fx/ */
import {createDOMInstallation} from './dom-attachment.js';
import {createAutoReveal} from './dom-auto-reveal.js';

export const FREE_EFFECTS = Object.freeze({textEnter:'dust-wind', textExit:'smoke', imageEnter:'drifting-snow', imageExit:'melt'});
export function createFree(THREE, root = document, options = {}) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const owner = createDOMInstallation(THREE, doc, {presentation: options.presentation ?? 'auto',zIndex:options.zIndex??1,documentCanvas:options.documentCanvas??options.experimentalDocumentCanvas??true});
  let automatic, disposed=false;const installationWaits=new Set();
  function attach(kind, element, config = {}) {
    if(disposed)throw Error('Free installation disposed');
    for(const key of Object.keys(config))if(!['revealOnView','presentation'].includes(key))throw TypeError(`Unsupported Free option: ${key}`);
    const effectKind=kind==='svg'?'image':kind;
    const surface=owner[kind==='text'?'attachText':kind==='svg'?'attachSVG':'attachImage'](element,{
      ...config,resting:'native',inputEffect:FREE_EFFECTS[effectKind+'Enter'],
      inputEffectOptions:{duration:2000,particleShape:'triangle',exitEffect:FREE_EFFECTS[effectKind+'Exit']}
    });
    let currentWait=null,requestedPlay=false;
    const whenFinished=()=>{
      if(currentWait)return currentWait.promise;
      const wait={};currentWait=wait;
      wait.promise=new Promise(resolve=>{
      let timeoutStarted=null,timer,done=false;
      const finish=status=>{if(done)return;done=true;clearTimeout(timer);installationWaits.delete(wait.cancel);if(currentWait===wait)currentWait=null;resolve({status});};
      wait.cancel=()=>finish('cancelled');installationWaits.add(wait.cancel);
      const poll=()=>{const s=surface.stats();
        if(s.disposed||disposed||!element.isConnected){finish('cancelled');return;}
        if(!s.preparing&&s.mode==='native'&&s.reason&&!/initializing|not visible|not connected|native resting presentation|hidden after exit/i.test(s.reason)){finish('unsupported');return;}
        const completed=typeof s.completed==='boolean'?s.completed:s.mode==='native'&&['native resting presentation','hidden after exit'].includes(s.reason);
        if((!s.reveal||s.reveal.count>0||s.reveal.manual)&&completed){finish('completed');return;}
        // An untouched intersection reveal may legitimately wait minutes.
        // Bound actual preparation/play, not the time before first visibility.
        if(requestedPlay||s.timeline?.started!=null||s.preparing&&!s.suspended)timeoutStarted??=Date.now();
        if(timeoutStarted!==null&&Date.now()-timeoutStarted>30000){finish('cancelled');return;}
        const remaining=s.timeline?.finishAt-doc.defaultView.performance.now();
        timer=setTimeout(poll,s.suspended?Math.min(1000,Math.max(100,remaining||1000)):16);
      };timer=setTimeout(poll,16);
      });return wait.promise;
    };
    return Object.freeze({whenFinished,ready:surface.ready,play:(phase='enter')=>{
      if(!['enter','exit'].includes(phase))throw TypeError('Invalid phase');
      surface.play(phase);requestedPlay=true;currentWait?.cancel();
    },cancel:()=>{surface.cancel();requestedPlay=false;currentWait?.cancel();},refresh:()=>surface.refresh(),stats:()=>surface.stats(),destroy:()=>{currentWait?.cancel();surface.destroy();}});
  }
  // Automatic and manual surfaces lease the same installation.
  const autoOwner={attachText:(el,c)=>attach('text',el,{revealOnView:c.revealOnView}),attachImage:(el,c)=>attach('image',el,{revealOnView:c.revealOnView}),stats:()=>owner.stats()};
  try { if(options.auto!==false)automatic=createAutoReveal(THREE,root,options,autoOwner); }
  catch(error){owner.destroy();throw error;}
  return Object.freeze({attachText:(el,c)=>attach('text',el,c),attachImage:(el,c)=>attach('image',el,c),attachSVG:(el,c)=>attach('svg',el,c),
    swapImage(previous,next,config={}){
      if(disposed)throw Error('Free installation disposed');
      for(const key of Object.keys(config))if(!['exit','enter','topImage','waitForExit','presentation'].includes(key))throw TypeError(`Unsupported Free swap option: ${key}`);
      for(const key of ['exit','enter','waitForExit'])if(config[key]!==undefined&&typeof config[key]!=='boolean')throw TypeError(`Invalid ${key}`);
      if(config.topImage!==undefined&&!['previous','next'].includes(config.topImage))throw TypeError('Invalid topImage');
      return owner.swapImage(previous,next,{enterEffect:config.enter!==false,topImage:config.topImage??'next',presentation:config.presentation??'global',waitForExit:config.waitForExit??false,
        exitEffect:config.exit===false?null:FREE_EFFECTS.imageExit,inputEffect:FREE_EFFECTS.imageEnter,
        inputEffectOptions:{duration:2000,particleShape:'triangle'}});
    },
    refresh(){if(disposed)throw Error('Free installation disposed');automatic?.refresh();owner.refresh();},
    stats:()=>({disposed,automatic:automatic?.stats()??null,renderer:owner.stats()}),
    destroy(){if(disposed)return;disposed=true;for(const cancel of [...installationWaits])cancel();try{automatic?.destroy();}finally{owner.destroy();}}
  });
}



