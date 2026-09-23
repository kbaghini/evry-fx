/** EV-RY FX Free classic loader (MIT) — https://ev-ry.com/fx/ */
(function(){
  const script=document.currentScript;
  if(!script?.src)throw Error('THD: use a classic script tag, or import loadFree from @thd/free/script');
  const base=new URL('.',script.src);
  if(window.THDFree)return;
  const ready=(async()=>{
    const {bootstrapFree}=await import(new URL('./dom-free-bootstrap.js',base).href);
    return bootstrapFree({document,auto:script.hasAttribute('data-thd-auto')});
  })();
  const namespace=Object.freeze({ready});
  window.THDFree=namespace;
  ready.catch(error=>{
    if(window.THDFree===namespace)delete window.THDFree;
    console.error(error);
    window.dispatchEvent(new CustomEvent('thd:error',{detail:error}));
  });
})();
