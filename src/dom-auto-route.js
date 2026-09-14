// Deliberately bounded policy: registered dialog roots, ordinary page, or local
// CSS composition. Never infer stacking layers from z-index or create new roots.
export function chooseDOMPresentation(element,layers,readStyle=node=>node.ownerDocument.defaultView.getComputedStyle(node)){
  const document=element.ownerDocument,window=document.defaultView;
  let layer=null,reason='ordinary page';
  if(document.fullscreenElement)return {presentation:'local',layer:null,reason:'fullscreen'};
  for(let node=element;node;node=node.parentElement){
    const style=readStyle(node);
    if(node!==document.body&&node!==document.documentElement){
      if(['fixed','sticky'].includes(style.position))return {presentation:'local',layer:null,reason:'fixed or sticky container'};
      if(!node.matches('dialog')&&style.position!=='static'&&style.zIndex!=='auto')return {presentation:'local',layer:null,reason:'explicit stacking context'};
      if(node!==element&&/(auto|scroll)/.test(style.overflowX+' '+style.overflowY))return {presentation:'local',layer:null,reason:'nested scroll container'};
    }
    if(style.transform!=='none'||style.perspective!=='none'||style.rotate&&style.rotate!=='none'&&style.rotate!=='0deg'||style.scale&&style.scale!=='none'||style.clipPath&&style.clipPath!=='none'||style.maskImage&&style.maskImage!=='none')
      return {presentation:'local',layer:null,reason:'CSS transform or mask'};
    if(layer===null&&node.matches('dialog')){
      const entry=[...layers].find(([,value])=>value.root===node);
      if(!entry||!node.open)return {presentation:'local',layer:null,reason:entry?'closed dialog':'unregistered dialog'};
      layer=entry[0];reason='registered dialog';
    }
    if(node.hasAttribute('popover')&&node.matches(':popover-open'))return {presentation:'local',layer:null,reason:'popover'};
  }
  return {presentation:'global',layer,reason};
}

