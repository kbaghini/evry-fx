// Hide native text without hiding the canvas or changing layout/raster colors.
// This temporary owner covers cold rich text before its measured runs exist.
export function createTextPaintMask(element,canvas){
  const document=element.ownerDocument,window=document.defaultView,styles=new Map();
  function hold(){
    const parents=new Set(),walker=document.createTreeWalker(element,window.NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(walker.currentNode.data.trim()&&!canvas?.contains(walker.currentNode))parents.add(walker.currentNode.parentElement);
    for(const node of parents){
      let values=styles.get(node);if(!values){values=new Map();styles.set(node,values);}
      for(const [name,value] of [['-webkit-text-fill-color','transparent'],['text-shadow','none']]){
        if(!values.has(name))values.set(name,[node.style.getPropertyValue(name),node.style.getPropertyPriority(name),value]);
        if(node.style.getPropertyValue(name)!==value||node.style.getPropertyPriority(name)!=='important')node.style.setProperty(name,value,'important');
      }
    }
  }
  function release(){
    for(const [node,values] of styles)for(const [name,[original,priority,owned]] of values){
      if(node.style.getPropertyValue(name)!==owned||node.style.getPropertyPriority(name)!=='important')continue;
      if(original)node.style.setProperty(name,original,priority);else node.style.removeProperty(name);
    }
    styles.clear();
  }
  return {hold,release};
}
