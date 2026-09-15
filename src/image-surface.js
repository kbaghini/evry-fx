import {imageMotionPixels} from './motion-envelope.js';
import {loadImageRaster} from './image-source.js';
import {rasterToTextureMesh} from './raster-texture-mesh.js';
import {attachRasterTexture,applyRasterSamplingShader} from './raster-texture-material.js';
import {textDivisionsForSize,createProjectedTextSize} from './text-mesh-density.js';
import {TriangleEffect} from './triangle-effect.js';
import {normalizeTextEffectOptions} from './text-effect-options.js';
import {textEditMotions} from './text-edit-motions.js';

export const IMAGE_EFFECT_MODES=Object.freeze(Object.keys(textEditMotions));
// Images share motion recipes with text, but preserve source color by default.
export function normalizeImageEffectOptions(settings={},mode='dust-wind'){
  const normalized=normalizeTextEffectOptions({formation:-1,...settings},mode);
  return Object.freeze({...normalized,recipe:Object.freeze({...normalized.recipe,glow:settings.recipe?.glow??0})});
}

// Images use twice the text-derived rows: half-size cells, with a bounded grid.
export function imageDivisions(width,height,displayHeight,current=null,maxTriangles=80000){
  let rows=2*textDivisionsForSize(displayHeight,current===null?null:current/2);
  while(rows>1&&2*rows*Math.max(1,Math.round(width*rows/height))>maxTriangles)rows--;
  if(2*rows*Math.max(1,Math.round(width*rows/height))>maxTriangles)throw Error('Image aspect ratio exceeds the triangle budget');
  return rows;
}

const vertexShader=`
attribute vec2 rasterUV;
attribute vec2 glyphOffset;
varying vec2 vRasterUV;
void main(){
  vRasterUV=rasterUV;
  vec3 p=position+vec3(glyphOffset,0.0);
  /* THD_TRIANGLE_MOTION */
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;
const fragmentShader=`
uniform float presentationOpacity;
uniform sampler2D rasterMap;
varying vec2 vRasterUV;
void main(){
  vec4 rasterSample=texture2D(rasterMap,vRasterUV);
  float coverage=rasterSample.a;
  gl_FragColor=vec4(rasterSample.rgb, coverage);
  #include <colorspace_fragment>
  gl_FragColor.a *= presentationOpacity;
}`;

// One image object in an existing runtime. No renderer, input or font ownership.
export function createImageSurface(runtime,{source,width=6,height=3.8,effect='dust-wind',settings={},direction='ltr'}={}){
  if(runtime.disposed)throw Error('Spatial runtime disposed');
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw RangeError('Positive image bounds required');
  const validMode=mode=>{if(!IMAGE_EFFECT_MODES.includes(mode))throw TypeError('Unsupported image effect');};
  const validDirection=value=>{if(!['ltr','rtl'].includes(value))throw TypeError('Invalid direction');};
  validMode(effect);validDirection(direction);
  const {THREE}=runtime,document=runtime.renderer.domElement.ownerDocument,object=new THREE.Group();
  const motion=new TriangleEffect(THREE,{mode:effect,settings:normalizeImageEffectOptions(settings,effect)}),measure=createProjectedTextSize(THREE);
  let requestedSettings=settings,entryMode=effect,entrySettings=motion.settings;
  let disposed=false,asset=null,controller=null,revision=0,loading=false,error=null,state='empty',intent=null;
  let displaySize=null;
  let lastSeed=null,builds=0,loadMs=0,buildMs=0;
  const view={sharedGroups:new Map(),version:0};
  function releaseAsset(){
    motion.cancel();motion.uniforms.dustMaskOnly.value=0;motion.materials.clear();view.sharedGroups.clear();
    if(asset){object.remove(asset.mesh);asset.mesh.geometry.dispose();asset.mesh.material.dispose();asset.releaseTexture();asset=null;}
  }
  function geometry(raster,rows,w,h,filterRadius,aspect){
    const mesh=rasterToTextureMesh(raster.rgba,raster.width,raster.height,rows,{filterRadius,aspect}),positions=new Float32Array(mesh.triangleCount*9);
    for(let i=0;i<mesh.coordinates.length;i+=2){const at=i/2*3;positions[at]=(mesh.coordinates[i]/raster.width-.5)*w;positions[at+1]=(.5-mesh.coordinates[i+1]/raster.height)*h;}
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.BufferAttribute(positions,3));
    result.setAttribute('rasterUV',new THREE.BufferAttribute(mesh.uvs,2));result.computeBoundingBox();
    return result;
  }
  function meshSettings(raster,h,current=null){
    const displayHeight=displaySize?.height??measure(object,runtime.camera,runtime.renderer.domElement,h);
    const aspect=displaySize?displaySize.width/displaySize.height:raster.width/raster.height;
    // Mipmap/bilinear filtering sees beyond the original opaque texel. Retain
    // that support too, especially when a wide image is displayed very small.
    const ratio=raster.height/Math.max(1,displayHeight*(runtime.renderer.getPixelRatio?.()||1));
    const filterRadius=displayHeight>0?Math.max(.5,2**Math.ceil(Math.log2(Math.max(1,ratio)))):.5;
    return {rows:imageDivisions(aspect,1,displayHeight,current),filterRadius,aspect};
  }
  function resizeMesh(){
    if(!asset||motion.active)return;
    const next=meshSettings(asset.raster,asset.h,asset.rows);if(next.rows===asset.rows&&next.filterRadius===asset.filterRadius&&next.aspect===asset.aspect)return;
    const start=performance.now(),replacement=geometry(asset.raster,next.rows,asset.w,asset.h,next.filterRadius,next.aspect);
    asset.mesh.geometry.dispose();asset.mesh.geometry=replacement;asset.rows=next.rows;asset.aspect=next.aspect;asset.filterRadius=next.filterRadius;view.version++;builds++;buildMs=performance.now()-start;
    motion.decorate(view);
  }
  async function setSource(value,{preserveMotion=false,bounds=null}={}){
    if(disposed)throw Error('Image surface disposed');
    const token=++revision;controller?.abort();controller=new AbortController();loading=true;error=null;
    try{
      const raster=await loadImageRaster(value,{document,signal:controller.signal,maxSide:Math.min(2048,runtime.renderer.capabilities?.maxTextureSize||2048)});
      if(disposed||token!==revision)return false;
      if(bounds){width=bounds.width;height=bounds.height;}
      const start=performance.now(),factor=Math.min(width/raster.width,height/raster.height),w=raster.width*factor,h=raster.height*factor;
      const {rows,filterRadius,aspect}=meshSettings(raster,h),g=geometry(raster,rows,w,h,filterRadius,aspect);
      const material=new THREE.ShaderMaterial({vertexShader,fragmentShader,side:THREE.DoubleSide,transparent:true,depthWrite:false,toneMapped:false,extensions:{derivatives:true}});
      material.uniforms.presentationOpacity={value:1};
      applyRasterSamplingShader(material);
      material.defaultAttributeValues.glyphOffset=[0,0];
      const releaseTexture=attachRasterTexture(THREE,material,raster),mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;
      // Replacement of DOM pixels/size must not restart an existing effect or
      // reveal an image that has already completed its exit.
      const previousState=state,job=motion.jobs[0],seed=lastSeed;
      const previousIntent=preserveMotion?(intent??(motion.active&&job?{departing:motion.departing,fromAge:job.fromAge,started:job.started,seed}:null)):null;
      releaseAsset();asset={raster,w,h,rows,filterRadius,aspect,mesh,releaseTexture};object.add(mesh);view.sharedGroups.set('image',{mesh});view.version++;
      view.motionFrame={x:-w/2,y:-h/2,width:w,height:h};
      state=preserveMotion?previousState:'visible';intent=previousIntent;lastSeed=preserveMotion?seed:null;mesh.visible=state!=='hidden';builds++;loadMs=raster.decodeMs;buildMs=performance.now()-start;runtime.requestRender();return true;
    }catch(e){if(disposed||token!==revision||e.name==='AbortError')return false;error=e.message;throw e;}
    finally{if(token===revision){loading=false;runtime.requestRender();}}
  }
  function play(departing,started){
    if(disposed||!asset)return false;
    if(departing&&(state==='hidden'||state==='leaving'||intent?.departing))return false;
    const fromAge=state==='entering'&&motion.jobs[0]?Math.max(0,Math.min(1,((motion.lastTime??motion.jobs[0].started)-motion.jobs[0].started)/motion.duration)):1;
    intent={departing,fromAge,started};runtime.requestRender();return true;
  }
  const control={object,
    frame(now,reducedMotion){
      if(disposed||!asset)return;
      resizeMesh();
      if(intent){
        const {departing,fromAge,started,seed}=intent;intent=null;asset.mesh.visible=true;state=departing?'leaving':'entering';
        const exitMode=entrySettings.exitEffect==='same'?entryMode:entrySettings.exitEffect;
        const activeMode=departing?exitMode:entryMode;
        motion.setMode(activeMode);motion.configure(normalizeImageEffectOptions(requestedSettings,activeMode));
        if(seed!==undefined)lastSeed=seed;else if(!departing||lastSeed===null)lastSeed=motion.randomSeed();
        // DOM image coordinates are source pixels, unlike the spatial runtime's
        // world units. Keep travel at a stable 32 CSS px for DOM presentations.
        const shownHeight=displaySize?.height??measure(object,runtime.camera,runtime.renderer.domElement,asset.h);
        const shownWidth=displaySize?.width??shownHeight*asset.w/asset.h;
        const motionUnit=shownHeight>0?imageMotionPixels(shownWidth,shownHeight)*asset.h/shownHeight:.65;
        motion.playRegion(view,{x:-asset.w/2,y:-asset.h/2,width:asset.w,height:asset.h,direction},motionUnit,started??now,{departing,seed:lastSeed,fromAge:departing&&exitMode!==entryMode?1:fromAge});
      }
      if(motion.active){
        motion.step(now,reducedMotion);
        // This surface reuses one material for both directions. Refresh its
        // dynamic clock/mask uniforms on the first draw after a transition too.
        asset.mesh.material.uniformsNeedUpdate=true;
        // Upload this frame's region data before reusing the same sampler.
        runtime.renderer.initTexture?.(motion.uniforms.dustData.value);
        if(motion.active)runtime.requestRender();
        else{state=motion.departing?'hidden':'visible';asset.mesh.visible=!motion.departing;}
      }
      resizeMesh();
    },
    invalidate(){runtime.requestRender();},
    destroy(){if(disposed)return;disposed=true;revision++;controller?.abort();unregister();releaseAsset();motion.dispose();state='disposed';},
  };
  const unregister=runtime.register(control);
  return {object,ready:source===undefined?Promise.resolve(false):setSource(source),setSource,
    enter:started=>play(false,started),exit:started=>play(true,started),
    setEffect(mode,options={}){validMode(mode);const next=normalizeImageEffectOptions(options,mode);if(disposed)return;requestedSettings=options;entryMode=mode;entrySettings=next;motion.setMode(mode);motion.configure(next);motion.cancel();motion.uniforms.dustMaskOnly.value=0;intent=null;if(asset){asset.mesh.visible=true;state='visible';}runtime.requestRender();},
    setDisplaySize(width,height){if(!(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0))throw RangeError('Positive display dimensions required');displaySize={width,height};},
    setDirection(value){validDirection(value);direction=value;},
    setPresentationOpacity(value){if(asset)asset.mesh.material.uniforms.presentationOpacity.value=value;},
    show(){if(disposed||!asset)return;intent=null;motion.cancel();motion.uniforms.dustMaskOnly.value=0;asset.mesh.visible=true;state='visible';runtime.requestRender();},
    frame:control.frame,destroy:control.destroy,
    stats(){const raster=asset?.raster,g=asset?.mesh.geometry;return {disposed,loading,error,state,active:motion.active,mode:entryMode,activeMode:motion.mode,exitMode:entrySettings.exitEffect==='same'?entryMode:entrySettings.exitEffect,duration:motion.duration,settings:{...motion.settings,recipe:{...motion.settings.recipe}},direction,motionFrame:asset?{...view.motionFrame}:null,divisions:asset?.rows,gridAspect:asset?.aspect,gridColumns:asset?Math.max(1,Math.round(asset.rows*asset.aspect)):0,triangles:g?g.getAttribute('position').count/3:0,builds,loadMs,buildMs,rasterBytes:raster?.rgba.byteLength||0,estimatedTextureBytes:raster?Math.ceil(raster.rgba.byteLength*4/3):0,geometryBytes:g?Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0):0,source:raster?{type:raster.type,width:raster.width,height:raster.height,originalWidth:raster.originalWidth,originalHeight:raster.originalHeight}:null};},
  };
}






