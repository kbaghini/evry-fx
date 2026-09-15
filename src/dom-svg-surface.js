import {revealOpacity} from './dom-reveal.js';
import {attachImageSurface} from './dom-image-surface.js';
function snapshot(element){
  if(element.querySelector('script,foreignObject,use,image,text,animate,animateTransform,animateMotion'))throw Error('Unsupported SVG content');
  const view=element.ownerDocument.defaultView,clone=element.cloneNode(true),nodes=[element,...element.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  for(let i=0;i<nodes.length;i++){
    const css=view.getComputedStyle(nodes[i]),copy=copies[i];
    if(css.filter!=='none'||css.clipPath!=='none'||css.maskImage!=='none'||css.transform!=='none'&&!nodes[i].hasAttribute('transform'))throw Error('Unsupported SVG geometry');
    copy.removeAttribute('class');copy.removeAttribute('style');
    for(const prop of ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','fill-rule','fill-opacity','stroke-opacity','opacity','color','paint-order','vector-effect','display']){const value=prop==='opacity'&&i===0&&revealOpacity.has(element)?revealOpacity.get(element):css.getPropertyValue(prop);if(/url\(/i.test(value))throw Error('SVG paint references unsupported');if(value)copy.style.setProperty(prop,value);}
  }
  clone.querySelectorAll('style').forEach(e=>e.remove());clone.setAttribute('xmlns','http://www.w3.org/2000/svg');const r=element.getBoundingClientRect();clone.setAttribute('width',r.width);clone.setAttribute('height',r.height);return new view.XMLSerializer().serializeToString(clone);
}
export function attachSVGSurface(element,THREE,options={}){
  if(element?.localName!=='svg'||!element.parentElement)throw TypeError('A mounted SVG is required');
  const document=element.ownerDocument,view=document.defaultView,parent=element.parentElement,oldVisibility=element.style.visibility;
  const image=document.createElement('img');image.alt='';image.setAttribute('aria-hidden','true');Object.assign(image.style,{position:'absolute',pointerEvents:'none',opacity:'0'});parent.append(image);
  let disposed=false,revision=0,timer=null,reason=null,xml='',surface,resolve;const ready=new Promise(r=>resolve=r);
  function restore(){if(element.style.visibility==='hidden')element.style.visibility=oldVisibility;}
  function present(state){
    if(disposed)return;
    // The image adapter exposes native pixels before its settled mesh finishes
    // fading. An explicit hidden:false must win over the remaining mesh mode.
    if(state.hidden??(state.mode==='mesh'||state.reason==='hidden after exit')){if(element.style.visibility!=='hidden')element.style.visibility='hidden';}else restore();
    reason=state.reason;
    if(state.mode==='mesh'||state.reason)resolve(state);
  }
  async function refresh(){if(disposed)return;const token=++revision;clearTimeout(timer);
    try{const next=snapshot(element),r=element.getBoundingClientRect(),p=parent.getBoundingClientRect();if(!(r.width>0&&r.height>0))throw Error('SVG not visible');
      Object.assign(image.style,{left:(r.left-p.left-parent.clientLeft+parent.scrollLeft)+'px',top:(r.top-p.top-parent.clientTop+parent.scrollTop)+'px',width:r.width+'px',height:r.height+'px'});
      if(next!==xml){xml=next;if(!surface)restore();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);}
      if(!surface)surface=attachImageSurface(image,THREE,{...options,onPresentation:present});
      await surface.refresh();if(disposed||token!==revision)return;
      const settle=()=>{if(disposed||token!==revision)return;const s=surface.stats();if(s.mode==='mesh'||s.reason)present(s);else timer=setTimeout(settle,16);};settle();
    }catch(error){xml='';surface?.destroy();surface=null;restore();reason=error.message;resolve({mode:'native',reason});}
  }
  const styleKey=()=>element.style.cssText.replace(/(?:^|;)\s*visibility\s*:[^;]*/g,'');let lastStyle=styleKey();
  const observer=new view.MutationObserver(records=>{const next=styleKey();if(records.some(r=>r.target!==element||r.attributeName!=='style')||next!==lastStyle){lastStyle=next;refresh();}});
  observer.observe(element,{subtree:true,attributes:true,childList:true,characterData:true});for(let a=parent;a;a=a.parentElement)observer.observe(a,{attributes:true,attributeFilter:['class','style']});
  const resize=new view.ResizeObserver(refresh);resize.observe(element);refresh();
  return {element,ready,refresh,cancel:()=>surface?.cancel(),play(phase='enter'){if(!['enter','exit'].includes(phase))throw TypeError('Expected enter or exit');if(phase==='enter'&&surface?.stats().image?.source)element.style.visibility='hidden';surface?.play(phase);},update(next){options={...options,...next};surface?.update(next);},stats:()=>({...surface?.stats(),disposed,reason:reason||surface?.stats().reason,mode:reason?'native':surface?.stats().mode||'native'}),destroy(){if(disposed)return;disposed=true;revision++;clearTimeout(timer);observer.disconnect();resize.disconnect();surface?.destroy();image.remove();restore();resolve({mode:'native',reason:'destroyed'});}};
}



