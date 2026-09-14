import {RuntimeFontEngine} from './runtime-font-engine.js';
import {documentDirection} from './text-direction.js';

// Read the real semantic text node. No mirror editor, layout guesses, or HTML parsing.
export function measureHybridTextFlow(element,labelNode,engine){
  const document=element.ownerDocument,style=document.defaultView.getComputedStyle(element),px=value=>parseFloat(value)||0;
  const fontSize=px(style.fontSize),factor=fontSize/200,context=engine.rasterizer.context,box=element.getBoundingClientRect();
  context.font=`${engine.weight} ${fontSize}px "${engine.face.family}"`;const metric=context.measureText('Hgآی');engine.rasterizer.configure();
  const ascent=metric.fontBoundingBoxAscent,descent=metric.fontBoundingBoxDescent;
  const supported=factor>0&&Number.isFinite(ascent)&&style.fontFamily.includes(engine.face.family)&&Number(style.fontWeight)===engine.weight&&style.fontStyle==='normal'&&style.textTransform==='none'
    &&['normal','0px'].includes(style.letterSpacing)&&['normal','0px'].includes(style.wordSpacing)&&!labelNode.textContent.includes('\t')&&style.textAlign!=='justify';
  if(!supported)return {supported:false};
  const node=labelNode.firstChild,range=document.createRange(),rows=[],text=labelNode.textContent;
  const segments=new Intl.Segmenter(undefined,{granularity:'grapheme'});let offset=0;
  for(const paragraph of text.split('\n')){
    const direction=element.dir==='auto'?documentDirection(paragraph,style.direction):style.direction;let row=null;
    for(const part of segments.segment(paragraph)){
      const start=offset+part.index,end=start+part.segment.length;range.setStart(node,start);range.setEnd(node,end);const rects=[...range.getClientRects()];const rect=rects.find(r=>r.height>0);if(!rect)continue;
      const top=rect.top-box.top-element.clientTop;
      if(!row||Math.abs(row.top-top)>.75){if(row)rows.push(row);row={start,end,top,left:Infinity,right:-Infinity,direction,baseline:top+(rect.height+ascent-descent)/2};}else row.end=end;
      for(const r of rects){row.left=Math.min(row.left,r.left-box.left-element.clientLeft);row.right=Math.max(row.right,r.right-box.left-element.clientLeft);}
    }
    if(row)rows.push(row);offset+=paragraph.length+1;
  }
  for(const row of rows)row.text=text.slice(row.start,row.end);
  const key=JSON.stringify([text,element.clientWidth,element.clientHeight,fontSize,rows.map(r=>[r.start,r.end,Math.round(r.left*64)/64,Math.round(r.baseline*64)/64,r.direction])]);
  return {supported:true,rows,factor,key};
}

// Reuse rasterization, mesh generation, LRU accounting and shared glyph scene.
// Only line placement is supplied by the DOM's actual wrapping and bidi layout.
export class HybridTextFlowEngine extends RuntimeFontEngine{
  async prepareRows(layout,{cancelled=()=>false}={}){
    const nextCache=new Map(),entries=[];let slice=performance.now();
    try{for(const row of layout.rows){
      if(cancelled())return null;const item={ch:row.text,i:0,form:0,key:`flow:${row.direction}:${row.text}`,rasterText:row.text,direction:row.direction};this.ensureGlyph(item);
      const glyph=this.records.get(item.key+':0'),metrics={text:row.text,items:[{...item,glyph,x:row.left/layout.factor}],utf16Offsets:[0],height:this.fontMetrics.height};
      nextCache.set(item.key,metrics);entries.push({metrics,offset:row.start,length:row.text.length,baseline:this.fontMetrics.ascent-row.baseline/layout.factor});
      if(performance.now()-slice>4){await new Promise(r=>setTimeout(r,0));slice=performance.now();}
    }
    if(cancelled())return null;this.lineCache=nextCache;this.flowLayout={entries};return this.flowLayout;
    }finally{this.trimCache();}
  }
  layout(){return this.flowLayout||{entries:[]};}
}
