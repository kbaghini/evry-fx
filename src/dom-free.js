import {createDOMInstallation} from './dom-attachment.js';
import {createAutoReveal} from './dom-auto-reveal.js';

export const FREE_EFFECTS = Object.freeze({textEnter:'dust-wind', textExit:'smoke', imageEnter:'drifting-snow', imageExit:'melt'});
export function createFree(THREE, root = document, options = {}) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const owner = createDOMInstallation(THREE, doc, {presentation: options.presentation ?? 'auto',zIndex:options.zIndex??1,documentCanvas:options.documentCanvas??options.experimentalDocumentCanvas??true});
  let automatic, disposed=false;
  function attach(kind, element, config = {}) {
    if(disposed)throw Error('Free installation disposed');
    for(const key of Object.keys(config))if(!['revealOnView','presentation'].includes(key))throw TypeError(`Unsupported Free option: ${key}`);
    const effectKind=kind==='svg'?'image':kind;
    const surface=owner[kind==='text'?'attachText':kind==='svg'?'attachSVG':'attachImage'](element,{
      ...config,resting:'native',inputEffect:FREE_EFFECTS[effectKind+'Enter'],
      inputEffectOptions:{duration:2000,particleShape:'triangle',exitEffect:FREE_EFFECTS[effectKind+'Exit']}
    });
    return Object.freeze({ready:surface.ready,play:(phase='enter')=>{
      if(!['enter','exit'].includes(phase))throw TypeError('Invalid phase');
      surface.play(phase);
    },cancel:()=>surface.cancel(),refresh:()=>surface.refresh(),stats:()=>surface.stats(),destroy:()=>surface.destroy()});
  }
  // Automatic and manual surfaces lease the same installation.
  const autoOwner={attachText:(el,c)=>attach('text',el,{revealOnView:c.revealOnView}),attachImage:(el,c)=>attach('image',el,{revealOnView:c.revealOnView}),stats:()=>owner.stats()};
  try { if(options.auto!==false)automatic=createAutoReveal(THREE,root,options,autoOwner); }
  catch(error){owner.destroy();throw error;}
  return Object.freeze({attachText:(el,c)=>attach('text',el,c),attachImage:(el,c)=>attach('image',el,c),attachSVG:(el,c)=>attach('svg',el,c),
    swapImage(previous,next,config={}){
      if(disposed)throw Error('Free installation disposed');
      for(const key of Object.keys(config))if(!['exit','waitForExit','presentation'].includes(key))throw TypeError(`Unsupported Free swap option: ${key}`);
      for(const key of ['exit','waitForExit'])if(config[key]!==undefined&&typeof config[key]!=='boolean')throw TypeError(`Invalid ${key}`);
      return owner.swapImage(previous,next,{presentation:config.presentation??'global',waitForExit:config.waitForExit??false,
        exitEffect:config.exit===false?null:FREE_EFFECTS.imageExit,inputEffect:FREE_EFFECTS.imageEnter,
        inputEffectOptions:{duration:2000,particleShape:'triangle'}});
    },
    refresh(){if(disposed)throw Error('Free installation disposed');automatic?.refresh();owner.refresh();},
    stats:()=>({disposed,automatic:automatic?.stats()??null,renderer:owner.stats()}),
    destroy(){if(disposed)return;disposed=true;try{automatic?.destroy();}finally{owner.destroy();}}
  });
}



