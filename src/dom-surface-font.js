import {FontRasterizer} from './font-rasterizer.js';
import {domRasterCache} from './dom-raster-cache.js';

const owners=new WeakMap();
export function readDOMFont(element){
  const style=element.ownerDocument.defaultView.getComputedStyle(element);
  const font={family:style.fontFamily,weight:Number(style.fontWeight)||400,style:style.fontStyle,kerning:style.fontKerning,textRendering:style.textRendering};
  font.key=JSON.stringify([font.family,font.weight,font.style,font.kerning,font.textRendering]);return font;
}
export function domFontAtSize(engine,size){
  const font=engine.domFont;
  return font?`${font.style} ${font.weight} ${size}px ${font.family}`:`${engine.weight} ${size}px "${engine.face.family}"`;
}
export function matchesDOMFont(engine,style){
  return engine.domFont?engine.domFont.family===style.fontFamily&&engine.domFont.weight===(Number(style.fontWeight)||400)&&engine.domFont.style===style.fontStyle
    :style.fontFamily.includes(engine.face.family)&&Number(style.fontWeight)===engine.weight;
}

// Borrow the host's CSS font stack. Never register, replace or delete its FontFace.
export async function adoptDOMFont(engine,element){
  let owner=owners.get(engine);
  if(!owner){
    owner={sequence:0,disposed:false};owners.set(engine,owner);
    const dispose=engine.dispose.bind(engine);
    engine.dispose=()=>{owner.disposed=true;owner.sequence++;if(engine.domFont)engine.face=null;dispose();};
  }
  const next=readDOMFont(element);
  const document=element.ownerDocument,shared=domRasterCache(document);
  if(owner.disposed||next.key===engine.domFont?.key&&owner.epoch===shared.epoch)return false;
  const sequence=++owner.sequence,started=performance.now();
  await shared.font(next.key,()=>document.fonts?.load(`${next.style} ${next.weight} 16px ${next.family}`,'ABCآبپچگژهمی'));
  if(owner.disposed||sequence!==owner.sequence||readDOMFont(element).key!==next.key)return false;
  const rasterizer=Object.create(FontRasterizer.prototype);
  rasterizer.canvas=document.createElement('canvas');
  rasterizer.context=rasterizer.canvas.getContext('2d',{willReadFrequently:true});
  if(!rasterizer.context)throw Error('Canvas font rasterization unavailable');
  rasterizer.font=`${next.style} ${next.weight} 200px ${next.family}`;rasterizer.cache=new Map();rasterizer.fontKerning=next.kerning;rasterizer.textRendering=next.textRendering;rasterizer.configure();
  const metric=rasterizer.context.measureText('آبپچگژهمیABCgj');
  rasterizer.ascent=Math.ceil(Math.max(metric.fontBoundingBoxAscent||0,metric.actualBoundingBoxAscent||0));
  rasterizer.descent=Math.ceil(Math.max(metric.fontBoundingBoxDescent||0,metric.actualBoundingBoxDescent||0));
  rasterizer.raster=function(text,direction='ltr'){
    const key=JSON.stringify([this.font,this.displayFontSize,this.fontKerning,this.textRendering,this.ascent,this.descent,this.letterSpacing||0,this.wordSpacing||0,direction,text]);
    return shared.raster(key,()=>{this.cache.clear();return FontRasterizer.prototype.raster.call(this,text,direction);});
  };
  owner.epoch=shared.epoch;
  engine.domFont=next;engine.face={family:next.family};engine.weight=next.weight;engine.rasterizer=rasterizer;engine.clearMeshes();
  const ascent=rasterizer.ascent+2,descent=rasterizer.descent+2;
  engine.fontMetrics={ascent,descent,height:ascent+descent};engine.lineAdvance=engine.fontMetrics.height*Math.max(1,engine.lineHeight);
  engine.fontLoadMs=performance.now()-started;return true;
}
