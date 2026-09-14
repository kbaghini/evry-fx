// One expensive DOM-image snapshot/mesh job per frame and document. Decoding
// happens before this queue, so a slow network image cannot block ready peers.
const queues=new WeakMap();
export function queueImagePreparation(window,run){
  let queue=queues.get(window);
  if(!queue){queue={jobs:[],frame:null,running:false};queues.set(window,queue);}
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const job={run,resolve,reject,cancelled:false};queue.jobs.push(job);
  function request(){if(!queue.running&&queue.frame===null&&queue.jobs.length)queue.frame=window.requestAnimationFrame(pump);}
  async function pump(){queue.frame=null;const next=queue.jobs.shift();if(!next)return;queue.running=true;
    try{next.resolve(next.cancelled?false:await next.run());}catch(error){next.reject(error);}
    finally{queue.running=false;request();}
  }
  request();
  return {promise,cancel(){if(job.cancelled)return;job.cancelled=true;const index=queue.jobs.indexOf(job);if(index>=0){queue.jobs.splice(index,1);resolve(false);if(!queue.jobs.length&&queue.frame!==null){window.cancelAnimationFrame(queue.frame);queue.frame=null;}}}};
}
