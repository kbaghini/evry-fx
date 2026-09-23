import {createImageSurface,IMAGE_EFFECT_MODES} from './image-surface.js';
import {normalizeTextEffectOptions} from './text-effect-options.js';
import {rasterizeDOMImage} from './dom-image-raster.js';
import {queueImagePreparation} from './image-preparation-queue.js';

// Native IMG retains source, alternative text and events. This adapter supplies
// only a presentation scene to the existing DOM owner and image effect engine.
export function attachImageSurface(element,THREE,options={}){
  if(element?.tagName!=='IMG'||!element.parentElement)throw TypeError('A mounted IMG is required');
  function validate(value){if(!['mesh','native'].includes(value.resting??'mesh'))throw TypeError('Invalid resting presentation');if(!IMAGE_EFFECT_MODES.includes(value.inputEffect??'dust-wind'))throw TypeError('Invalid image effect');normalizeTextEffectOptions(value.inputEffectOptions??{},value.inputEffect??'dust-wind');}validate(options);
  const document=element.ownerDocument,window=document.defaultView,parent=element.parentElement;
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true}),canvas=renderer.domElement;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;
  let originalOpacity=element.style.opacity,ownedOpacity=null;
  const nativeRestOpacity=options.nativeRestOpacity??(originalOpacity===''?1:Number(originalOpacity)),originalPosition=parent.style.position;
  function captureHostOpacity(){
    if(ownedOpacity===null||element.style.opacity!==ownedOpacity)originalOpacity=element.style.opacity;
  }
  function writeOpacity(value){captureHostOpacity();element.style.opacity=value;ownedOpacity=element.style.opacity;}
  function restoreOpacity(){
    captureHostOpacity();
    if(ownedOpacity!==null&&element.style.opacity===ownedOpacity)element.style.opacity=originalOpacity;
    ownedOpacity=null;
  }
  const ownsPosition=window.getComputedStyle(parent).position==='static';if(ownsPosition)parent.style.position='relative';
  Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',display:'none'});canvas.setAttribute('aria-hidden','true');parent.append(canvas);
  renderer.setSurface?.(parent);
  let pendingSurface=null,baseWidth=1,baseHeight=1;
  let requested=null,preparing=false,inFlight=false,prepareTimer=null,queueJob=null,committedURL='',resizeStarted=0,failed=false;
  let disposed=false,frame=null,surface=null,revision=0,source='',mode='native',reason=null,phase='enter',resolve;
  let effectStarted=null,queuedStarted=null,inViewport=true,exitHeld=false,nativeHidden=false;
  let queuedPhase=options.initialPhase??null;
  const ready=new Promise(r=>resolve=r),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function native(error,restore=false){
    if(restore)exitHeld=false;
    const hidden=!disposed&&!restore&&(exitHeld||surface?.stats().state==='hidden');
    nativeHidden=hidden;mode='native';reason=error||null;
    if(disposed)restoreOpacity();
    else{captureHostOpacity();writeOpacity(hidden?'0':(options.nativeRestOpacity!==undefined?String(nativeRestOpacity):originalOpacity));}
    canvas.style.display='none';options.onPresentation?.({mode,reason,hidden});renderer.invalidate?.();
  }
  function holdExit(){exitHeld=true;nativeHidden=true;writeOpacity('0');options.onPresentation?.({mode,reason,hidden:true});}
  function suspend(){
    if(queuedPhase!==null&&queuedStarted===null)queuedStarted=window.performance.now();
    if(queuedPhase==='exit'||queuedPhase===null&&phase==='exit'&&effectStarted!==null)holdExit();
    if(frame!==null)window.cancelAnimationFrame(frame);frame=null;canvas.style.display='none';renderer.invalidate?.();
  }
  function request(){if(!disposed&&inViewport&&!document.hidden&&frame===null)frame=window.requestAnimationFrame(draw);}
  const runtime={THREE,document,renderer,camera,requestRender:request,register(control){scene.add(control.object);return ()=>scene.remove(control.object);}};
  function draw(now){frame=null;if(disposed||!surface||failed||queuedPhase!==null&&preparing)return;if(!inViewport||document.hidden){suspend();return;}try{
    const box=element.getBoundingClientRect(),p=parent.getBoundingClientRect(),css=window.getComputedStyle(element);
    if(!box.width||!box.height||css.display==='none'||css.visibility!=='visible'){native('Image not visible');resolve({mode,reason});return;}
    if(css.transform!=='none'||css.objectPosition!=='50% 50%'||!['fill','contain','cover'].includes(css.objectFit)||parseFloat(css.paddingTop)||parseFloat(css.paddingLeft)||parseFloat(css.borderTopWidth)){native('Unsupported image layout',true);resolve({mode,reason});return;}
    const s=surface.stats();if(!s.source)return;
    const w=box.width,h=box.height;
    surface.object.scale.set(w/baseWidth,h/baseHeight,1);surface.setDisplaySize(w,h);
    camera.left=-box.width/2;camera.right=box.width/2;camera.top=box.height/2;camera.bottom=-box.height/2;camera.updateProjectionMatrix();
    Object.assign(canvas.style,{left:(box.left-p.left-parent.clientLeft+parent.scrollLeft)+'px',top:(box.top-p.top-parent.clientTop+parent.scrollTop)+'px',width:box.width+'px',height:box.height+'px',display:'block'});
        canvas.style.zIndex=css.zIndex;renderer.setSize(box.width,box.height,false);if(queuedPhase!==null&&!preparing){phase=queuedPhase;effectStarted=queuedStarted??now;queuedStarted=null;if(phase==='exit'&&surface.stats().state==='entering')surface.frame(effectStarted,reduced.matches);surface.setPresentationOpacity(1);surface[queuedPhase](effectStarted);queuedPhase=null;}surface.frame(now,reduced.matches);
    const state=surface.stats();
    const handoff=options.resting==='native'&&phase==='enter'&&effectStarted!==null&&!reduced.matches;
    const end=effectStarted===null?now:effectStarted+state.duration;
    // Reveal complete native pixels only once assembly finishes.
    const nativeAlpha=handoff&&now>=end?1:0;
    const meshFade=handoff?Math.max(0,Math.min(1,(now-end)/250)):0;
    surface.setPresentationOpacity(1-meshFade);
    if(!state.active&&(options.resting==='native'||reduced.matches)&&(!handoff||meshFade>=1)){
      // Submit before handing off: reveal gates acknowledge even reduced motion.
      renderer.render(scene,camera);
      native(state.state==='hidden'?'hidden after exit':'native resting presentation');
      if(state.state==='hidden')writeOpacity('0');
      resolve({mode,reason});return;
    }
    const handingOffNative=mode==='native';
    writeOpacity(String(nativeAlpha*nativeRestOpacity));nativeHidden=nativeAlpha===0;mode='mesh';reason=null;renderer.render(scene,camera);
    options.onPresentation?.({mode,reason,hidden:nativeHidden});
    if(handingOffNative)renderer.flushPresentation?.();
    resolve({mode,reason});if(handoff&&meshFade<1)request();
  }catch(error){native(error.message,true);resolve({mode,reason});}}
  function nearViewport(box){const margin=window.innerHeight*.5;return box.bottom>=-margin&&box.top<=window.innerHeight+margin&&box.right>=0&&box.left<=window.innerWidth;}
  function measure(){const url=element.currentSrc||element.src,css=window.getComputedStyle(element),box=element.getBoundingClientRect();return {url,css,box,key:JSON.stringify([url,box.width,box.height,css.objectFit,css.objectPosition,css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomLeftRadius,css.borderBottomRightRadius])};}
  function schedule(delay=0){clearTimeout(prepareTimer);if(disposed||inFlight||!requested)return;preparing=true;prepareTimer=setTimeout(prepare,delay);}
  async function prepare(){
    prepareTimer=null;if(disposed||inFlight||!requested)return;
    inFlight=true;preparing=true;const token=revision,current=requested;
    try{
      if(!element.complete||!element.naturalWidth)await element.decode();
      if(disposed||token!==revision)return;
      queueJob=queueImagePreparation(window,async()=>{
        if(disposed||token!==revision)return false;
        // Resize/decode may have changed the measured box without an observer
        // callback yet. Do not allocate pixels for the stale dimensions.
        const measured=measure();if(measured.key!==current.key){refresh();return false;}
        const raster=await rasterizeDOMImage(element,{maxSide:Math.min(2048,renderer.capabilities?.maxTextureSize||2048)});
        if(disposed||token!==revision)return false;
        const next=surface??createImageSurface(runtime,{width:raster.width,height:raster.height,effect:options.inputEffect??'dust-wind',settings:options.inputEffectOptions??{}});
        if(!surface)pendingSurface=next;
        next.setDisplaySize(current.box.width,current.box.height);
        // DOM source/paint changes replace pixels, not the caller's animation
        // intent. Keep a departure hidden and preserve an active clock/seed
        // across src, srcset and SVG snapshot replacements just as on resize.
        await next.setSource(raster.source,{preserveMotion:!!surface,bounds:{width:raster.width,height:raster.height}});
        if(disposed||token!==revision){if(next!==surface)next.destroy();return false;}
        surface=next;pendingSurface=null;baseWidth=raster.width;baseHeight=raster.height;source=current.key;committedURL=current.url;requested=null;resizeStarted=0;return true;
      });
      await queueJob.promise;
    }catch(error){pendingSurface?.destroy();pendingSurface=null;if(!disposed&&token===revision){requested=null;source='';resizeStarted=0;failed=true;native(error.message,true);resolve({mode,reason});}}
    finally{queueJob=null;inFlight=false;preparing=false;if(!disposed){if(requested)schedule(surface?50:0);request();}}
  }
  function refresh(){
    if(disposed)return;const current=measure(),{box,css}=current;
    if(!element.isConnected||!box.width||!box.height||css.display==='none'||css.visibility!=='visible'||!nearViewport(box)){
      if(requested){revision++;requested=null;queueJob?.cancel();}clearTimeout(prepareTimer);prepareTimer=null;preparing=inFlight;
      if(!surface||!box.width||!box.height||css.display==='none'||css.visibility!=='visible'){native('Image not visible');resolve({mode,reason});}return;
    }
    if(current.key===source){if(requested){revision++;requested=null;queueJob?.cancel();clearTimeout(prepareTimer);prepareTimer=null;preparing=inFlight;}if(surface)request();return;}
    if(current.key===requested?.key)return;
    requested=current;revision++;failed=false;queueJob?.cancel();
    // Keep the current texture/motion during a resize burst. Rebuild the latest
    // size after 50ms of quiet, with a 150ms bound for continuous transitions.
    const resizing=surface&&committedURL===current.url;
    if(resizing&&!resizeStarted)resizeStarted=performance.now();
    schedule(resizing?Math.max(0,Math.min(50,150-(performance.now()-resizeStarted))):0);
  }
  const resize=new window.ResizeObserver(refresh);resize.observe(element);
  const styleKey=()=>element.style.cssText.replace(/(?:^|;)\s*opacity\s*:[^;]*/g,'');let lastStyle=styleKey();
  const observer=new window.MutationObserver(records=>{const next=styleKey();if(records.some(r=>r.attributeName!=='style')||next!==lastStyle){lastStyle=next;refresh();}});observer.observe(element,{attributes:true,attributeFilter:['src','srcset','sizes','class','style']});
  const proximity=window.IntersectionObserver?new window.IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))refresh();},{rootMargin:`${window.innerHeight*.5}px 0px`}):null;proximity?.observe(element);
  const visibility=new window.IntersectionObserver(entries=>{
    inViewport=entries.at(-1)?.isIntersecting!==false;
    if(inViewport){refresh();request();}
    else suspend();
  });visibility.observe(element);
  const onVisibility=()=>{if(document.hidden)suspend();else{refresh();request();}};
  document.addEventListener('visibilitychange',onVisibility);
  const onScroll=()=>{if(mode==='mesh')request();if(!proximity&&!surface)refresh();};
  reduced.addEventListener('change',request);element.addEventListener('load',refresh);window.addEventListener('resize',refresh);window.addEventListener('scroll',onScroll,true);
  if(queuedPhase!==null){const box=element.getBoundingClientRect();if(document.hidden||box.bottom<=0||box.top>=window.innerHeight||box.right<=0||box.left>=window.innerWidth){inViewport=false;suspend();}}
  refresh();
  return {element,ready,refresh,cancel(){if(disposed)return;phase='enter';effectStarted=null;queuedPhase=null;queuedStarted=null;exitHeld=false;surface?.setPresentationOpacity(1);surface?.show();native();request();},play(value='enter'){
      if(disposed)throw Error('Surface disposed');
      if(!['enter','exit'].includes(value))throw TypeError('Expected enter or exit');
      phase=value;queuedPhase=value;exitHeld=false;
      const box=element.getBoundingClientRect(),outside=box.bottom<=0||box.top>=window.innerHeight||box.right<=0||box.left>=window.innerWidth;
      queuedStarted=document.hidden||!inViewport||outside?window.performance.now():null;
      if(outside)inViewport=false;
      if(document.hidden||!inViewport)suspend();
      request();
    },
    update(next={}){const candidate={...options,...next};validate(candidate);options=candidate;surface?.setEffect(options.inputEffect??'dust-wind',options.inputEffectOptions??{});request();},
    stats:()=>{
      const image=surface?.stats(),started=queuedPhase!==null?queuedStarted:effectStarted,currentPhase=queuedPhase??phase;
      const duration=image?.duration??options.inputEffectOptions?.duration??2000;
      const finishAt=started===null?null:started+(reduced.matches?0:duration+(currentPhase==='enter'&&options.resting==='native'?250:0));
      const suspended=document.hidden||!inViewport;
      const unsupported=failed||reason==='Unsupported image layout';
      const completed=!unsupported&&started!==null&&(suspended?window.performance.now()>=finishAt:
        queuedPhase===null&&(currentPhase==='exit'?image?.state==='hidden':options.resting==='native'?mode==='native'&&reason==='native resting presentation':image?.state==='visible'&&!image.active));
      return {disposed,mode,reason,phase:currentPhase,preparing,suspended,completed,hidden:exitHeld||nativeHidden,timeline:{phase:currentPhase,started,ends:started===null?null:started+duration,finishAt},handoff:mode==='mesh'&&options.resting==='native'&&phase==='enter'&&effectStarted!==null,image};
    },
    destroy(){if(disposed)return;disposed=true;revision++;requested=null;clearTimeout(prepareTimer);queueJob?.cancel();if(frame!==null)window.cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();proximity?.disconnect();visibility.disconnect();document.removeEventListener('visibilitychange',onVisibility);reduced.removeEventListener('change',request);element.removeEventListener('load',refresh);window.removeEventListener('resize',refresh);window.removeEventListener('scroll',onScroll,true);surface?.destroy();pendingSurface?.destroy();native();renderer.dispose();renderer.forceContextLoss();canvas.remove();if(ownsPosition&&parent.style.position==='relative')parent.style.position=originalPosition;resolve({mode:'native',reason:'destroyed'});}
  };
}






