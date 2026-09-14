// Pair only complementary axis-aligned grid triangles. Geometry/UVs stay intact.
export function particleCenters(THREE,geometry,shape){
  const position=geometry.getAttribute('position');
  let cache=geometry.userData.particleCenters;
  if(shape!=='square'&&(!cache||cache.position!==position||cache.version!==position.version)){
    const triangle=new Float32Array(position.count*2);
    for(let i=0;i<position.count;i+=3){
      const x=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3;
      const y=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3;
      for(let j=0;j<3;j++){triangle[(i+j)*2]=x;triangle[(i+j)*2+1]=y;}
    }
    cache={position,version:position.version,triangle,square:null,pairs:[]};
    geometry.userData.particleCenters=cache;
  }
  if(!cache||cache.position!==position||cache.version!==position.version||shape==='square'&&!cache.square){
    const cachePairs=[];const triangle=new Float32Array(position.count*2),square=new Float32Array(position.count*2),cells=new Map();
    for(let i=0;i<position.count;i+=3){
      const xs=[0,1,2].map(j=>position.getX(i+j)),ys=[0,1,2].map(j=>position.getY(i+j));
      const x=xs.reduce((a,b)=>a+b)/3,y=ys.reduce((a,b)=>a+b)/3;
      for(let j=0;j<3;j++)triangle.set([x,y],(i+j)*2);
      const left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys);
      if(right===left||top===bottom||xs.some(v=>v!==left&&v!==right)||ys.some(v=>v!==bottom&&v!==top))continue;
      const corners=new Set(xs.map((v,j)=>(v===right?1:0)+(ys[j]===top?2:0)));
      if(corners.size!==3)continue;
      const key=[left,right,bottom,top,position.getZ(i)].join(':');
      const old=cells.get(key);
      if(old&&new Set([...old.corners,...corners]).size===4){
        cells.delete(key);
        for(const at of [old.index,i])for(let j=0;j<3;j++)square.set([(left+right)/2,(bottom+top)/2],(at+j)*2);
        cachePairs.push([old.index,i]);
      }else cells.set(key,{index:i,corners});
    }

    cache={position,version:position.version,triangle,square,pairs:cachePairs};
    const paired=new Set(cachePairs.flat());for(let i=0;i<position.count;i+=3)if(!paired.has(i))square.set(triangle.subarray(i*2,(i+3)*2),i*2);
    geometry.userData.particleCenters=cache;
  }
  if(cache.shape!==shape||!geometry.getAttribute('dustCenter')){
    geometry.setAttribute('dustCenter',new THREE.BufferAttribute(shape==='square'?cache.square:cache.triangle,2));cache.shape=shape;
  }
  if(geometry.getAttribute('dustCornerA')&&cache.cornerShape!==shape){
    for(const name of ['dustCornerA','dustCornerB','dustCornerC']){
      const a=geometry.getAttribute(name);cache[name]??=a.array.slice();a.array.set(cache[name]);
      if(shape==='square')for(const [first,second] of cache.pairs)for(let j=0;j<3;j++)a.array.set(cache[name].subarray(first*3,first*3+3),(second+j)*3);
      a.needsUpdate=true;
    }
    cache.cornerShape=shape;
  }
  return cache;
}
