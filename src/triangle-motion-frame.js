// Optional facet metadata for one rectangular surface. Text retains its own
// measured grapheme layout. Prepare once per geometry/frame, never per tick.
const prepared=new WeakMap();
export function ensureTriangleMotionFrame(THREE,geometry,frame,{side=false,floor=false}={}){
  if(!side&&!floor)return;
  const position=geometry.getAttribute('position'),centers=geometry.getAttribute('dustCenter');
  const key=[frame.x,frame.y,frame.width,frame.height].join(':');
  let cache=prepared.get(geometry);
  if(!cache||cache.centers!==centers||cache.position!==position||cache.version!==position.version||cache.key!==key){
    cache={centers,position,version:position.version,key,side:false,floor:false};prepared.set(geometry,cache);
  }
  const needSide=side&&!cache.side,needFloor=floor&&!cache.floor;
  if(!needSide&&!needFloor)return;
  const sides=needSide?new Float32Array(position.count):null;
  const floors=needFloor?new Float32Array(position.count*2):null;
  const ceilings=needFloor?new Float32Array(position.count*4):null;
  for(let i=0;i<position.count;i+=3){
    const x=centers.getX(i),y=centers.getY(i);
    if(sides)sides.fill(Math.max(-1,Math.min(1,2*(x-frame.x)/frame.width-1)),i,i+3);
    if(floors){
      const low=y-Math.min(position.getY(i),position.getY(i+1),position.getY(i+2));
      const high=Math.max(position.getY(i),position.getY(i+1),position.getY(i+2))-y;
      const left=Math.min(position.getX(i),position.getX(i+1),position.getX(i+2))-x;
      const right=Math.max(position.getX(i),position.getX(i+1),position.getX(i+2))-x;
      for(let j=0;j<3;j++){
        floors.set([frame.y,low],(i+j)*2);
        ceilings.set([frame.y+frame.height,left,right,high],(i+j)*4);
      }
    }
  }
  const write=(name,values,size)=>{
    const old=geometry.getAttribute(name);
    if(old?.array.length===values.length){old.array.set(values);old.needsUpdate=true;}
    else geometry.setAttribute(name,new THREE.BufferAttribute(values,size));
  };
  if(sides){write('dustCharacterSide',sides,1);cache.side=true;}
  if(floors){write('dustFloor',floors,2);write('dustCeiling',ceilings,4);cache.floor=true;}
}
