import {TriangleEffect} from './triangle-effect.js';
import {insertedRange,remapInsertionRange} from './insertion-range.js';
import {textEditMotions} from './text-edit-motions.js';
import {setTextMotionCharacterCenters} from './text-motion-character-centers.js';
import {retainRasterTexture} from './raster-texture-material.js';
import {ensureTextMotionContour} from './text-motion-contour.js';

// Text-specific ranges and deletion ghosts adapt the shared triangle timeline.
export class TextEditEffect extends TriangleEffect {
  prepareCharacterCenters(view,characterRectangles){
    const frame=textEditMotions[this.mode].characterFrame;
    if(!textEditMotions[this.mode].characterCenters&&!frame&&!this.settings.bounceLines)return;
    const floor=textEditMotions[this.mode].characterFloor||this.settings.bounceLines;
    if(this.characterView===view&&this.characterVersion===view.version&&this.characterFloor===floor&&this.characterFrame===frame)return;
    this.decorate(view);
    setTextMotionCharacterCenters(this.THREE,view,characterRectangles?.()||[],{floor,frame});
    this.characterView=view;this.characterVersion=view.version;this.characterFloor=floor;this.characterFrame=frame;
  }
  enqueue(before,after,inputType){
    const range=insertedRange(before,after,inputType);if(!range)return false;
    if(this.text!==null&&this.text!==before.text)this.cancel();
    const delta=after.text.length-before.text.length,oldEnd=range.end-delta;
    this.jobs=this.jobs.flatMap(job=>remapInsertionRange(job.range,range.start,oldEnd,delta).map(piece=>({...job,range:piece})));
    this.jobs.push({id:++this.sequence,seed:this.randomSeed(),range,started:null,rectangles:[]});
    this.text=after.text;this.runs++;return true;
  }
  bind(view,rectanglesForRange,em,now,characterRectangles){
    // Retain only seeds/rectangles for the current layout, never a mesh/history.
    // A reshape invalidates old origins; active jobs are rebound below.
    if(this.boundView!==view||this.boundVersion!==view.version)this.settledJobs=[];
    this.boundView=view;this.boundVersion=view.version;
    this.decorate(view);this.uniforms.dustEm.value=em;
    this.prepareCharacterCenters(view,characterRectangles);
    for(const job of this.jobs){job.rectangles=rectanglesForRange(job.range);job.started??=now;}
    this.jobs=this.jobs.filter(job=>job.rectangles.length);
    this.step(now);return this.active;
  }
  remove(before,after,range,view,rectangles,em,now,characterRectangles){
    const exitMode=this.exitMode,samePath=exitMode===this.mode;
    // Preserve the last visible timeline and random paths, including arrivals
    // that settled in this layout. Initial/programmatic text has no prior path.
    const settled=this.boundView===view&&this.boundVersion===view.version?this.settledJobs:[];
    const interrupted=[...this.jobs,...settled].filter(job=>job.rectangles.some(r=>rectangles.some(s=>r.x<s.x+s.width&&r.x+r.width>s.x&&r.y<s.y+s.height&&r.y+r.height>s.y))).map(job=>({...job,started:null,fromAge:job.started===null?0:Math.max(0,Math.min(1,((this.lastTime??now)-job.started)/this.duration))}));
    const delta=after.text.length-before.text.length;
    this.jobs=this.jobs.flatMap(job=>remapInsertionRange(job.range,range.start,range.end,delta).map(piece=>({...job,range:piece})));
    this.settledJobs=[];
    this.text=after.text;
    if(!rectangles.length||!view.scene.parent)return false;
    this.decorate(view);
    this.prepareCharacterCenters(view,characterRectangles);
    // A different removal preset starts from the complete retained facets. Its
    // metadata must use the original full character, before filtering deletions.
    if(!samePath){
      const motion=textEditMotions[exitMode];
      if(motion.characterCenters||motion.characterFrame||this.settings.bounceLines)
        setTextMotionCharacterCenters(this.THREE,view,characterRectangles?.()||[],{floor:motion.characterFloor||this.settings.bounceLines,frame:motion.characterFrame});
      // Extra attributes are shared by both modes; invalidate the arrival cache
      // so a subsequent layout bind can refresh any requested metadata.
      this.characterView=null;
    }
    const THREE=this.THREE,group=new THREE.Group(),sharedGroups=new Map();
    group.position.copy(view.scene.position);group.quaternion.copy(view.scene.quaternion);group.scale.copy(view.scene.scale);
    for(const [key,{mesh}] of view.sharedGroups){
      // Retain only departing triangles, not another complete copy of the paragraph.
      const original=mesh.geometry,position=original.getAttribute('position'),offsets=original.getAttribute('glyphOffset');
      if(textEditMotions[exitMode].contour)ensureTextMotionContour(THREE,original);
      const names=['position','color','delay'];if(original.getAttribute('dustEdge'))names.push('dustEdge');
      if(original.getAttribute('rasterUV'))names.push('rasterUV');
      if(original.getAttribute('dustCharacterSide'))names.push('dustCharacterSide');
      if(original.getAttribute('dustCharacterFrame'))names.push('dustCharacterFrame');
      if(original.getAttribute('dustFloor'))names.push('dustFloor');
      if(original.getAttribute('dustCeiling'))names.push('dustCeiling');
      for(const name of ['dustCornerA','dustCornerB','dustCornerC'])if(original.getAttribute(name))names.push(name);
      const values=Object.fromEntries([...names,'glyphOffset'].map(name=>[name,[]]));
      for(let instance=0;instance<original.instanceCount;instance++){
        const ox=offsets.getX(instance),oy=offsets.getY(instance),box=original.boundingBox;
        if(box&&!rectangles.some(r=>box.max.x+ox>=r.x&&box.min.x+ox<=r.x+r.width&&box.max.y+oy>=r.y&&box.min.y+oy<=r.y+r.height))continue;
        for(let i=0;i<position.count;i+=3){
          const x=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3+ox,y=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3+oy;
          if(!rectangles.some(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height))continue;
          for(let j=0;j<3;j++){
            for(const name of names){const a=original.getAttribute(name);for(let c=0;c<a.itemSize;c++)values[name].push(a.array[(i+j)*a.itemSize+c]);}
            values.glyphOffset.push(ox,oy);
          }
        }
      }
      if(!values.position.length)continue;
      const geometry=new THREE.BufferGeometry();for(const [name,array] of Object.entries(values))geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,name==='glyphOffset'?2:original.getAttribute(name).itemSize));
      const material=mesh.material.clone(),source=mesh.material.userData.dustSource||mesh.material;
      const releaseTexture=retainRasterTexture(mesh.material,material);
      material.vertexShader=source.vertexShader;material.fragmentShader=source.fragmentShader;
      delete material.userData.dustWind;delete material.userData.dustSource;
      for(const name of Object.keys(material.uniforms))if(name.startsWith('dust'))delete material.uniforms[name];
      const copy=new THREE.Mesh(geometry,material);copy.frustumCulled=false;group.add(copy);sharedGroups.set(key,{mesh:copy,releaseTexture});
    }
    const effect=new TextEditEffect(THREE,{departing:true,mode:exitMode,settings:this.settings});
    effect.jobs=[...(samePath?interrupted:[]),{id:0,seed:this.randomSeed(),range,started:null,fromAge:1,rectangles}];effect.decorate({sharedGroups});effect.uniforms.dustEm.value=em;
    const release=()=>{group.removeFromParent();for(const {mesh,releaseTexture} of sharedGroups.values()){mesh.geometry.dispose();mesh.material.dispose();releaseTexture?.();}effect.dispose();};
    view.scene.parent.add(group);this.ghosts.push({effect,release});this.exits++;this.active=true;return true;
  }
}
