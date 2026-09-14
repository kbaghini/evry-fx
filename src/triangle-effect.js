import {particleCenters} from './particle-centers.js';
import {textEditMotions} from './text-edit-motions.js';
import {normalizeTextEffectOptions,cloneTextEffectOptions,textEffectOptionShader} from './text-effect-options.js';
import {textRecipeUniformShader} from './text-motion-recipes.js';
import {textEffectPathShader,textEffectApplicationShader} from './text-effect-path.js';
import {textMotionPrimitives} from './text-motion-primitives.js';
import {ensureTextMotionContour} from './text-motion-contour.js';
import {ensureTriangleMotionFrame} from './triangle-motion-frame.js';


// Rectangle-driven triangle animation shared by text edits and image surfaces.
// Editing/range mapping stays in TextEditEffect; existing clocks and paths are unchanged.
export class TriangleEffect {
  constructor(THREE,{duration,departing=false,mode='dust-wind',settings={}}={}){
    const motion=textEditMotions[mode];if(!motion)throw TypeError('Invalid text motion');
    duration??=motion.duration;this.mode=mode;
    this.THREE=THREE;this.duration=duration;this.departing=departing;this.active=false;this.jobs=[];this.ghosts=[];this.text=null;this.runs=0;this.exits=0;this.sequence=0;this.lastTime=null;
    this.settledJobs=[];this.boundView=null;this.boundVersion=null;
    this.uniforms={dustEnabled:{value:0},dustMotion:{value:motion.id},dustMaskOnly:{value:departing?1:0},dustEm:{value:1},dustSeconds:{value:duration/1000},dustCount:{value:0},dustWidth:{value:1},dustData:{value:null}};
    this.allocate(1);
    this.materials=new Set();
    this.uniforms.dustTransform={value:new THREE.Vector3(1,1,1)};
    this.uniforms.dustFormation={value:0};this.uniforms.dustChaos={value:1};this.uniforms.dustBounce={value:0};
    this.uniforms.dustRecipeDirection={value:new THREE.Vector2(1,0)};
    this.uniforms.dustRecipePalette={value:new THREE.Vector3(-1,-1,-1)};
    for(const name of ['Depth','Spin','Sway','Shape','Glow','Rebound','Pace'])this.uniforms['dustRecipe'+name]={value:1};
    this.configure({...settings,...(duration===motion.duration?{}:{duration})});
  }
  get pending(){return this.jobs.some(job=>job.started===null);}
  get exitMode(){return this.settings.exitEffect==='same'?this.mode:this.settings.exitEffect;}
  setMode(mode){
    const motion=textEditMotions[mode];if(!motion)throw TypeError('Invalid text motion');
    if(mode===this.mode)return;
    this.cancel();this.mode=mode;
    this.uniforms.dustMotion.value=motion.id;this.configure();
    for(const material of this.materials)this.syncMaterialDefines(material);
  }
  configure(settings={}){
    const next=normalizeTextEffectOptions(settings,this.mode);
    if(this.settings&&JSON.stringify(next)===JSON.stringify(this.settings))return;
    this.cancel();this.settings=next;this.duration=next.duration;
    this.uniforms.dustSeconds.value=next.duration/1000;
    const sx=next.flipX!==(this.departing&&next.exitFlipX)?-1:1,sy=next.flipY!==(this.departing&&next.exitFlipY)?-1:1;
    this.uniforms.dustTransform.value.set(sx*next.motion*next.horizontal,sy*next.motion*next.vertical,next.motion);
    this.uniforms.dustFormation.value=next.formation;this.uniforms.dustChaos.value=next.chaos*2;this.uniforms.dustBounce.value=next.bounceLines?1:0;
    const angle=next.recipe.angle*Math.PI/180;
    const snap=v=>Math.abs(v)<1e-12?0:v;
    this.uniforms.dustRecipeDirection.value.set(snap(Math.cos(angle)),snap(Math.sin(angle)));
    for(const name of ['Depth','Spin','Sway','Shape','Glow','Rebound','Pace'])this.uniforms['dustRecipe'+name].value=next.recipe[name.toLowerCase()];
    this.uniforms.dustRecipePalette.value.fromArray({original:[-1,-1,-1],cool:[.3,.7,1],warm:[1,.5,.2],mint:[.3,1,.7]}[next.recipe.palette]);
    this.characterView=null;
    for(const material of this.materials)this.syncMaterialDefines(material);
  }
  syncMaterialDefines(material){
    const scale=this.uniforms.dustTransform.value;
    const flags={THD_EDIT_MODE:textEditMotions[this.mode].id,THD_EDIT_CHARACTER_FRAME:textEditMotions[this.mode].characterFrame||material.userData.triangleMotionFrame?1:0,THD_EDIT_ADJUST:scale.x!==1||scale.y!==1||scale.z!==1?1:0,THD_EDIT_BOUNCE:this.settings.bounceLines?1:0};
    if(Object.entries(flags).some(([key,value])=>material.defines?.[key]!==value)){material.defines={...material.defines,...flags};material.needsUpdate=true;}
  }
  randomSeed(){return this.settings.seed===null?Math.random():this.settings.seed/4294967296;}
  allocate(count){
    if(this.capacity>=count)return;
    this.capacity=2**Math.ceil(Math.log2(Math.max(1,count)));
    this.uniforms.dustData.value?.dispose();
    const THREE=this.THREE,texture=new THREE.DataTexture(new Float32Array(this.capacity*8),this.capacity,2,THREE.RGBAFormat,THREE.FloatType);
    texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;
    this.uniforms.dustData.value=texture;this.uniforms.dustWidth.value=this.capacity;
  }
  decorate(view){
    const THREE=this.THREE;
    this.materials=new Set(Array.from(view.sharedGroups?.values()||[],({mesh})=>mesh.material));
    for(const {mesh} of view.sharedGroups?.values()||[]){
      const geometry=mesh.geometry;
      if(this.settings.bounceLines&&!geometry.getAttribute('dustCornerA')){
        const a=geometry.getAttribute('position'),corners=[new Float32Array(a.count*3),new Float32Array(a.count*3),new Float32Array(a.count*3)];
        for(let i=0;i<a.count;i+=3)for(let c=0;c<3;c++)for(let j=0;j<3;j++)corners[c].set(a.array.subarray((i+c)*3,(i+c+1)*3),(i+j)*3);
        corners.forEach((values,i)=>geometry.setAttribute(['dustCornerA','dustCornerB','dustCornerC'][i],new THREE.BufferAttribute(values,3)));
      }
      if(textEditMotions[this.mode].contour)ensureTextMotionContour(THREE,geometry);
      particleCenters(THREE,geometry,this.settings.particleShape);
      const material=mesh.material;
      // A surface supplies one local frame; text continues to supply measured
      // per-character attributes. Constant attributes avoid repeating image
      // bounds for every vertex and preserve the same path/bounce evaluator.
      const frame=view.motionFrame;
      material.userData.triangleMotionFrame=!!frame;
      if(frame){
        material.defaultAttributeValues.dustCharacterFrame=[frame.x,frame.y,frame.width,frame.height];
        material.defaultAttributeValues.dustFloor=[frame.y,0];
        material.defaultAttributeValues.dustCeiling=[frame.y+frame.height,0,0,0];
        const motion=textEditMotions[this.mode];
        ensureTriangleMotionFrame(THREE,geometry,frame,{side:motion.characterCenters,floor:motion.characterFloor});
      }
      this.syncMaterialDefines(material);
      if(material.userData.dustWind)continue;
      material.defaultAttributeValues.dustEdge=[1e6,1e6,1e6];
      material.defaultAttributeValues.dustCharacterSide=[0];
      if(!frame){
        material.defaultAttributeValues.dustCharacterFrame=[0,0,0,0];
        material.defaultAttributeValues.dustFloor=[0,0];
        material.defaultAttributeValues.dustCeiling=[0,0,0,0];
      }
      for(const name of ['dustCornerA','dustCornerB','dustCornerC'])material.defaultAttributeValues[name]=[0,0,0];
      material.userData.dustSource={vertexShader:material.vertexShader,fragmentShader:material.fragmentShader};
      material.userData.dustWind=true;Object.assign(material.uniforms,this.uniforms);
      material.vertexShader=`attribute vec2 dustCenter; attribute vec3 dustEdge; attribute float dustCharacterSide; attribute vec2 dustFloor; uniform float dustEnabled; uniform float dustMotion; uniform float dustMaskOnly; uniform float dustEm; uniform float dustSeconds; uniform int dustCount; uniform float dustWidth; uniform sampler2D dustData; varying float dustOpacity; varying float dustGlow; varying vec3 dustGlowColor; varying vec3 dustContour; varying float dustOutline;\n${textMotionPrimitives}\n`+material.vertexShader;
      // Function declarations follow the attributes/uniforms they use.
      const sourceMarker=material.vertexShader.indexOf('void main');
      material.vertexShader=material.vertexShader.slice(0,sourceMarker)+`attribute vec4 dustCharacterFrame; attribute vec4 dustCeiling; attribute vec3 dustCornerA; attribute vec3 dustCornerB; attribute vec3 dustCornerC; uniform vec3 dustTransform; uniform float dustFormation; uniform float dustChaos; uniform float dustBounce;\n${textRecipeUniformShader}\n${textEffectOptionShader}\n${textEffectPathShader}\n`+material.vertexShader.slice(sourceMarker);
      const marker=material.vertexShader.includes('/* THD_TRIANGLE_MOTION */')?'/* THD_TRIANGLE_MOTION */':'float sampleIndex =';
      material.vertexShader=material.vertexShader.replace(marker,`
        dustOpacity=1.0-dustMaskOnly;
        dustGlow=0.0;
        dustGlowColor=vec3(1.0);
        dustContour=dustEdge;
        dustOutline=0.0;
        vec2 dustTarget=dustCenter+glyphOffset;
        if(dustEnabled>0.5){
          for(int k=0;k<dustCount;k++){
            float u=(float(k)+0.5)/dustWidth;
            vec4 r=texture2D(dustData,vec2(u,0.25));
            if(dustTarget.x>=r.x&&dustTarget.x<=r.z&&dustTarget.y>=r.y&&dustTarget.y<=r.w){
              vec4 clock=texture2D(dustData,vec2(u,0.75));
              vec2 particle=(dustTarget-r.xy)/dustEm;
              float seed=fract(sin(dot(particle,vec2(127.1,311.7))+clock.w*53.0)*43758.5453);
              float drift=fract(sin(dot(particle,vec2(269.5,183.3))+clock.w*91.7)*43758.5453);
              float pace=fract(sin(dot(particle,vec2(419.2,371.9))+clock.w*73.0)*43758.5453);
              vec2 travel=thdParticleTravel(seed,drift,pace,dustSeconds);
              travel.y=thdFormationSeconds(travel.y,dustSeconds,dustFormation);
              float t=thdMotionPhase(clock,travel.y,dustSeconds);
              #ifdef THD_HYBRID_GLOBAL_ESCAPE
                hybridEscaping=1.0-step(0.99999,t);
              #endif
              #ifdef THD_RASTER_TEXTURE
                vRasterQuality=smoothstep(0.9,1.0,t);
              #endif
              if(dustChaos!=1.0){
                seed=clamp(mix(0.5,seed,dustChaos),0.0,1.0);
                drift=clamp(mix(0.5,drift,dustChaos),0.0,1.0);
                pace=clamp(mix(0.5,pace,dustChaos),0.0,1.0);
              }
              float remain=1.0-t;
              dustOpacity=smoothstep(0.0,0.1,t);
              ${textEffectApplicationShader}
              p.z=thdFrontDepth(position.z,p.z);
              break;
            }
          }
        }
        ${marker==='float sampleIndex ='?marker:''}`);
      material.fragmentShader='uniform float dustEm; varying float dustOpacity; varying float dustGlow; varying vec3 dustGlowColor; varying vec3 dustContour; varying float dustOutline;\n'+material.fragmentShader;
      material.fragmentShader=material.fragmentShader.replace('coverage);',`coverage * dustOpacity);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,dustGlowColor,clamp(dustGlow,0.0,1.0));
        if(dustOutline>0.0){
          float edge=min(dustContour.x,min(dustContour.y,dustContour.z));
          float border=1.0-smoothstep(dustEm*0.018,dustEm*0.018+max(fwidth(edge),0.00001),edge);
          gl_FragColor.a*=mix(1.0,border,dustOutline);
        }`);material.needsUpdate=true;
    }
  }
  playRegion(view,rectangle,unit,now,{departing=false,seed=this.randomSeed(),fromAge=1}={}){
    const settings=this.settings;
    this.cancel();this.departing=departing;this.uniforms.dustMaskOnly.value=departing?1:0;
    this.settings=null;this.configure(settings);
    this.decorate(view);this.uniforms.dustEm.value=unit;
    this.jobs=[{id:++this.sequence,seed,started:now,fromAge,rectangles:[rectangle]}];
    this.runs++;return this.step(now);
  }
  step(now,reducedMotion=false){
    this.lastTime=now;
    if(reducedMotion){this.cancel();return false;}
    this.jobs=this.jobs.filter(job=>{
      if(job.started===null||now-job.started<this.duration)return true;
      if(!this.departing)this.settledJobs.push(job);
      return false;
    });
    const rectangles=this.jobs.filter(job=>job.started!==null).flatMap(job=>job.rectangles.map(rect=>({rect,age:Math.max(0,(now-job.started)/this.duration),seed:job.seed||0,fromAge:job.fromAge??1})));
    this.allocate(rectangles.length);
    const data=this.uniforms.dustData.value.image.data;
    rectangles.forEach(({rect:r,age,seed,fromAge},i)=>{
      data.set([r.x,r.y,r.x+r.width,r.y+r.height],i*4);
      data.set([age,r.direction==='rtl'?-1:1,this.departing?1+fromAge:0,seed],(this.capacity+i)*4);
    });
    this.uniforms.dustData.value.needsUpdate=true;this.uniforms.dustCount.value=rectangles.length;
    this.ghosts=this.ghosts.filter(ghost=>{
      // First displayed frame is phase zero, even if shaping delayed that frame.
      for(const job of ghost.effect.jobs)job.started??=now;
      if(ghost.effect.step(now))return true;ghost.release();return false;
    });
    this.active=rectangles.length>0||this.ghosts.length>0;this.uniforms.dustEnabled.value=rectangles.length?1:0;return this.active;
  }
  cancel(){for(const ghost of this.ghosts)ghost.release();this.ghosts=[];this.jobs=[];this.settledJobs=[];this.boundView=null;this.boundVersion=null;this.text=null;this.active=false;this.uniforms.dustEnabled.value=0;this.uniforms.dustCount.value=0;}
  dispose(){this.cancel();this.materials.clear();this.uniforms.dustData.value.dispose();}
  stats(){return {mode:this.mode,exitMode:this.exitMode,duration:this.duration,settings:cloneTextEffectOptions(this.settings),active:this.active,pending:this.pending,runs:this.runs,exits:this.exits,departures:this.ghosts.length,departureModes:this.ghosts.map(g=>g.effect.mode),rectangles:this.uniforms.dustCount.value,batches:this.jobs.map(({id,range,started})=>({id,range,started}))};}
}
