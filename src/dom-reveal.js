// Presentation-only masking: SVG snapshots retain their original paint opacity.
export const revealOpacity=new WeakMap();
let sequence=0;
export function withRevealOnView(factory,element,THREE,options){
  // Transfer the boot mask in this same task, before paint and opacity capture.
  element.removeAttribute('data-thd-pending');
  const {revealOnView:config,...settings}=options;
  if(config===undefined||config===false)return factory(element,THREE,settings);
  if(!config||typeof config!=='object'||Array.isArray(config))throw TypeError('revealOnView requires an options object');
  const {threshold=0,once=true,root=null}=config,document=element.ownerDocument,window=document.defaultView;
  if(Object.keys(config).some(k=>!['threshold','once','root'].includes(k))||!Number.isFinite(threshold)||threshold<0||threshold>1||typeof once!=='boolean'||root!==null&&(root.ownerDocument!==document||root.nodeType!==1))throw TypeError('Invalid revealOnView options');
  if(!window.IntersectionObserver)throw Error('IntersectionObserver unavailable');
  const attribute='data-thd-reveal',previous=element.getAttribute(attribute),id=String(++sequence);
  const style=document.createElement('style');style.textContent=`[${attribute}="${id}"]{opacity:0!important}`;
  const originalOpacity=window.getComputedStyle(element).opacity;revealOpacity.set(element,originalOpacity);
  element.setAttribute(attribute,id);document.head.append(style);
  let held=true,disposed=false,ready=false,eligible=false,armed=true,count=0,fallback=false;let retry=null,attempts=0;
  const empty=new THREE.Scene(),renderers=new Set();let revealPending=false;
  const namespace={...THREE,WebGLRenderer:class extends THREE.WebGLRenderer{
    constructor(...args){super(...args);renderers.add(this);}
    render(scene,camera){this.revealCamera=camera;if(revealPending&&eligible){revealPending=false;count++;unmask();if(once)observer?.disconnect();}super.render(held?empty:scene,camera);
      // Readiness is not permanently determined by an empty/unsupported first
      // layout. A later successful render can complete the pending first entry.
      if((count===0||fallback)&&armed&&eligible&&(!once||count===0))queueMicrotask(()=>{if(disposed||!armed||!eligible||once&&count!==0)return;fallback=false;ready=true;if(!held)mask();trigger();});
    }
    clearReveal(){if(this.revealCamera)super.render(empty,this.revealCamera);}
  }};
  let surface,observer,sizeObserver;
  function mask(){clearTimeout(retry);retry=null;held=true;revealPending=false;revealOpacity.set(element,originalOpacity);if(!style.isConnected)document.head.append(style);for(const renderer of renderers)renderer.clearReveal();}
  function unmask(){clearTimeout(retry);retry=null;held=false;style.remove();revealOpacity.delete(element);}
  function isFallback(state){return state.mode!=='mesh'&&!state.preparing&&!!state.reason&&!/native resting presentation|not visible|not connected|hidden after exit/i.test(state.reason);}
  function showFallback(){fallback=true;revealPending=false;armed=true;unmask();}
  function cleanup(){disposed=true;observer?.disconnect();sizeObserver?.disconnect();unmask();if(previous===null)element.removeAttribute(attribute);else element.setAttribute(attribute,previous);}
  // Only supervise an eligible reveal until its first rendered frame.
  // A cancelled preparation/visibility frame must not consume the request.
  function ensureFrame(){
    clearTimeout(retry);retry=null;
    if(disposed||!eligible||!held)return;
    if(isFallback(surface.stats())){showFallback();return;}
    if(++attempts>100){surface.destroy();return;}
    if(!surface.stats().preparing){surface.refresh();if(revealPending)requestEntry();}
    retry=setTimeout(ensureFrame,100);
  }
  function requestEntry(){
    const state=surface.stats(),timeline=state.timeline;
    const running=timeline?timeline.phase==='enter'&&timeline.ends>window.performance.now():state.image?.state==='entering'&&state.image?.active;
    // Re-entering view resumes an unfinished entry; do not reset its clock.
    if(running)surface.refresh();else surface.play('enter');
  }
  function trigger(){
    if(disposed||!ready||!eligible||!armed)return;
    if(isFallback(surface.stats())){showFallback();return;}
    armed=false;revealPending=true;requestEntry();attempts=0;clearTimeout(retry);retry=setTimeout(ensureFrame,100);
  }
  try{
    surface=factory(element,namespace,settings);
    observer=new window.IntersectionObserver(entries=>{
      for(const entry of entries){
        const visible=entry.isIntersecting&&entry.intersectionRect.width>0&&entry.intersectionRect.height>0;
        if(!visible){eligible=false;clearTimeout(retry);retry=null;if(!once||count===0){armed=true;mask();}continue;}
        eligible=entry.intersectionRatio>=threshold;if(eligible&&armed){surface.refresh();attempts=0;clearTimeout(retry);retry=setTimeout(ensureFrame,100);}trigger();
      }
    },{root,threshold:[...new Set([0,threshold===0?0.000001:threshold])]});observer.observe(element);
    // A zero-area intersection may already have ratio 1. Growing to a real
    // box need not cross an IO threshold, so request a fresh observation once.
    let hadArea=element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0;
    sizeObserver=new window.ResizeObserver(()=>{const box=element.getBoundingClientRect(),hasArea=box.width>0&&box.height>0;if(hasArea&&!hadArea&&(!once||count===0)){observer.unobserve(element);observer.observe(element);}hadArea=hasArea;});sizeObserver.observe(element);
  }catch(error){cleanup();surface?.destroy();throw error;}
  const destroy=surface.destroy,stats=surface.stats;
  surface.stats=()=>({...stats(),reveal:{waiting:held,count,threshold,once}});
  surface.destroy=()=>{if(disposed)return;cleanup();destroy();};
  surface.ready.then(()=>{if(disposed)return;ready=true;const state=surface.stats();if(isFallback(state)){showFallback();return;}if(eligible)surface.refresh();trigger();},()=>{if(!disposed){unmask();observer.disconnect();}});
  return surface;
}

