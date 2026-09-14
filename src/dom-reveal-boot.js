// Load synchronously in <head>, before body paint. No JavaScript = native content.
(function(){
  const style=document.createElement('style');
  style.textContent='[data-thd-pending]{opacity:0!important}';
  document.head.append(style);
  function release(){style.remove();}
  // Fail open even when the main module never loads or a target is unsupported.
  const timer=setTimeout(release,8000);
  window.addEventListener('thd:error',()=>{clearTimeout(timer);release();},{once:true});
  window.addEventListener('pagehide',()=>{clearTimeout(timer);release();},{once:true});
})();
