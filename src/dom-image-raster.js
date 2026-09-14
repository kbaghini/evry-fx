import {imageRasterSource} from './image-source.js';
// Capture the supported native image box, including cover/contain and radii.
export async function rasterizeDOMImage(element,{maxSide=2048}={}){
  const start=performance.now();
  const doc=element.ownerDocument,css=doc.defaultView.getComputedStyle(element),box=element.getBoundingClientRect();
  if(!box.width||!box.height)throw Error('Image not visible');
  const scale=Math.min(2,maxSide/Math.max(box.width,box.height),Math.sqrt(2097152/(box.width*box.height))),canvas=doc.createElement('canvas');
  canvas.width=Math.max(1,Math.round(box.width*scale));canvas.height=Math.max(1,Math.round(box.height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});context.scale(canvas.width/box.width,canvas.height/box.height);
  try{
  const radii=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>{
    const parts=css[key].split(/\s+/),read=(s,n)=>parseFloat(s)*(s.endsWith('%')?n/100:1);
    return {x:read(parts[0],box.width),y:read(parts[1]??parts[0],box.height)};
  });
  context.beginPath();context.roundRect(0,0,box.width,box.height,radii);context.clip();
  const factor=css.objectFit==='cover'?Math.max(box.width/element.naturalWidth,box.height/element.naturalHeight):Math.min(box.width/element.naturalWidth,box.height/element.naturalHeight);
  const w=css.objectFit==='fill'?box.width:element.naturalWidth*factor,h=css.objectFit==='fill'?box.height:element.naturalHeight*factor;
  context.drawImage(element,(box.width-w)/2,(box.height-h)/2,w,h);
  const width=canvas.width,height=canvas.height,rgba=context.getImageData(0,0,width,height).data;
  return {source:imageRasterSource({width,height,rgba,mask:false,type:'image/png',originalWidth:width,originalHeight:height,decodeMs:performance.now()-start}),width,height};
  }finally{canvas.width=canvas.height=0;}
}
