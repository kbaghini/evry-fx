const running=new WeakMap(),hidden=new WeakMap();
// Transient use of the same surfaces; no second animation implementation.
export function animateDOMOnce(attach,element,{phase='enter',presentation='global',...options}={}){
  if(options.revealOnView)throw TypeError('revealOnView is an attachment option, not a transient animation option');
  if(!['enter','exit'].includes(phase))throw TypeError('Expected enter or exit');
  if(running.has(element))throw Error('An animation is already running on this element');
  const previous=hidden.get(element);
  const paint=element.tagName==='IMG'?'opacity':'-webkit-text-fill-color';
  const imageEntry=element.tagName==='IMG'&&phase==='enter';
  const nativeRestOpacity=imageEntry?Number(element.ownerDocument.defaultView.getComputedStyle(element).opacity):1;
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
  try{surface=attach(element.tagName==='IMG'?'attachImage':'attachText',element,{...options,presentation,resting:imageEntry?'native':'mesh',...(imageEntry?{nativeRestOpacity}:{}),initialPhase:phase});}catch(error){if(phase==='enter'){if(paintValue)element.style.setProperty(paint,paintValue,paintPriority);else element.style.removeProperty(paint);}if(previous){element.style.visibility='hidden';hidden.set(element,previous);}throw error;}
  running.set(element,surface);const view=element.ownerDocument.defaultView,started=view.performance.now();
  // Completion belongs to the effect clock, not to the first visible frame.
  // A hidden transient may finish without ever preparing a mesh or resolving
  // visual readiness; visibility only changes how often we inspect its clock.
  function poll(){
    if(done)return;
    const s=surface.stats();
    if(s.disposed||!element.isConnected){finish('cancelled');return;}
    if(!s.preparing&&s.mode==='native'&&s.reason&&!/initializing|not visible|not connected|native resting presentation|hidden after exit/i.test(s.reason)){finish('unsupported');return;}
    if(s.completed===true){finish('completed');return;}
    if(view.performance.now()-started>30000){finish('cancelled',Error('Animation preparation timed out'));return;}
    const remaining=s.timeline?.finishAt-view.performance.now();
    timer=setTimeout(poll,s.suspended?Math.min(1000,Math.max(100,remaining||1000)):16);
  }
  timer=setTimeout(poll,16);
  surface.ready.then(()=>{if(!done){clearTimeout(timer);poll();}},error=>finish('cancelled',error));
  return {finished,cancel:()=>finish('cancelled')};
}
