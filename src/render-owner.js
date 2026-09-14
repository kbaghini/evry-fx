import {createViewportRenderOwner} from './viewport-render-owner.js';

// Shared GPU ownership, independent of component factories. Local 2D
// presentation canvases preserve DOM stacking and clipping of each surface.
export function createRenderOwner(THREE,document,{presentation='local',...options}={}){
  if(presentation==='viewport')return createViewportRenderOwner(THREE,document,options);
  if(presentation!=='local')throw TypeError('Invalid canvas presentation');
  if(!THREE?.WebGLRenderer||!document?.defaultView)throw TypeError('THREE and a window document required');
  let renderer=null,disposed=false,lost=false,w=0,h=0,dpr=0,copies=0,copyMs=0,renderMs=0,created=0;
  const leases=new Set(),handles=new Set();
  function broadcast(){lost=true;for(const lease of leases)lease.domElement.dispatchEvent(new document.defaultView.Event('webglcontextlost',{cancelable:true}));}
  function ensure(){
    if(disposed||lost)throw Error('Shared renderer unavailable');
    if(!renderer){renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});created++;renderer.domElement.addEventListener('webglcontextlost',onLoss);}
  }
  function onLoss(event){event.preventDefault();broadcast();}
  const Namespace={...THREE,WebGLRenderer:class{
    constructor(){
      ensure();this.domElement=document.createElement('canvas');this.context=this.domElement.getContext('2d');
      if(!this.context)throw Error('2D presentation unavailable');
      this.width=300;this.height=150;this.ratio=1;this.dead=false;leases.add(this);
    }
    setPixelRatio(value){this.ratio=value;this.setSize(this.width,this.height,false);}
    setSize(width,height){
      this.width=width;this.height=height;
      const pw=Math.floor(width*this.ratio),ph=Math.floor(height*this.ratio);
      if(this.domElement.width!==pw)this.domElement.width=pw;
      if(this.domElement.height!==ph)this.domElement.height=ph;
    }
    render(scene,camera){
      ensure();if(this.dead)throw Error('Presentation disposed');
      if(dpr!==this.ratio){renderer.setPixelRatio(this.ratio);dpr=this.ratio;}
      if(w!==this.width||h!==this.height){renderer.setSize(this.width,this.height,false);w=this.width;h=this.height;}
      const t=performance.now();renderer.render(scene,camera);renderMs+=performance.now()-t;
      const start=performance.now();this.context.clearRect(0,0,this.domElement.width,this.domElement.height);
      this.context.drawImage(renderer.domElement,0,0);copyMs+=performance.now()-start;copies++;
    }
    dispose(){if(this.dead)return;this.dead=true;leases.delete(this);this.domElement.width=this.domElement.height=0;}
    forceContextLoss(){} // A lease cannot destroy a peer's context.
  }};
  function create(factory,host,options){
      if(disposed)throw Error('Shared owner disposed');
      if(host?.ownerDocument!==document)throw TypeError('Host must belong to the owner document');
      const control=factory(host,Namespace,options),destroy=control.destroy;
      handles.add(control);control.destroy=()=>{handles.delete(control);destroy();};return control;
  }
  return {create,
    refresh(){if(disposed)throw Error('Shared owner disposed');for(const control of handles)control.refresh?.();},
    stats:()=>({disposed,lost,contexts:renderer&&!disposed?1:0,created,controls:handles.size,leases:leases.size,copies,copyMs,renderMs,geometries:renderer?.info.memory.geometries||0}),
    destroy(){
      if(disposed)return;disposed=true;
      const errors=[];
      for(const control of [...handles])try{control.destroy();}catch(error){errors.push(error);}
      if(renderer){
        renderer.domElement.removeEventListener('webglcontextlost',onLoss);
        try{renderer.dispose();}catch(error){errors.push(error);}
        try{renderer.forceContextLoss();}catch(error){errors.push(error);}
      }
      if(errors.length)throw new AggregateError(errors,'Hybrid owner cleanup failed');
    }
  };
}

