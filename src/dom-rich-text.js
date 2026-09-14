import {HybridTextFlowEngine} from './hybrid-text-flow.js';
import {SharedTextScene} from './text-scene.js';
import {TextEditEffect} from './text-edit-effect.js';
import {adoptDOMFont,domFontAtSize} from './dom-surface-font.js';
import {groupDOMTextNodes,setRunRange,prepareFontBoundaries} from './dom-text-runs.js';

// One scene, independent styled text runs. DOM Range supplies line placement;
// the browser remains responsible for wrapping, links and label semantics.
export class DOMRichText {
  constructor(element,THREE,content,canvas,options){Object.assign(this,{element,THREE,content,canvas,options});this.runs=new Map();this.styles=new Map();this.disposed=false;}
  restore(){for(const [node,values] of this.styles)for(const [name,[original,priority,owned]] of values)if(node.style.getPropertyValue(name)===owned){if(original)node.style.setProperty(name,original,priority);else node.style.removeProperty(name);}this.styles.clear();}
  hide(){for(const run of this.runs.values())for(const text of run.nodes)for(const [name,value] of [['-webkit-text-fill-color','transparent'],['text-shadow','none']]){
    const node=text.parentElement;let values=this.styles.get(node);if(!values){values=new Map();this.styles.set(node,values);}
    if(!values.has(name))values.set(name,[node.style.getPropertyValue(name),node.style.getPropertyPriority(name),value]);
    if(node.style.getPropertyValue(name)!==value)node.style.setProperty(name,value);
  }}
  cancel(){for(const r of this.runs.values())r.effect.cancel();}
  drop(run){run.effect.dispose();run.view.dispose();run.engine.dispose();run.group.removeFromParent();}
  dispose(){this.disposed=true;this.restore();for(const r of this.runs.values())this.drop(r);this.runs.clear();}
  async prepare(cancelled,onRebuild=()=>{}){
    const {element,canvas,THREE}=this,document=element.ownerDocument,window=document.defaultView;
    if(element.isContentEditable||element.matches('input,textarea,select,img,svg'))return {reason:'Rich attachment is for display text only'};
    const raw=[],walker=document.createTreeWalker(element,window.NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const node=walker.currentNode;if(!canvas.contains(node)&&node.data.trim())raw.push(node);}
    const nodes=groupDOMTextNodes(raw,document);
    if([...element.querySelectorAll('input,textarea,select,img,svg,canvas,[contenteditable="true"]')].some(node=>node!==canvas&&!canvas.contains(node)))return {reason:'Rich text currently accepts text elements only'};
    // Shaping across styled-node boundaries needs a shared shaping context.
    if(!prepareFontBoundaries(nodes,document))return {reason:'Unsupported joining boundary uses native shaping'};
    const box=element.getBoundingClientRect(),width=element.clientWidth||box.width,height=element.clientHeight||box.height;
    if(!(width>0&&height>0))return {reason:'Text is not visible'};
    const wanted=new Set(nodes.map(n=>n.first));for(const [node,run] of this.runs)if(!wanted.has(node)){this.restore();this.drop(run);this.runs.delete(node);}
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    for(const node of nodes){
      if(cancelled()||this.disposed)return null;
      const parent=node.parentElement,style=window.getComputedStyle(parent),size=parseFloat(style.fontSize);
      const collapseWhitespace=['normal','nowrap'].includes(style.whiteSpace);
      if(!(size>0)||style.writingMode!=='horizontal-tb'||style.textTransform!=='none'||style.textAlign==='justify'||node.data.includes('\t')&&!collapseWhitespace)return {reason:'Unsupported rich typography uses native text'};
      for(let ancestor=parent;ancestor;ancestor=ancestor.parentElement){
        const css=window.getComputedStyle(ancestor);
        for(const pseudo of ['::before','::after']){const p=window.getComputedStyle(ancestor,pseudo);if(p.display!=='none'&&!['none','normal','""',"''"].includes(p.content))return {reason:'Generated content uses native text'};}
        if(ancestor!==element&&(css.transform!=='none'||css.opacity!=='1'||css.overflowX!=='visible'||css.overflowY!=='visible'))return {reason:'Nested transformed, faded or clipped text uses native text'};
        if(ancestor===element)break;
      }
      let run=this.runs.get(node.first);
      if(!run){const group=new THREE.Group();this.content.add(group);const engine=new HybridTextFlowEngine({scale:.036,divisions:this.options.divisions??'auto',textRendering:'texture'});
        run={node:node.first,group,engine,view:new SharedTextScene(THREE,engine,group),effect:new TextEditEffect(THREE,{mode:'dust-wind'}),key:null};this.runs.set(node.first,run);}
      run.nodes=node.nodes;
      const fontChanged=await adoptDOMFont(run.engine,parent);
      // A newly loaded font can change glyph pixels without changing CSS names,
      // advances or line boxes. Rebind the run to the refreshed raster source.
      if(fontChanged)run.key=null;
      if(cancelled()||this.disposed)return null;
      const factor=size/200,context=run.engine.rasterizer.context;context.font=domFontAtSize(run.engine,size);context.direction=style.direction;
      const spacing=[style.letterSpacing,style.wordSpacing].map(value=>value==='normal'?0:parseFloat(value));
      if(spacing.some(value=>!Number.isFinite(value))||spacing.some((value,i)=>value!==0&&!(['letterSpacing','wordSpacing'][i] in context)))return {reason:'Canvas spacing unavailable; native text retained'};
      const spacingKey=JSON.stringify(spacing.map(value=>value/factor));
      if(run.spacingKey!==spacingKey){run.engine.clearMeshes();run.engine.rasterizer.cache.clear();run.key=null;run.spacingKey=spacingKey;}
      run.engine.rasterizer.letterSpacing=spacing[0]/factor;run.engine.rasterizer.wordSpacing=spacing[1]/factor;
      if('letterSpacing' in context)context.letterSpacing=`${spacing[0]}px`;
      if('wordSpacing' in context)context.wordSpacing=`${spacing[1]}px`;
      const metrics=context.measureText('Hgآی'),rows=[],characters=[];let row=null;
      if(!Number.isFinite(metrics.fontBoundingBoxAscent))return {reason:'Native font metrics unavailable'};
      for(const part of segmenter.segment(node.data)){
        const range=document.createRange();setRunRange(range,node,part.index,part.index+part.segment.length);
        const rect=range.getBoundingClientRect();if(!rect.width||!rect.height)continue;
        const top=rect.top-box.top-element.clientTop;
        if(!row||Math.abs(row.top-top)>.75){row={start:part.index,end:part.index,top,left:Infinity,right:-Infinity,direction:style.direction,baseline:top+(rect.height+metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2};rows.push(row);}
        row.end=part.index+part.segment.length;row.left=Math.min(row.left,rect.left-box.left-element.clientLeft);row.right=Math.max(row.right,rect.right-box.left-element.clientLeft);
        const unit=run.engine.scale/factor;
        characters.push({x:(rect.left-box.left-element.clientLeft)*unit,y:-(row.baseline+metrics.fontBoundingBoxDescent)*unit,width:rect.width*unit,height:(metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent)*unit,direction:style.direction});
      }
      for(const r of rows){
        // Preserve original offsets for DOM Range/color mapping; normalize only
        // the raster string when CSS collapses ASCII whitespace. NBSP and
        // preformatted spacing are deliberately untouched.
        let text=node.data.slice(r.start,r.end);
        if(collapseWhitespace)text=text.replace(/[ \t\r\n\f]+/g,' ');
        r.text=(r.start===0&&node.joinStart?'\u200d':'')+text+(r.end===node.data.length&&node.joinEnd?'\u200d':'');
        const expected=context.measureText(r.text).width;if(Math.abs(expected-(r.right-r.left))>Math.max(1,expected*.015))return {reason:'Rich run shaping differs from DOM; native text retained'};
      }
      run.engine.rasterizer.configure();const layout={rows,factor};
      const paints=node.nodes.map(text=>({text,color:window.getComputedStyle(text.parentElement).color}));
      const multicolor=new Set(paints.map(p=>p.color)).size>1;
      const key=JSON.stringify([node.data,size,run.engine.domFont.key,rows,paints.map(p=>p.color)]);
      if(key!==run.key){onRebuild();run.effect.cancel();run.engine.setDisplayFontSize(size);await run.engine.prepareRows(layout,{cancelled});if(cancelled()||this.disposed)return null;
        if(multicolor)for(let i=0;i<rows.length;i++){
          const row=rows[i],entry=run.engine.flowLayout.entries[i],item=entry.metrics.items[0],glyph=item.glyph;
          const spans=[];let offset=0;
          for(const paint of paints){const start=Math.max(row.start,offset),end=Math.min(row.end,offset+paint.text.length);offset+=paint.text.length;if(end<=start)continue;
            const range=document.createRange();setRunRange(range,node,start,end);
            const color=new THREE.Color().setStyle(paint.color).convertLinearToSRGB();
            for(const rect of range.getClientRects())if(Math.abs(rect.top-box.top-element.clientTop-row.top)<.75)spans.push({left:rect.left-box.left-element.clientLeft,right:rect.right-box.left-element.clientLeft,color});
          }
          const source=glyph.rasterSurface,rgba=new Uint8ClampedArray(source.rgba);
          for(let x=0;x<source.width;x++){
            const px=row.left+(x+.5-glyph.drawOffsetX)*factor;
            let nearest=null,distance=Infinity;for(const span of spans){const d=Math.max(span.left-px,px-span.right,0);if(d<distance){distance=d;nearest=span;}}
            if(nearest)for(let y=0;y<source.height;y++){const p=(y*source.width+x)*4;rgba[p]=Math.round(nearest.color.r*255);rgba[p+1]=Math.round(nearest.color.g*255);rgba[p+2]=Math.round(nearest.color.b*255);}
          }
          // A presentation-owned copy preserves the engine's reusable alpha raster.
          item.glyph={...glyph,rasterSurface:{...source,rgba,mask:false}};
        }
        run.view.setText(node.data);run.key=key;}
      run.group.scale.setScalar(factor/run.engine.scale);run.view.uniforms.tint.value.setStyle(multicolor?'white':style.color);run.size=size;run.characters=characters;
    }
    return {width,height,size:parseFloat(window.getComputedStyle(element).fontSize),factor:.036,text:nodes.map(n=>n.data).join(''),direction:window.getComputedStyle(element).direction,characters:[]};
  }
  play(phase,mode,settings,seed,now){for(const run of this.runs.values()){
    run.effect.cancel();if(mode==='none')continue;
    run.effect.setMode(phase==='exit'&&settings.exitEffect!=='same'?settings.exitEffect:mode);run.effect.configure(settings);
    const b=run.view.bounds;run.effect.playRegion(run.view,{x:b.minX-.001,y:b.minY-.001,width:b.maxX-b.minX+.002,height:b.maxY-b.minY+.002,direction:run.engine.domFont?run.node.parentElement.ownerDocument.defaultView.getComputedStyle(run.node.parentElement).direction:'ltr'},200*run.engine.scale,now,{departing:phase==='exit',seed});
    run.effect.prepareCharacterCenters(run.view,()=>run.characters);
  }}
  step(now,reduced){let active=false;for(const run of this.runs.values())active=run.effect.step(now,reduced)||active;return active;}
  stats(){return {runs:this.runs.size,triangles:[...this.runs.values()].reduce((n,r)=>n+(r.view.triangleCount??0),0),active:[...this.runs.values()].some(r=>r.effect.active)};}
}



