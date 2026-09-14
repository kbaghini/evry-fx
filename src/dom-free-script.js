(function(){
  const script=document.currentScript;
  if(!script?.src)throw Error('THD: use a classic script tag, or import loadFree from @thd/free/script');
  const base=new URL('.',script.src);
  if(window.THDFree)return;
  const ready=(async()=>{
    const {bootstrapFree}=await import(new URL('./dom-free-bootstrap.js',base).href);
    return bootstrapFree({document,auto:script.hasAttribute('data-thd-auto')});
  })();
  window.THDFree=Object.freeze({ready});
  ready.catch(error=>{console.error(error);window.dispatchEvent(new CustomEvent('thd:error',{detail:error}));});
})();
