// Place the next native image over the previous image; animate transiently.
export function swapDOMImage(animate,previous,next,{exitEffect=null,waitForExit=false,enterEffect=true,topImage='next',...options}={}){
  if(!['previous','next'].includes(topImage))throw TypeError('Expected previous or next topImage');
  if(previous===next||previous?.tagName!=='IMG'||next?.tagName!=='IMG'||!previous.parentElement)throw TypeError('Two different IMG elements are required');
  const previousVisibility=previous.style.visibility,previousPosition=previous.style.position,previousZ=previous.style.zIndex;let cancelled=false,jobs=[];const parent=previous.parentElement,origin=next.parentNode,sibling=next.nextSibling,css=next.style.cssText,parentPosition=parent.style.position;
  const finished=(async()=>{try{await Promise.all([previous.decode(),next.decode()]);if(cancelled)return {status:'cancelled'};
    const view=previous.ownerDocument.defaultView,box=previous.getBoundingClientRect();if(view.getComputedStyle(parent).position==='static')parent.style.position='relative';const bounds=parent.getBoundingClientRect();
    parent.append(next);Object.assign(next.style,{position:'absolute',left:(box.left-bounds.left-parent.clientLeft+parent.scrollLeft)+'px',top:(box.top-bounds.top-parent.clientTop+parent.scrollTop)+'px',width:box.width+'px',height:box.height+'px',margin:'0',visibility:'hidden'});
    if(view.getComputedStyle(previous).position==='static')previous.style.position='relative';previous.style.zIndex=topImage==='previous'?'1':'0';next.style.zIndex=topImage==='next'?'1':'0';
    // Local layers preserve the native next image above a departing canvas too.
    // A departing previous image can use the shared canvas above the native
    // next image. Forcing local here clips particles to the rounded host.
    const departingOverNative=!enterEffect&&topImage==='previous';
    const layerOptions=!departingOverNative&&(!enterEffect||topImage==='previous')?{...options,presentation:'local'}:options;
    const beginEntry=()=>{next.style.visibility='visible';if(enterEffect)jobs.push(animate(next,{...layerOptions,phase:'enter'}));};
    const earlyEntry=!enterEffect||(!waitForExit&&topImage==='previous');if(earlyEntry)beginEntry();
    if(exitEffect){
      const exit=animate(previous,{...layerOptions,inputEffect:exitEffect,phase:'exit'});jobs.push(exit);
      if(waitForExit){const result=await exit.finished;if(cancelled||result.status!=='completed'){rollback();return {status:cancelled?'cancelled':result.status};}}
    }
    if(!earlyEntry)beginEntry();
    const results=await Promise.all(jobs.map(job=>job.finished));const success=!cancelled&&results.every(r=>r.status==='completed');
    if(success){previous.style.visibility='hidden';return {status:'completed'};}
    rollback();return {status:cancelled?'cancelled':'unsupported'};
  }catch(error){jobs.forEach(j=>j.cancel());rollback();throw error;}})();
  function rollback(){previous.style.position=previousPosition;previous.style.zIndex=previousZ;previous.style.visibility=previousVisibility;next.style.cssText=css;if(origin)origin.insertBefore(next,sibling?.parentNode===origin?sibling:null);else next.remove();parent.style.position=parentPosition;}
  return {finished,cancel(){cancelled=true;jobs.forEach(j=>j.cancel());}};
}


