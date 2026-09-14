import {createFree,FREE_EFFECTS} from './dom-free.js';

// Shared initialization for the classic loader and explicit module loader.
// Importing this module does not attach content or access a browser document.
const dependencies=new WeakMap();
export async function bootstrapFree({document=globalThis.document,THREE,auto=false}={}){
  const window=document?.defaultView;
  if(!window)throw TypeError('THD Free needs a browser document');
  if(typeof auto!=='boolean')throw TypeError('THD Free auto must be a boolean');
  let three=THREE??window.THREE;
  if(!three){
    let loading=dependencies.get(document);
    if(!loading){
      loading=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src=new URL('../assets/vendor/three.min.js',import.meta.url).href;
        script.onload=()=>{script.onload=script.onerror=null;resolve(window.THREE);};
        script.onerror=()=>{script.remove();reject(Error('THD: Three.js failed to load'));};
        document.head.append(script);
      });
      dependencies.set(document,loading);
      loading.catch(()=>{if(dependencies.get(document)===loading)dependencies.delete(document);});
    }
    three=await loading;
  }
  const api={create:(root=document,options={})=>createFree(three,root,options),effects:FREE_EFFECTS};
  if(auto){
    if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    const instance=api.instance=api.create();
    const stop=()=>{window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
    const leave=event=>{if(!event.persisted){stop();instance.destroy();}};
    const restore=event=>{
      if(instance.stats().disposed){stop();return;}
      if(event.persisted)instance.refresh();
    };
    // BFCache suspends the page. Keep the same owner/once state for return;
    // dispose only when the page is actually discarded.
    window.addEventListener('pagehide',leave);
    window.addEventListener('pageshow',restore);
  }
  return Object.freeze(api);
}
