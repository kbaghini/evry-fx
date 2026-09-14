const running=new WeakMap(),hidden=new WeakMap();
// Transient use of the same surfaces; no second animation implementation.
export function animateDOMOnce(attach,element,{phase='enter',presentation='global',...options}={}){
  if(options.revealOnView)throw TypeError('revealOnView is an attachment option, not a transient animation option');
  if(!['enter','exit'].includes(phase))throw TypeError('Expected enter or exit');
  if(running.has(element))throw Error('An animation is already running on this element');
  const previous=hidden.get(element);
  const paint=element.tagName==='IMG'?'opacity':'-webkit-text-fill-color';
  const paintValue=element.style.getPropertyValue(paint),paintPriority=element.style.getPropertyPriority(paint);
  if(phase==='enter')element.style.setProperty(paint,element.tagName==='IMG'?'0':'transparent');
  if(previous&&element.style.visibility==='hidden'){element.style.setProperty('visibility',previous.value,previous.priority);hidden.delete(element);}
  let surface,done=false,timer;let resolve,reject;
  const finished=new Promise((a,b)=>{resolve=a;reject=b;});
  function finish(status,error){if(done)return;done=true;clearTimeout(timer);running.delete(element);surface?.destroy();
    if(phase==='enter'){if(paintValue)element.style.setProperty(paint,paintValue,paintPriority);else element.style.removeProperty(paint);}
    if(status==='completed'&&phase==='exit'){hidden.set(element,{value:element.style.getPropertyValue('visibility'),priority:element.style.getPropertyPriority('visibility')});element.style.visibility='hidden';}
    if(error)reject(error);else resolve({status,phase});
  }
  try{surface=attach(element.tagName==='IMG'?'attachImage':'attachText',element,{...options,presentation,resting:'mesh',initialPhase:phase});}catch(error){if(phase==='enter'){if(paintValue)element.style.setProperty(paint,paintValue,paintPriority);else element.style.removeProperty(paint);}if(previous){element.style.visibility='hidden';hidden.set(element,previous);}throw error;}
  running.set(element,surface);const started=performance.now();
  timer=setTimeout(()=>finish('cancelled',Error('Animation preparation timed out')),30000);
  surface.ready.then(()=>{if(done)return;clearTimeout(timer);if(surface.stats().mode!=='mesh'){finish('unsupported');return;}
    // Wait for the scheduled render before testing the shared effect's state.
    let observed=false;
    function poll(){if(done)return;const s=surface.stats();if(s.disposed){finish('cancelled');return;}
      const active=!!(s.image?.active||s.rich?.active||s.effect?.active||s.pending);
      if(active)observed=true;
      if(!element.isConnected){finish('cancelled');return;}
      if(!active&&(observed||performance.now()-started>150)){finish(s.mode==='mesh'?'completed':'unsupported');return;}
      if(performance.now()-started>30000){finish('cancelled');return;}timer=setTimeout(poll,16);
    }timer=setTimeout(poll,32);
  }).catch(error=>finish('cancelled',error));
  return {finished,cancel:()=>finish('cancelled')};
}
