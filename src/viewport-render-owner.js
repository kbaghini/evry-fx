import {MAX_VIEWPORT_CLIPS,readViewportClip,applyViewportClips} from './viewport-clip.js';
const ownerBackends=new WeakMap(),controlSessions=new WeakMap();

// Opt-in DOM presentation: one visible GPU canvas; each surface keeps its local
// scene/camera and a paint-free DOM anchor. No bitmap copies or hidden editors.
export function createViewportRenderOwner(THREE,document,{escapeEffects=true,zIndex=100,root=null,local=false,documentCanvas=false}={}){
  if(!THREE?.WebGLRenderer||!document?.defaultView)throw TypeError('THREE and a window document required');
  if(typeof escapeEffects!=='boolean'||!Number.isFinite(zIndex))throw TypeError('Invalid viewport presentation options');
  if(root&&(root.ownerDocument!==document||root.tagName!=='DIALOG'))throw TypeError('Shared root must be a dialog in the owner document');
  const useDocumentCanvas=documentCanvas&&!local&&!root;
  let documentBand=null,bandMoves=0;
  const window=document.defaultView,leases=new Set(),handles=new Set(),listeners=[];
  let renderer=null,disposed=false,lost=false,frame=null,dirty=false,lastSignature='',frames=0,passes=0,renderMs=0,created=0;
  let observer=null,resizeObserver=null,layoutObserver=null,placements=[],tracking=false,bufferWidth=0,bufferHeight=0,bufferRatio=0,failure=null;
  const observedLayout=new Set(),externalAnimations=new Set();
  const spatialAnimations=new WeakMap();
  const materials=new WeakMap();
  let frameStyles=null,frameRects=null;
  function readStyle(node){if(!frameStyles)return window.getComputedStyle(node);let value=frameStyles.get(node);if(!value){value=window.getComputedStyle(node);frameStyles.set(node,value);}return value;}
  function readRect(node){if(!frameRects)return node.getBoundingClientRect();let value=frameRects.get(node);if(!value){value=node.getBoundingClientRect();frameRects.set(node,value);}return value;}
  let copies=0,copyMs=0,localLayoutDirty=false;
  const listen=(target,event,fn,options)=>{target.addEventListener(event,fn,options);listeners.push(()=>target.removeEventListener(event,fn,options));};
  function request(force=false){
    if(disposed||lost)return;dirty ||= force||local;
    if(local&&!force)localLayoutDirty=true;
    if(frame===null)frame=window.requestAnimationFrame(paint);
  }
  function stop(error){
    if(lost||disposed)return;lost=true;failure=String(error?.message||error);
    if(frame!==null)window.cancelAnimationFrame(frame);frame=null;placements=[];
    renderer.domElement.style.display='none';
    for(const lease of leases)lease.domElement.dispatchEvent(new window.Event('webglcontextlost',{cancelable:true}));
  }
  function onLoss(event){event.preventDefault();stop('WebGL context lost; recreate the DOM renderer to retry');}
  function geometryAnimation(animation){
    if(!spatialAnimations.has(animation))spatialAnimations.set(animation,animation.effect?.getKeyframes().some(f=>Object.keys(f).some(key=>/^(transform|translate|rotate|scale|perspective|opacity|width|height|top|left|right|bottom|margin.*|padding.*|fontSize|flex.*|grid.*)$/.test(key))));
    return animation.playState==='running'&&spatialAnimations.get(animation);
  }
  function observeLayout(){
    if(!resizeObserver)return;
    const next=new Set();
    for(const lease of leases)for(let node=lease.surface;node?.isConnected;node=node.parentElement)next.add(node);
    for(const node of observedLayout)if(!next.has(node)){resizeObserver.unobserve(node);observedLayout.delete(node);}
    for(const node of next)if(!observedLayout.has(node)){resizeObserver.observe(node);observedLayout.add(node);}
  }
  function ensure(){
    if(disposed||lost)throw Error('Shared viewport renderer unavailable');
    if(renderer)return;
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});created++;
    const canvas=renderer.domElement;canvas.setAttribute('data-thd-global-canvas','');canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:String(zIndex),margin:'0',padding:'0',border:'0',display:'block'});
    if(useDocumentCanvas){canvas.style.position='absolute';canvas.style.inset='auto';canvas.style.left='0';canvas.setAttribute('data-thd-document-canvas','');}
    if(!local)(root||document.body||document.documentElement).append(canvas);renderer.autoClear=false;renderer.setClearColor(0,0);
    listen(canvas,'webglcontextlost',onLoss);
    for(const target of [window,window.visualViewport].filter(Boolean))for(const event of ['resize','scroll'])listen(target,event,()=>request(),{passive:true});
    listen(document,'scroll',()=>request(),{capture:true,passive:true});
    for(const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel'])listen(document,event,e=>{
      for(const animation of e.target.getAnimations?.()||[])if(geometryAnimation(animation))externalAnimations.add(animation);request();
    },true);
    for(const event of ['load','loadedmetadata','toggle','beforetoggle','close','fullscreenchange'])listen(document,event,()=>request(),true);
    listen(document,'visibilitychange',()=>request(true));
    if(window.ResizeObserver){resizeObserver=new window.ResizeObserver(()=>request());}
    if(window.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift')){
      layoutObserver=new window.PerformanceObserver(()=>request());layoutObserver.observe({type:'layout-shift'});
    }
    observer=new window.MutationObserver(records=>{
      const relevant=records.filter(r=>r.target!==canvas&&!r.target.closest?.('[data-thd-viewport-anchor]'));
      if(relevant.length){
        const moved=relevant.some(r=>r.type==='childList'&&[...r.addedNodes,...r.removedNodes].some(node=>node.nodeType===1&&[...leases].some(lease=>lease.surface&&node.contains(lease.surface))));
        if(moved)observeLayout();request();
      }
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open','dir','data-theme']});
  }
  function surfaceIssue(lease){
    if(local)return lease.surface&&lease.escapeHost&&!lease.escapeHost.contains(lease.surface)?'Source moved outside attachment host; detach and attach in the new host':null;
    if(root&&(!root.isConnected||!root.open||!root.contains(lease.surface)))return 'Dialog closed or source outside registered root';
    if(lease.surface&&lease.escapeHost&&!lease.escapeHost.contains(lease.surface))return 'Source moved outside attachment host; detach and attach in the new host';
    if(document.fullscreenElement&&!document.fullscreenElement.contains(renderer.domElement))return 'Fullscreen content uses native text';
    let rounded=0;
    for(let node=lease.surface;node;node=node.parentElement){
      if(node!==root&&node.matches('dialog:modal'))return 'Top-layer dialog uses native text';
      if(node.hasAttribute('popover')&&node.matches(':popover-open'))return 'Top-layer popover uses native text';
      const style=readStyle(node);
      if(style.clipPath&&style.clipPath!=='none'||style.maskImage&&style.maskImage!=='none')return 'CSS masked layout uses native text';
      if(style.perspective!=='none'||style.rotate&&style.rotate!=='none'&&style.rotate!=='0deg')return 'Rotated or perspective DOM layout uses native text';
      if(style.scale&&style.scale!=='none'&&style.scale.split(/\s+/).some(value=>Number(value)<=0))return 'Reflected DOM layout uses native text';
      if(style.transform!=='none'){
        const matrix=new window.DOMMatrixReadOnly(style.transform);
        if(!matrix.is2D||Math.abs(matrix.b)>1e-7||Math.abs(matrix.c)>1e-7||matrix.a<=0||matrix.d<=0)return 'Rotated or skewed DOM layout uses native text';
      }
      if(node!==lease.surface&&(node===root||!(escapeEffects&&lease.escapeHost?.contains(node)))){
        if((style.overflowX==='clip'||style.overflowY==='clip')&&style.overflowClipMargin!=='0px')return 'Expanded CSS overflow clipping uses native text';
        try{if(readViewportClip(node,style,readRect(node))&&++rounded>MAX_VIEWPORT_CLIPS)return 'Too many nested rounded clips; native text retained';}
        catch{return 'Unresolved rounded clipping uses native text';}
      }
      if(node===root)break;
    }
    return null;
  }
  function measure(lease,viewport){
    const anchor=lease.domElement,source=lease.surface;
    if(lease.dead||!source?.isConnected||!anchor.isConnected||document.hidden)return null;
    // Inherited typography can change after an intact component is moved under
    // a new ancestor; the original surface observers do not know that ancestor.
    const appearance=readStyle(source),styleKey=[appearance.font,appearance.color,appearance.direction,appearance.textAlign,appearance.lineHeight,appearance.letterSpacing,appearance.wordSpacing,appearance.writingMode,appearance.paddingTop,appearance.paddingRight,appearance.paddingBottom,appearance.paddingLeft].join('|');
    if(lease.styleKey!==styleKey){const known=lease.styleKey!==undefined;lease.styleKey=styleKey;if(known)anchor.dispatchEvent(new window.Event('thdviewportchange'));}
    const anchorStyle=readStyle(anchor);
    const hidden=anchorStyle.display==='none'||anchorStyle.visibility!=='visible';
    // A native-rest/dormant surface needs only the appearance check above.
    // Continue checking established issues so corrected layouts can recover.
    if(hidden&&!lease.issue)return null;
    for(let node=source;node;node=node.parentElement)for(const animation of node.getAnimations?.()||[])if(geometryAnimation(animation))tracking=true;
    const issue=surfaceIssue(lease);
    if(issue!==lease.issue){lease.issue=issue;anchor.dispatchEvent(new window.Event('thdviewportchange'));}
    if(hidden||issue||!lease.scene)return null;
    const sourceRect=readRect(source);let rect=readRect(anchor);
    // Native editors may move inside a host without resizing. Their sibling
    // anchor can be stale until the surface next renders; use the live client box.
    if(/^(INPUT|TEXTAREA)$/.test(source.tagName)){
      const sx=source.offsetWidth?sourceRect.width/source.offsetWidth:1,sy=source.offsetHeight?sourceRect.height/source.offsetHeight:1;
      rect={left:sourceRect.left+source.clientLeft*sx,top:sourceRect.top+source.clientTop*sy,width:source.clientWidth*sx,height:source.clientHeight*sy};
      rect.right=rect.left+rect.width;rect.bottom=rect.top+rect.height;
    }
    if(!(rect.width>0&&rect.height>0&&sourceRect.width>0&&sourceRect.height>0))return null;
    const clip={left:viewport.left,top:viewport.top,right:viewport.right,bottom:viewport.bottom};
    let opacity=1;const roundedClips=[];
    for(let node=source;node;node=node.parentElement){
      const style=readStyle(node);
      if(style.display==='none'||style.visibility!=='visible'||node.hidden)return null;
      // The canvas inherits the dialog's CSS opacity itself; apply only descendants.
      if(node!==root)opacity*=Number(style.opacity);
      if(node===source||node!==root&&escapeEffects&&lease.escapeHost?.contains(node))continue;
      const box=readRect(node),sx=node.offsetWidth?box.width/node.offsetWidth:1,sy=node.offsetHeight?box.height/node.offsetHeight:1;
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowX)){clip.left=Math.max(clip.left,box.left+node.clientLeft*sx);clip.right=Math.min(clip.right,box.left+(node.clientLeft+node.clientWidth)*sx);}
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)){clip.top=Math.max(clip.top,box.top+node.clientTop*sy);clip.bottom=Math.min(clip.bottom,box.top+(node.clientTop+node.clientHeight)*sy);}
      const roundedClip=readViewportClip(node,style,box);if(roundedClip)roundedClips.push(roundedClip);
      if(node===root)break;
    }
    if(opacity<=0||clip.right<=clip.left||clip.bottom<=clip.top||sourceRect.right<=clip.left||sourceRect.left>=clip.right||sourceRect.bottom<=clip.top||sourceRect.top>=clip.bottom)return null;
    return {lease,rect,clip,opacity,roundedClips};
  }
  function setOpacity(scene,opacity){
    scene.traverse(object=>{
      for(const material of (Array.isArray(object.material)?object.material:[object.material])){
        if(!material?.isShaderMaterial)continue;
        if(materials.get(material)!==material.fragmentShader){
          if(!material.fragmentShader.includes('uniform float thdSurfaceOpacity;')){
            material.fragmentShader='uniform float thdSurfaceOpacity;\n'+material.fragmentShader.replace(/}\s*$/,'gl_FragColor.a *= thdSurfaceOpacity;\n}');
            material.needsUpdate=true;
          }
          material.uniforms.thdSurfaceOpacity??={value:opacity};materials.set(material,material.fragmentShader);
        }
        material.uniforms.thdSurfaceOpacity.value=opacity;
      }
    });
  }
  function paint(){frameStyles=new WeakMap();frameRects=new WeakMap();try{paintFrame();}catch(error){stop(error);}finally{frameStyles=null;frameRects=null;}}
  function escapeUniforms(scene,enabled){
    scene.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material?.uniforms?.hybridEscapeEnabled)material.uniforms.hybridEscapeEnabled.value=enabled?1:0;
    }});
  }
  function localCanvas(lease){
    if(!lease.localCanvas){
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
      if(!context)throw Error('2D presentation unavailable');
      canvas.setAttribute('aria-hidden','true');canvas.setAttribute('data-thd-local-canvas','');
      Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
      lease.localCanvas=canvas;lease.localContext=context;lease.domElement.append(canvas);
    }
    return lease.localCanvas;
  }
  function paintLocal(){
    if(!dirty)return;dirty=false;
    const start=window.performance.now();
    for(const lease of leases){
      if(lease.dead||!lease.scene||!lease.width||!lease.height||!lease.needsPaint&&!localLayoutDirty)continue;
      lease.needsPaint=false;
      const canvas=localCanvas(lease),ratio=lease.ratio||1;
      // Local leases share a stable physical-pixel scratch buffer.
      const pw=Math.floor(lease.width*ratio),ph=Math.floor(lease.height*ratio);
      if(bufferRatio!==1){renderer.setPixelRatio(1);bufferRatio=1;}
      if(pw>bufferWidth||ph>bufferHeight){bufferWidth=Math.max(bufferWidth,pw);bufferHeight=Math.max(bufferHeight,ph);renderer.setSize(bufferWidth,bufferHeight,false);}
      // Clear the entire retained buffer, not only this lease's viewport:
      // cropped canvas copies must never see pixels from a previous lease.
      renderer.setScissorTest(false);renderer.clear(true,true,true);
      renderer.setViewport(0,0,pw,ph);renderer.setScissor(0,0,pw,ph);renderer.setScissorTest(true);
      setOpacity(lease.scene,Number(window.getComputedStyle(lease.surface).opacity));
      applyViewportClips(lease.scene,[],{left:0,bottom:lease.height},ratio);escapeUniforms(lease.scene,false);
      renderer.render(lease.scene,lease.camera);passes++;
      const copyStart=window.performance.now();
      if(canvas.width!==pw)canvas.width=pw;
      if(canvas.height!==ph)canvas.height=ph;
      lease.localContext.clearRect(0,0,canvas.width,canvas.height);lease.localContext.drawImage(renderer.domElement,0,bufferHeight-ph,pw,ph,0,0,pw,ph);
      copies++;copyMs+=window.performance.now()-copyStart;
    }
    localLayoutDirty=false;renderMs+=window.performance.now()-start;frames++;
  }
  function paintFrame(){
    frame=null;if(disposed||lost||!renderer)return;
    if(local){paintLocal();return;}
    const canvas=renderer.domElement;
    if(useDocumentCanvas){
      const width=document.documentElement.clientWidth,height=window.innerHeight,y=Math.max(0,window.scrollY);
      const pageHeight=document.documentElement.scrollHeight,bandHeight=Math.min(pageHeight,height*2);
      const margin=Math.min(height*.2,Math.max(0,(bandHeight-height)/4));
      if(!documentBand||documentBand.width!==width||documentBand.height!==bandHeight||y<documentBand.top+margin||y+height>documentBand.top+bandHeight-margin){
        const top=Math.max(0,Math.min(Math.floor(y-height*.5),pageHeight-bandHeight));
        if(!documentBand||top!==documentBand.top||width!==documentBand.width||bandHeight!==documentBand.height){
          Object.assign(canvas.style,{top:top+'px',width:width+'px',height:bandHeight+'px'});
          documentBand={top,width,height:bandHeight};bandMoves++;dirty=true;
        }
      }
    }
    const viewport=canvas.getBoundingClientRect(),w=viewport.width,h=viewport.height;
    if(!(w>0&&h>0))return;
    tracking=false;
    for(const animation of externalAnimations)if(geometryAnimation(animation))tracking=true;else externalAnimations.delete(animation);
    const ratio=Math.min(window.devicePixelRatio||1,2),visible=[...leases].map(lease=>measure(lease,viewport)).filter(Boolean);
    if(tracking)request();
    // DOM order is the explicit paint order within this global layer.
    visible.sort((a,b)=>a.lease.surface.compareDocumentPosition(b.lease.surface)&4?-1:1);
    const signature=JSON.stringify([w,h,ratio,visible.map(({lease,rect,clip,opacity,roundedClips})=>[lease.id,rect.left,rect.top,rect.width,rect.height,clip,opacity,roundedClips])]);
    if(!dirty&&signature===lastSignature)return;
    dirty=false;lastSignature=signature;
    if(bufferRatio!==ratio){renderer.setPixelRatio(ratio);bufferRatio=ratio;bufferWidth=bufferHeight=0;}
    if(bufferWidth!==w||bufferHeight!==h){renderer.setSize(w,h,false);bufferWidth=w;bufferHeight=h;}
    renderer.setViewport(0,0,w,h);renderer.setScissorTest(false);renderer.clear(true,true,true);
    const start=window.performance.now();placements=[];
    for(const {lease,rect,clip,opacity,roundedClips} of visible){
      const camera=lease.camera,mapped=lease.mappedCamera||(lease.mappedCamera=camera.clone());mapped.copy(camera);
      const spanX=camera.right-camera.left,spanY=camera.top-camera.bottom;
      mapped.left=camera.left-(rect.left-viewport.left)*spanX/rect.width;
      mapped.right=mapped.left+w*spanX/rect.width;
      mapped.top=camera.top+(rect.top-viewport.top)*spanY/rect.height;
      mapped.bottom=mapped.top-h*spanY/rect.height;mapped.updateProjectionMatrix();
      renderer.setScissor(clip.left-viewport.left,viewport.bottom-clip.bottom,clip.right-clip.left,clip.bottom-clip.top);renderer.setScissorTest(true);renderer.clearDepth();
      setOpacity(lease.scene,opacity);applyViewportClips(lease.scene,roundedClips,viewport,ratio);escapeUniforms(lease.scene,escapeEffects);renderer.render(lease.scene,mapped);passes++;
      placements.push({id:lease.id,left:rect.left,top:rect.top,width:rect.width,height:rect.height,clip:{...clip},roundedClips:roundedClips.length});
    }
    renderer.setScissorTest(false);renderMs+=window.performance.now()-start;frames++;
  }
  let sequence=0;
  let createdLease=null;
  const backend={leases,handles,ensure,request,surfaceIssue,observeLayout,
    flush(){if(frame!==null)window.cancelAnimationFrame(frame);frame=null;dirty=true;paint();return !lost;},
    release(lease){leases.delete(lease);observeLayout();request(true);},
    available:()=>!disposed&&!lost,nextId:()=>++sequence,escapeEffects,local,
    prepare:lease=>{if(local){localCanvas(lease);lease.needsPaint=true;}},
    present(lease){lease.domElement.style.opacity=local?'1':'0';if(lease.localCanvas)lease.localCanvas.style.display=local?'block':'none';}};
  const Namespace={...THREE,WebGLRenderer:class{
    constructor(){
      ensure();this.id=++sequence;this.domElement=document.createElement('span');this.domElement.setAttribute('data-thd-viewport-anchor','');
      Object.assign(this.domElement.style,{display:'block',position:'absolute',pointerEvents:'none',opacity:local?'1':'0'});
      this.globalCanvas=true;this.escapeEffects=escapeEffects;this.dead=false;leases.add(this);
      this.backend=backend;createdLease=this;
      backend.prepare(this);
    }
    setSurface(element,{escapeHost=element}={}){
      this.surface=element;this.escapeHost=escapeHost;
      this.onCompositionStart=()=>{this.composing=true;};this.onCompositionEnd=()=>{this.composing=false;};
      element.addEventListener('compositionstart',this.onCompositionStart);element.addEventListener('compositionend',this.onCompositionEnd);
      this.backend.observeLayout();this.backend.request(true);
    }
    getSurfaceIssue(){return this.backend.surfaceIssue(this);}
    setPixelRatio(value){this.ratio=value;}
    setSize(width,height){this.width=width;this.height=height;}
    invalidate(){this.backend.request(true);}
    flushPresentation(){return this.backend.flush();}
    render(scene,camera){
      this.backend.ensure();if(this.dead)throw Error('Presentation disposed');if(!camera.isOrthographicCamera)throw TypeError('DOM viewport presentation requires an orthographic camera');
      this.scene=scene;this.camera=camera;this.needsPaint=true;this.backend.request(true);
    }
    dispose(){if(this.dead)return;this.dead=true;this.backend.release(this);this.surface?.removeEventListener('compositionstart',this.onCompositionStart);this.surface?.removeEventListener('compositionend',this.onCompositionEnd);this.scene=null;this.camera=null;this.domElement.remove();}
    forceContextLoss(){} // A surface cannot destroy its peers' context.
  }};
  const api={
    transfer(control,target,{recover=false}={}){
      const session=controlSessions.get(control),destination=ownerBackends.get(target);
      if(!session||session.backend!==backend||!backend.available()||!destination?.available())throw Error('Unavailable transfer owner');
      const lease=session.lease;
      if(!lease||control.stats().mode!=='mesh'&&!recover)throw Error('Only a visible mesh surface can transfer');
      if(lease.composing)throw Error('Transfer deferred during composition');
      if(!lease.scene||!lease.camera)throw Error('Surface must have rendered before transfer');
      if(destination===backend)return;
      if(destination.escapeEffects!==escapeEffects)throw Error('Incompatible escape policy');
      destination.ensure();const issue=destination.surfaceIssue(lease);if(issue)throw Error(issue);
      destination.prepare(lease);
      leases.delete(lease);handles.delete(control);
      destination.leases.add(lease);destination.handles.add(control);
      lease.backend=destination;session.backend=destination;lease.id=destination.nextId();lease.mappedCamera=null;lease.issue=null;
      destination.present(lease);
      observeLayout();destination.observeLayout();
      // Both buffers are updated in this task; the effect clock is not advanced.
      backend.flush();destination.flush();
      if(recover)lease.domElement.dispatchEvent(new window.Event('thdviewportchange'));
    },
    get domElement(){return renderer?.domElement??null;},
    refresh(){
      if(disposed)throw Error('Shared owner disposed');
      for(const animation of document.getAnimations?.()||[])if(geometryAnimation(animation))externalAnimations.add(animation);
      observeLayout();for(const control of handles)control.refresh?.();request(true);
    },
    create(factory,host,options){
      if(disposed)throw Error('Shared owner disposed');if(host?.ownerDocument!==document)throw TypeError('Host must belong to the owner document');
      if(root&&!root.contains(host))throw TypeError('Surface must belong to its registered dialog');
      createdLease=null;
      const control=factory(host,Namespace,options),destroy=control.destroy;handles.add(control);
      const session={lease:createdLease,backend};controlSessions.set(control,session);
      control.destroy=()=>{session.backend.handles.delete(control);controlSessions.delete(control);destroy();};return control;
    },
    stats:()=>({documentCanvas:useDocumentCanvas,documentBand,bandMoves,presentation:local?'local':'viewport',disposed,lost,failure,contexts:renderer&&!disposed?1:0,canvases:local?leases.size:renderer&&!disposed?1:0,created,controls:handles.size,leases:leases.size,copies,copyMs,frames,passes,renderMs,pending:frame!==null,escapeEffects,zIndex,placements,geometries:renderer?.info.memory.geometries||0}),
    destroy(){
      if(disposed)return;disposed=true;if(frame!==null)window.cancelAnimationFrame(frame);frame=null;observer?.disconnect();resizeObserver?.disconnect();resizeObserver=null;observedLayout.clear();layoutObserver?.disconnect();externalAnimations.clear();for(const off of listeners)off();
      const errors=[];for(const control of [...handles])try{control.destroy();}catch(error){errors.push(error);}
      if(renderer){try{renderer.dispose();renderer.forceContextLoss();}catch(error){errors.push(error);}renderer.domElement.remove();}
      if(errors.length)throw new AggregateError(errors,'Viewport owner cleanup failed');
    }
  };
  ownerBackends.set(api,backend);return api;
}


