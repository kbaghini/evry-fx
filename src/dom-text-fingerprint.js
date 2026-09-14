// Validate native layout with whole-node line boxes before the expensive
// per-grapheme placement pass. Coordinates are relative to the slot, so page
// scrolling does not invalidate text geometry. Node identity matters: identical
// replacement markup still needs fresh run references.
const fields=['display','visibility','fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontFeatureSettings','fontVariationSettings','fontKerning','fontVariant','fontOpticalSizing','lineHeight','direction','unicodeBidi','whiteSpace','letterSpacing','wordSpacing','verticalAlign','textAlign','textIndent','textTransform','textDecorationLine','writingMode','textOrientation','wordBreak','overflowWrap','hyphens','tabSize','opacity','transform','overflowX','overflowY','color'];
export function createDOMTextFingerprint(element,canvas){
  const document=element.ownerDocument,window=document.defaultView,ids=new WeakMap();let sequence=0;
  const id=node=>{if(!ids.has(node))ids.set(node,++sequence);return ids.get(node);};
  return ()=>{
    const box=element.getBoundingClientRect(),left=box.left+element.clientLeft,top=box.top+element.clientTop;
    const parts=[element.isConnected,element.clientWidth||box.width,element.clientHeight||box.height,element.clientLeft,element.clientTop];
    function visit(node){
      if(node===canvas)return;
      if(node.nodeType===3){
        const range=document.createRange();range.selectNodeContents(node);
        parts.push(['text',id(node),node.data,[...range.getClientRects()].map(r=>[r.left-left,r.top-top,r.width,r.height])]);return;
      }
      if(node.nodeType!==1)return;
      const style=window.getComputedStyle(node);
      parts.push(['element',id(node),node.localName,node.isContentEditable,fields.map(name=>style[name])]);
      for(const pseudo of ['::before','::after']){const css=window.getComputedStyle(node,pseudo);parts.push([css.display,css.content]);}
      for(const child of node.childNodes)visit(child);
      parts.push('end');
    }
    visit(element);return JSON.stringify(parts);
  };
}
