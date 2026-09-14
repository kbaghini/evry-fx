import {DIVISIONS} from './mesh-generator-core.js';

// Density is measured in CSS pixels, independent of DPR, text length and color.
// One nominal 16px em uses 16 rows. Above that, square-root density growth
// makes a full 2D grid grow linearly with font size, not its square.
export function normalizeTextMeshOptions({textRendering='texture',divisions=textRendering==='texture'?'auto':36}={}){
  if(!['coverage','texture'].includes(textRendering))throw TypeError('Invalid textRendering');
  const valid=textRendering==='texture'?(divisions==='auto'||Number.isInteger(divisions)&&divisions>=1&&divisions<=256):DIVISIONS.includes(divisions);
  if(!valid)throw TypeError('Invalid text mesh divisions');
  return {textRendering,divisions};
}

export function textDivisionsForSize(fontSize,current=null){
  if(!Number.isFinite(fontSize)||fontSize<=0)return current??16;
  // Small text never retains a denser grid through hysteresis. One row is the
  // minimum valid grid, including for subpixel em sizes.
  if(fontSize<16)return Math.max(1,Math.floor(fontSize));
  const target=Math.min(72,16*Math.sqrt(fontSize/16));
  if(current>=16&&current<=72&&Math.abs(target-current)<=Math.max(1,current*.10))return current;
  return Math.min(72,2*Math.round(target/2));
}

// A transformed local em projected into the current viewport, in CSS pixels.
// Reuse scratch vectors: this helper is evaluated on requested frames only.
export function createProjectedTextSize(THREE){
  const origin=new THREE.Vector3(),x=new THREE.Vector3(),y=new THREE.Vector3();
  return (object,camera,canvas,em)=>{
    const width=canvas.clientWidth,height=canvas.clientHeight;if(!width||!height)return 0;
    object.updateWorldMatrix(true,false);camera.updateMatrixWorld(true);
    origin.set(0,0,0).applyMatrix4(object.matrixWorld).project(camera);
    if(origin.z< -1||origin.z>1)return 0;
    x.set(em,0,0).applyMatrix4(object.matrixWorld).project(camera);
    y.set(0,em,0).applyMatrix4(object.matrixWorld).project(camera);
    return Math.max(Math.hypot((x.x-origin.x)*width/2,(x.y-origin.y)*height/2),Math.hypot((y.x-origin.x)*width/2,(y.y-origin.y)*height/2));
  };
}
