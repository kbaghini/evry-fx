import {HybridTextFlowEngine} from './hybrid-text-flow.js';
import {SharedTextScene} from './text-scene.js';
import {TextEditEffect} from './text-edit-effect.js';
import {createLifecycle} from './runtime-lifecycle.js';
import {documentDirection} from './text-direction.js';
import {textEditMotions} from './text-edit-motions.js';
import {normalizeTextEffectOptions} from './text-effect-options.js';
import {adoptDOMFont,domFontAtSize,matchesDOMFont} from './dom-surface-font.js';
import {DOMRichText} from './dom-rich-text.js';
import {createDOMTextFingerprint} from './dom-text-fingerprint.js';

// Presentation attachment: the original text node, parent control and semantics
// remain owned by the host. The deliberately narrow first contract is a plain,
// single-line text slot. Unsupported layout always retains its native paint.
export function attachTextSurface(element,THREE,options={}){
  if(!element?.ownerDocument?.defaultView)throw TypeError('A DOM text slot is required');
  const document=element.ownerDocument,window=document.defaultView,life=createLifecycle();
  let effectName=options.inputEffect??'dust-wind';
  let resting=options.resting??'mesh';
  const validResting=value=>{if(!['mesh','native'].includes(value))throw TypeError('Expected mesh or native resting mode');};validResting(resting);
  const validMode=mode=>mode==='none'||!!textEditMotions[mode];
  if(!validMode(effectName))throw TypeError('Invalid inputEffect');
  let settings=normalizeTextEffectOptions({formation:-1,...options.inputEffectOptions},effectName==='none'?'dust-wind':effectName);
  let enabled=options.enabled!==false,renderer,canvas,engine,view,effect,scene,content,camera;
  let frame=null,revision=0,preparing=false,dirty=true,layout=null,committed=null,reason=null,fatal=false,intersecting=true;
  let mode='native',draws=0,builds=0,submittedSize='',pendingPhase=options.initialPhase??null,phase='enter',lastSeed=null;
  let effectStarted=null,pendingStarted=null;
  function preserveMotion(){if(pendingPhase===null&&effectStarted!==null&&window.performance.now()-effectStarted<settings.duration){pendingPhase=phase;pendingStarted=effectStarted;}}
  let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
  let rich=null;
  let fingerprint=null,preparedFingerprint=null,fontRevision=0;
  const needsCharacters=()=>settings.bounceLines||[effectName,settings.exitEffect==='same'?effectName:settings.exitEffect].some(name=>textEditMotions[name]?.characterCenters||textEditMotions[name]?.characterFrame);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),forced=window.matchMedia('(forced-colors: active)');
  const originalStyle=new Map(),ownedStyle=new Map();
  function ownStyle(name,value){
    if(!originalStyle.has(name))originalStyle.set(name,[element.style.getPropertyValue(name),element.style.getPropertyPriority(name)]);
    if(element.style.getPropertyValue(name)!==value)element.style.setProperty(name,value);
    ownedStyle.set(name,value);
  }
  function restoreStyle(name){
    if(!ownedStyle.has(name))return;
    if(element.style.getPropertyValue(name)===ownedStyle.get(name)){
      const [value,priority]=originalStyle.get(name);if(value)element.style.setProperty(name,value,priority);else element.style.removeProperty(name);
    }
    ownedStyle.delete(name);originalStyle.delete(name);
  }
  function native(why=null){
    rich?.restore();
    mode='native';reason=why;restoreStyle('-webkit-text-fill-color');restoreStyle('text-shadow');
    if(canvas)canvas.style.display='none';
    renderer?.invalidate?.();
  }
  function fail(error){
    if(life.disposed)return;fatal=true;effect?.cancel();rich?.cancel();native(String(error?.message||error));
    if(frame!==null){window.cancelAnimationFrame(frame);frame=null;}
    resolveReady({mode,reason});
  }
  function request(){if(!life.disposed&&!fatal&&!document.hidden&&intersecting&&frame===null)frame=window.requestAnimationFrame(render);}
  function suspend(){if(frame!==null)window.cancelAnimationFrame(frame);frame=null;if(renderer?.globalCanvas)native('not visible');renderer?.invalidate?.();}
  function refresh(){
    if(life.disposed)return;revision++;dirty=true;request();
  }
  function slot(){
    const children=[...element.childNodes].filter(node=>node!==canvas&&node.nodeType!==8);
    if(children.some(node=>node.nodeType!==3)||children.length>1)return null;
    return {node:children[0]??null,text:children[0]?.data??''};
  }
  function measure(current,collectCharacters){
    const style=window.getComputedStyle(element),size=parseFloat(style.fontSize),box=element.getBoundingClientRect();
    const width=element.clientWidth||box.width,height=element.clientHeight||box.height;
    if(!element.isConnected||!(width>0&&height>0))return {reason:'Text slot is not visible'};
    if(!matchesDOMFont(engine,style)||!(size>0)||style.fontStyle!=='normal'||style.textTransform!=='none'||style.writingMode!=='horizontal-tb'
      ||!['normal','0px'].includes(style.letterSpacing)||!['normal','0px'].includes(style.wordSpacing)||style.textDecorationLine!=='none'
      ||/[\n\r\t]/.test(current.text))return {reason:'Unsupported text typography; native text retained'};
    for(const pseudo of ['::before','::after']){
      const p=window.getComputedStyle(element,pseudo);if(p.display!=='none'&&!['none','normal','""',"''"].includes(p.content))return {reason:'Generated text content is not supported'};
    }
    const factor=size/200,context=engine.rasterizer.context;context.font=domFontAtSize(engine,size);
    const metrics=context.measureText('Hgآی'),expected=context.measureText(current.text).width;engine.rasterizer.configure();
    if(!Number.isFinite(metrics.fontBoundingBoxAscent))return {reason:'Native font metrics are unavailable'};
    const direction=element.dir==='auto'?documentDirection(current.text,style.direction):style.direction;
    const rows=[],characters=[];
    if(current.node&&current.text){
      const range=document.createRange();range.selectNodeContents(current.node);
      const rects=[...range.getClientRects()].filter(rect=>rect.height>0),rect=range.getBoundingClientRect();
      if(!rects.length)return {reason:'Text has no measurable layout'};
      if(rects.some(r=>Math.abs(r.top-rects[0].top)>.75)||Math.abs(rect.width-expected)>Math.max(1,expected*.015))return {reason:'Wrapped or transformed text uses native rendering'};
      const top=rect.top-box.top-element.clientTop,left=rect.left-box.left-element.clientLeft;
      const baseline=top+(rect.height+metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2;
      rows.push({start:0,end:current.text.length,text:current.text,top,left,right:left+rect.width,baseline,direction});
      if(collectCharacters)for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(current.text)){
        range.setStart(current.node,part.index);range.setEnd(current.node,part.index+part.segment.length);
        const r=range.getBoundingClientRect();
        if(r.width>0)characters.push({x:(r.left-box.left-element.clientLeft)/factor*engine.scale,
          y:-(baseline+metrics.fontBoundingBoxDescent)/factor*engine.scale,
          width:r.width/factor*engine.scale,height:(metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent)/factor*engine.scale,direction});
      }
    }
    return {rows,characters,factor,width,height,size,direction,color:style.color,text:current.text,
      key:JSON.stringify([current.text,engine.domFont?.key??engine.face.family,size,width,height,rows.map(r=>[r.left,r.baseline,r.direction])])};
  }
  async function prepare(){
    if(preparing||life.disposed||fatal)return;
    let stamp,surfaceIssue;
    const collectCharacters=!!needsCharacters();
    try{
      surfaceIssue=renderer.getSurfaceIssue?.();
      stamp=JSON.stringify([fontRevision,collectCharacters,fingerprint()]);
      if(!surfaceIssue&&enabled&&!forced.matches&&layout&&stamp===preparedFingerprint){dirty=false;reason=null;request();return;}
    }catch(error){fail(error);return;}
    dirty=false;preparing=true;const version=revision;
    preparedFingerprint=null;
    try{
      if(surfaceIssue){effect.cancel();rich?.cancel();native(surfaceIssue);resolveReady({mode,reason});return;}
      const current=slot();
      const typography=window.getComputedStyle(element);
      let wrapped=false;
      if(current?.node){const range=document.createRange();range.selectNodeContents(current.node);const rects=[...range.getClientRects()].filter(r=>r.height>0);wrapped=rects.some(r=>Math.abs(r.top-rects[0].top)>.75);}
      const collapsedWhitespace=current&&['normal','nowrap'].includes(typography.whiteSpace)&&/(^[ \t\r\n\f]|[ \t\r\n\f]$|[ \t\r\n\f]{2,}|[\t\r\n\f])/.test(current.text);
      if(!current||rich||wrapped||collapsedWhitespace||!['normal','0px'].includes(typography.letterSpacing)||!['normal','0px'].includes(typography.wordSpacing)){
        if(!enabled||forced.matches){rich?.cancel();native(!enabled?'disabled':'forced colors');resolveReady({mode,reason});return;}
        if(!rich){effect.cancel();view.dispose();rich=new DOMRichText(element,THREE,content,canvas,options);life.own(()=>rich.dispose());}
        const next=await rich.prepare(()=>life.disposed||version!==revision,()=>{if(rich.stats().active)preserveMotion();});
        if(!next||life.disposed||version!==revision)return;
        if(next.reason){rich.cancel();native(next.reason);resolveReady({mode,reason});return;}
        if(committed!==null&&committed!==next.text&&pendingPhase===null)pendingPhase='enter';
        committed=next.text;layout=next;reason=null;preparedFingerprint=stamp;builds++;request();return;
      }
      if(!enabled||forced.matches){effect.cancel();native(!enabled?'disabled':'forced colors');resolveReady({mode,reason});return;}
      const changed=await adoptDOMFont(engine,element);
      if(life.disposed||version!==revision)return;
      const next=measure(current,collectCharacters);
      if(next.reason){effect.cancel();native(next.reason);resolveReady({mode,reason});return;}
      const densityChanged=engine.setDisplayFontSize(next.size);
      if(changed||densityChanged||!layout||next.key!==layout.key){
        if(effect.active)preserveMotion();
        if(pendingPhase===null)native();effect.cancel();
        const result=await engine.prepareRows(next,{cancelled:()=>life.disposed||version!==revision});
        if(!result||life.disposed||version!==revision)return;
        const textChanged=committed!==null&&committed!==next.text;
        view.setText(next.text);committed=next.text;builds++;
        if(textChanged&&pendingPhase===null)pendingPhase='enter';
      }
      layout=next;reason=null;preparedFingerprint=stamp;request();
    }catch(error){fail(error);}
    finally{preparing=false;if(!life.disposed&&dirty)request();}
  }
  function beginEffect(now){
    if(pendingPhase===null||!layout)return;
    const resuming=pendingStarted!==null;phase=pendingPhase;pendingPhase=null;now=pendingStarted??now;pendingStarted=null;effectStarted=now;content.visible=true;
    if(rich){if(!resuming&&phase==='enter'||lastSeed===null)lastSeed=effect.randomSeed();rich.play(phase,reduced.matches?'none':effectName,settings,lastSeed,now);if(effectName==='none'||reduced.matches)content.visible=phase==='enter';return;}
    if(effectName==='none'||reduced.matches||!committed){effect.cancel();content.visible=phase==='enter';return;}
    const effectMode=phase==='exit'&&settings.exitEffect!=='same'?settings.exitEffect:effectName;
    effect.setMode(effectMode);effect.configure(settings);
    const b=view.bounds,rectangle={x:b.minX-.001,y:b.minY-.001,width:b.maxX-b.minX+.002,height:b.maxY-b.minY+.002,direction:layout.direction};
    if(!resuming&&phase==='enter'||lastSeed===null)lastSeed=effect.randomSeed();
    effect.playRegion(view,rectangle,200*engine.scale,now,{departing:phase==='exit',seed:lastSeed});
    effect.prepareCharacterCenters(view,()=>layout.characters);
  }
  function render(now){
    frame=null;if(life.disposed||fatal||document.hidden||!intersecting)return;
    if(dirty){prepare();return;}
    if(preparing||!layout||!enabled||forced.matches||reason)return;
    try{
      if(!canvas.isConnected)element.append(canvas);
      if(window.getComputedStyle(element).position==='static')ownStyle('position','relative');
      const {width,height,size,factor}=layout,margin=renderer.globalCanvas?0:Math.ceil(size*3),w=width+margin*2,h=height+margin*2;
      const dpr=Math.min(window.devicePixelRatio||1,2),sizeKey=[w,h,dpr].join(':');
      if(submittedSize!==sizeKey){
        renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);submittedSize=sizeKey;
        Object.assign(canvas.style,{left:-margin+'px',top:-margin+'px',width:w+'px',height:h+'px'});
        camera.left=-margin;camera.right=width+margin;camera.top=margin;camera.bottom=-height-margin;camera.updateProjectionMatrix();
      }
      content.scale.setScalar(factor/engine.scale);
      view.uniforms.tint.value.setStyle(window.getComputedStyle(element).color);
      beginEffect(now);const active=rich?rich.step(now,reduced.matches):effect.step(now,reduced.matches);
      if(!active&&phase==='exit')content.visible=false;
      if(!active&&phase!=='exit'&&resting==='native'){renderer.render(scene,camera);native('native resting presentation');resolveReady({mode,reason});return;}
      const handingOffNative=mode==='native';
      renderer.render(scene,camera);draws++;
      canvas.style.display='block';ownStyle('-webkit-text-fill-color','transparent');ownStyle('text-shadow','none');mode='mesh';reason=null;
      rich?.hide();
      // Commit the shared canvas before the browser paints hidden native text.
      if(handingOffNative)renderer.flushPresentation?.();
      renderer.invalidate?.();
      resolveReady({mode,reason});if(active)request();
    }catch(error){fail(error);}
  }
  life.own(()=>{if(frame!==null)window.cancelAnimationFrame(frame);frame=null;});
  life.own(()=>{for(const name of [...ownedStyle.keys()])restoreStyle(name);});
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});life.own(()=>{renderer.dispose();renderer.forceContextLoss();});
    renderer.setSurface?.(element,{escapeHost:element.closest('button,a,[role="button"]')||element});
    canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');canvas.setAttribute('data-thd-text-surface','');
    fingerprint=createDOMTextFingerprint(element,canvas);
    Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',display:'none',margin:'0',padding:'0',border:'0',maxWidth:'none',maxHeight:'none'});
    element.append(canvas);life.own(()=>canvas.remove());
    life.listen(canvas,'webglcontextlost',event=>{event.preventDefault();fail('WebGL context lost; native text retained');});
    life.listen(canvas,'thdviewportchange',refresh);
    scene=new THREE.Scene();content=new THREE.Group();scene.add(content);
    camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=50;
    engine=new HybridTextFlowEngine({scale:.036,divisions:options.divisions??'auto',textRendering:'texture'});life.own(()=>engine.dispose());
    view=new SharedTextScene(THREE,engine,content);life.own(()=>view.dispose());
    effect=new TextEditEffect(THREE,{mode:effectName==='none'?'dust-wind':effectName,settings});life.own(()=>effect.dispose());
    const mutations=new window.MutationObserver(records=>{
      if(records.some(record=>record.target!==canvas&&!canvas.contains(record.target)))refresh();
    });
    mutations.observe(element,{childList:true,characterData:true,attributes:true,attributeFilter:['class','style','dir'],subtree:true});life.own(()=>mutations.disconnect());
    // Theme and control state are inherited from the existing DOM hierarchy.
    // Observe only attributes on this slot's ancestors, never a document subtree.
    for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
      mutations.observe(ancestor,{attributes:true,attributeFilter:['class','style','dir','disabled','aria-disabled']});
    }
    const resize=new window.ResizeObserver(refresh);resize.observe(element);life.own(()=>resize.disconnect());
    const control=element.closest('button,a,[role="button"]')||element.parentElement||element;
    for(const event of ['mouseenter','mouseleave','focusin','focusout','pointerdown','pointerup','pointercancel'])life.listen(control,event,refresh);
    if(window.IntersectionObserver){
      const visibility=new window.IntersectionObserver(entries=>{
        const next=entries.at(-1)?.isIntersecting!==false;if(next===intersecting)return;
        intersecting=next;if(next)refresh();else suspend();
      });visibility.observe(element);life.own(()=>visibility.disconnect());
    }
    life.listen(document,'visibilitychange',()=>{if(document.hidden)suspend();else refresh();});
    life.listen(window,'resize',refresh);
    for(const event of ['loadingdone','loadingerror'])life.listen(document.fonts,event,()=>{fontRevision++;refresh();});
    life.listen(forced,'change',()=>{native();refresh();});life.listen(reduced,'change',refresh);
    request();
  }catch(error){fail(error);}
  return {element,ready,
    refresh,
    update(next={}){
      if(life.disposed)throw Error('Text surface disposed');
      const candidate=next.inputEffect??effectName;if(!validMode(candidate))throw TypeError('Invalid inputEffect');
      validResting(next.resting??resting);resting=next.resting??resting;
      const normalized=normalizeTextEffectOptions(next.inputEffectOptions?{formation:-1,...next.inputEffectOptions}:settings,candidate==='none'?'dust-wind':candidate);
      effectName=candidate;settings=normalized;if('enabled' in next)enabled=next.enabled!==false;
      effect?.cancel();rich?.cancel();pendingPhase=null;pendingStarted=null;effectStarted=null;phase='enter';if(content)content.visible=true;refresh();
    },
    cancel(){if(life.disposed)return;effect?.cancel();rich?.cancel();pendingPhase=null;pendingStarted=null;effectStarted=null;phase='enter';if(content)content.visible=true;refresh();},
    play(next='enter'){
      if(life.disposed)throw Error('Text surface disposed');if(!['enter','exit'].includes(next))throw TypeError('Expected enter or exit');
      pendingPhase=next;pendingStarted=null;refresh();
    },
    stats:()=>({timeline:{phase,started:effectStarted,ends:effectStarted===null?null:effectStarted+settings.duration},disposed:life.disposed,mode,reason,committed,preparing,draws,builds,pending:frame!==null,suspended:document.hidden||!intersecting,triangles:rich?rich.stats().triangles:view?.triangleCount??0,
      width:layout?.width??0,height:layout?.height??0,fontFamily:engine?.face?.family,displayFontSize:layout?.size,divisions:engine?.divisions,effect:effect?.stats(),rich:rich?.stats()??null}),
    destroy(){if(life.disposed)return;native('destroyed');resolveReady({mode,reason});life.destroy();}
  };
}






