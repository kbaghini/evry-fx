// Shared raster -> UV triangle grid for font masks and RGBA images. No color
// averaging, alpha quantization or triangle merging. All filtering is on the GPU.
export function rasterToTextureMesh(rgba,width,height,divisions,{filterRadius=.5,aspect=width/height}={}){
  if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||rgba.length!==width*height*4)throw RangeError('Invalid raster');
  if(!Number.isInteger(divisions)||divisions<1||divisions>256)throw RangeError('Invalid divisions');
  if(!Number.isFinite(filterRadius)||filterRadius<.5)throw RangeError('Invalid texture filter support');
  if(!Number.isFinite(aspect)||aspect<=0)throw RangeError('Invalid grid aspect');
  const rows=divisions,columns=Math.max(1,Math.round(aspect*rows));
  const cw=width/columns,ch=height/rows,occupied=new Uint8Array(rows*columns);
  // Conservative filter support: half a texel for bilinear filtering by default;
  // image surfaces may request the wider footprint used by minified mipmaps.
  // A thin line or isolated pixel cannot be lost to sparse point sampling.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(!rgba[(y*width+x)*4+3])continue;
    const x0=Math.max(0,x-filterRadius),x1=Math.min(width,x+1+filterRadius),y0=Math.max(0,y-filterRadius),y1=Math.min(height,y+1+filterRadius);
    for(let row=Math.floor(y0/ch);row<=Math.min(rows-1,Math.floor(y1/ch));row++)for(let col=Math.floor(x0/cw);col<=Math.min(columns-1,Math.floor(x1/cw));col++){
      const at=row*columns+col;if(occupied[at]===3)continue;
      const left=Math.max(0,x0/cw-col),right=Math.min(1,x1/cw-col),top=Math.max(0,y0/ch-row),bottom=Math.min(1,y1/ch-row);
      const even=(row+col)%2===0;
      if(even?left+top<=1:top<=right)occupied[at]|=1;
      if(even?right+bottom>=1:bottom>=left)occupied[at]|=2;
    }
  }
  let triangleCount=0;for(const bits of occupied)triangleCount+=(bits&1?1:0)+(bits&2?1:0);
  const coordinates=new Float64Array(triangleCount*6),uvs=new Float32Array(triangleCount*6),coverage=new Uint8Array(triangleCount).fill(6);
  let at=0;
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const left=col*cw,right=(col+1)*cw,top=row*ch,bottom=(row+1)*ch,even=(row+col)%2===0;
    for(let side=0;side<2;side++)if(occupied[row*columns+col]&(1<<side)){
      const points=even?[right,top,side?right:left,bottom,left,side?bottom:top]:[left,top,side?left:right,bottom,right,side?bottom:top];
      coordinates.set(points,at);for(let i=0;i<6;i++)uvs[at+i]=points[i]/(i%2?height:width);at+=6;
    }
  }
  return {coordinates,uvs,coverage,triangleCount};
}
