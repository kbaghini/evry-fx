import {JOINING_FORMS} from './font-mesh-engine.js';
// Color may differ: shape together, then paint the shared raster by native ranges.
// Keeping real Text nodes allows Range to remain the placement oracle.
export function groupDOMTextNodes(nodes,document){
  const fields=['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontFeatureSettings','fontVariationSettings','direction','unicodeBidi','whiteSpace','letterSpacing','wordSpacing','verticalAlign','opacity','transform','overflowX','overflowY','textDecorationLine'];
  const groups=[];
  for(const node of nodes){
    const style=document.defaultView.getComputedStyle(node.parentElement),key=fields.map(k=>style[k]).join('|'),previous=groups.at(-1);
    let adjacent=false;
    if(previous&&previous.key===key){
      const last=previous.nodes.at(-1),a=last.parentElement,b=node.parentElement;
      const sameContainer=a===b||a.parentElement===b.parentElement&&style.display==='inline'&&document.defaultView.getComputedStyle(a).display==='inline';
      if(sameContainer){const gap=document.createRange();gap.setStart(last,last.length);gap.setEnd(node,0);const fragment=gap.cloneContents();adjacent=!fragment.textContent&&!fragment.querySelector('br,hr,img,svg');}
    }
    if(adjacent){previous.nodes.push(node);previous.data+=node.data;}
    else groups.push({first:node,parentElement:node.parentElement,nodes:[node],data:node.data,key});
  }
  return groups;
}
// Bounded Persian font and weight boundaries: preserve joining form without altering DOM.
// Ligatures spanning the boundary and unknown letters stay native.
export function prepareFontBoundaries(groups,document){
  for(let i=1;i<groups.length;i++){
    const a=groups[i-1],b=groups[i];
    if(!/[\u0600-\u06ff]$/.test(a.data)||! /^[\u0600-\u06ff]/.test(b.data))continue;
    const left=Array.from(a.data.replace(/\p{Mark}+$/u,'')).at(-1),right=Array.from(b.data)[0];
    const x=document.defaultView.getComputedStyle(a.parentElement),y=document.defaultView.getComputedStyle(b.parentElement);
    const ak=a.key.split('|'),bk=b.key.split('|');ak[0]=bk[0]=ak[2]=bk[2]='';
    const range=document.createRange();range.setStart(a.nodes.at(-1),a.nodes.at(-1).length);range.setEnd(b.first,0);const gap=range.cloneContents();
    if(ak.join('|')!==bk.join('|')||x.fontWeight===y.fontWeight&&x.fontFamily===y.fontFamily||x.display!=='inline'||y.display!=='inline'||a.parentElement.parentElement!==b.parentElement.parentElement||gap.textContent||gap.querySelector('br,hr,img,svg')||!JOINING_FORMS[left]||!JOINING_FORMS[right]||left==='ل'&&'اأإآ'.includes(right))return false;
    if(JOINING_FORMS[left].length>2){a.joinEnd=true;b.joinStart=true;}
  }
  return true;
}
export function setRunRange(range,group,start,end){
  let offset=0,startSet=false;
  for(const node of group.nodes){const next=offset+node.length;
    if(!startSet&&start<next){range.setStart(node,start-offset);startSet=true;}
    if(startSet&&end<=next){range.setEnd(node,end-offset);return;}
    offset=next;
  }
  throw RangeError('Text run range is outside its native nodes');
}


