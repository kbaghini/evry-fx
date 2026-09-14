// Optional contour distances on the existing de-indexed triangle mesh. No font
// rasterization, geometry copies or frame-time work. Opposite-edge distances
// interpolate into a continuous border, excluding internal shared diagonals.
export function ensureTextMotionContour(THREE,geometry){
  if(geometry.getAttribute('dustEdge'))return geometry.getAttribute('dustEdge');
  const positions=geometry.getAttribute('position'),edges=new Map(),keys=[];
  for(let i=0;i<positions.count;i++)keys.push(`${positions.getX(i)},${positions.getY(i)}`);
  const edgeKey=(a,b)=>keys[a]<keys[b]?keys[a]+'|'+keys[b]:keys[b]+'|'+keys[a];
  for(let i=0;i<positions.count;i+=3)for(let k=0;k<3;k++){
    const key=edgeKey(i+(k+1)%3,i+(k+2)%3);edges.set(key,(edges.get(key)||0)+1);
  }
  const distances=new Float32Array(positions.count*3).fill(1e6);
  for(let i=0;i<positions.count;i+=3)for(let k=0;k<3;k++){
    const a=i+(k+1)%3,b=i+(k+2)%3;
    if(edges.get(edgeKey(a,b))!==1)continue;
    const dx=positions.getX(b)-positions.getX(a),dy=positions.getY(b)-positions.getY(a),length=Math.hypot(dx,dy);
    if(length===0)continue;
    const altitude=Math.abs(dx*(positions.getY(i+k)-positions.getY(a))-dy*(positions.getX(i+k)-positions.getX(a)))/length;
    for(let vertex=0;vertex<3;vertex++)distances[(i+vertex)*3+k]=vertex===k?altitude:0;
  }
  const attribute=new THREE.BufferAttribute(distances,3);geometry.setAttribute('dustEdge',attribute);return attribute;
}
