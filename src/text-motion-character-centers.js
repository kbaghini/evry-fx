// Optional per-facet position and frame within a measured grapheme. Whole lines
// may share one mesh, so its bounding-box center is not a character center.
// Prepared on layout changes, never in the render loop. Ghosts retain this data.
export function setTextMotionCharacterCenters(THREE,view,rectangles,{floor=false,frame=false}={}){
  const rows=new Map();
  for(const r of rectangles){
    if(!(r.width>0&&r.height>0))continue;
    const key=r.y+':'+r.height;
    if(!rows.has(key))rows.set(key,{bottom:r.y,top:r.y+r.height,cells:[]});
    rows.get(key).cells.push({left:r.x,right:r.x+r.width,mid:r.x+r.width/2});
  }
  const ordered=[...rows.values()].sort((a,b)=>a.bottom-b.bottom);
  for(const row of ordered)row.cells.sort((a,b)=>a.left-b.left||a.right-b.right);
  for(const {mesh} of view.sharedGroups?.values()||[]){
    const g=mesh.geometry,centers=g.getAttribute('dustCenter'),offset=g.getAttribute('glyphOffset');
    if(!centers||!offset||!centers.count)continue;
    const ox=offset.getX(0),oy=offset.getY(0),values=new Float32Array(centers.count);
    const frames=frame?new Float32Array(centers.count*4):null;
    const floors=floor?new Float32Array(centers.count*2):null,position=g.getAttribute('position');
    const ceilings=floor?new Float32Array(centers.count*4):null;
    const box=g.boundingBox||(g.computeBoundingBox(),g.boundingBox);
    const fallbackMid=(box.min.x+box.max.x)/2,fallbackWidth=box.max.x-box.min.x;
    // Identical instanced glyphs use the same local character layout. Row choice
    // is made using their first instance; offsets are not baked into the result.
    const baseline=oy+(box.min.y+box.max.y)/2;
    let row=ordered.find(r=>baseline>=r.bottom&&baseline<=r.top);
    if(!row&&ordered.length)row=ordered.reduce((a,b)=>Math.abs((a.bottom+a.top)/2-baseline)<Math.abs((b.bottom+b.top)/2-baseline)?a:b);
    for(let i=0;i<centers.count;i+=3){
      const x=centers.getX(i)+ox,cells=row?.cells;let cell;
      if(cells?.length){
        let lo=0,hi=cells.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(cells[mid].left<=x)lo=mid+1;else hi=mid;}
        cell=cells[Math.max(0,lo-1)];
        if(x>cell.right&&lo<cells.length&&Math.abs(cells[lo].mid-x)<Math.abs(cell.mid-x))cell=cells[lo];
      }
      const side=cell?(x-cell.mid)/Math.max((cell.right-cell.left)/2,.000001):(centers.getX(i)-fallbackMid)/Math.max(fallbackWidth/2,.000001);
      values.fill(Math.max(-1,Math.min(1,side)),i,i+3);
      if(frames){
        // A single measured grapheme/line frame, not a square grid through its
        // ink. Keep it local so identical instances and deletion ghosts agree.
        const bounds=[cell?cell.left-ox:box.min.x,row?row.bottom-oy:box.min.y,
          Math.max(cell?cell.right-cell.left:fallbackWidth,.000001),
          Math.max(row?row.top-row.bottom:box.max.y-box.min.y,.000001)];
        for(let j=0;j<3;j++)frames.set(bounds,(i+j)*4);
      }
      if(floors){
        // Contact uses the lowest vertex, not the centroid. Keep facets rigid,
        // and preserve the measured font-line bottom through partial deletion.
        const support=centers.getY(i)-Math.min(position.getY(i),position.getY(i+1),position.getY(i+2));
        for(let j=0;j<3;j++){floors[(i+j)*2]=row?row.bottom-oy:box.min.y;floors[(i+j)*2+1]=support;}
        const left=Math.min(position.getX(i),position.getX(i+1),position.getX(i+2))-centers.getX(i);
        const right=Math.max(position.getX(i),position.getX(i+1),position.getX(i+2))-centers.getX(i);
        const upper=Math.max(position.getY(i),position.getY(i+1),position.getY(i+2))-centers.getY(i);
        for(let j=0;j<3;j++)ceilings.set([row?row.top-oy:box.max.y,left,right,upper],(i+j)*4);
      }
    }
    const existing=g.getAttribute('dustCharacterSide');
    if(existing?.count===values.length){existing.array.set(values);existing.needsUpdate=true;}
    else g.setAttribute('dustCharacterSide',new THREE.BufferAttribute(values,1));
    if(frames){
      const previous=g.getAttribute('dustCharacterFrame');
      if(previous?.count===centers.count){previous.array.set(frames);previous.needsUpdate=true;}
      else g.setAttribute('dustCharacterFrame',new THREE.BufferAttribute(frames,4));
    }
    if(floors){
      const previous=g.getAttribute('dustFloor');
      if(previous?.count===centers.count){previous.array.set(floors);previous.needsUpdate=true;}
      else g.setAttribute('dustFloor',new THREE.BufferAttribute(floors,2));
      const ceiling=g.getAttribute('dustCeiling');
      if(ceiling?.count===centers.count){ceiling.array.set(ceilings);ceiling.needsUpdate=true;}
      else g.setAttribute('dustCeiling',new THREE.BufferAttribute(ceilings,4));
    }
  }
}
