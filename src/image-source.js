const TYPES=new Set(['image/png','image/jpeg','image/webp','image/svg+xml']);
// Internal, branded snapshots avoid encoding already decoded DOM pixels. An
// arbitrary object passed to the public loader cannot bypass source validation.
const snapshots=new WeakMap();
export function imageRasterSource(raster){const source=Object.freeze({});snapshots.set(source,raster);return source;}

function validateSVG(text,document){
  const xml=new document.defaultView.DOMParser().parseFromString(text,'image/svg+xml');
  if(xml.querySelector('parsererror')||xml.documentElement.localName!=='svg')throw Error('Invalid SVG');
  // This first image adapter accepts static, self-contained SVG only.
  for(const element of xml.querySelectorAll('*')){
    if(['script','foreignObject','animate','animateMotion','animateTransform','set'].includes(element.localName))throw Error('SVG must be static and self-contained');
    for(const attribute of element.attributes){
      const value=attribute.value.trim();
      if(attribute.localName==='href'&&value&&!value.startsWith('#')&&!/^data:image\/(png|jpeg|webp);base64,/i.test(value))throw Error('SVG external resources are not supported');
      if(/^on/i.test(attribute.localName))throw Error('SVG event handlers are not supported');
    }
  }
  if(/@import|url\(\s*['"]?\s*(?!#)[^\s'"\)]/i.test(text))throw Error('SVG external styles and resources are not supported');
}

// Decode once into sRGB RGBA. Browser-supported static files only; no font engine.
export async function loadImageRaster(source,{document=globalThis.document,signal,maxSide=2048,maxPixels=2097152}={}){
  const start=performance.now();signal?.throwIfAborted();
  const snapshot=source&&typeof source==='object'?snapshots.get(source):null;
  if(snapshot)return snapshot;
  let blob;
  if(source instanceof Blob)blob=source;
  else{
    const url=new URL(source,document.baseURI);
    if(!['http:','https:','blob:','data:'].includes(url.protocol))throw Error('Unsupported image URL');
    const response=await fetch(url,{signal});if(!response.ok)throw Error('Image request failed: '+response.status);
    blob=await response.blob();
  }
  const type=blob.type.split(';')[0].toLowerCase();
  if(!TYPES.has(type))throw Error('Choose a PNG, JPEG, WebP or static SVG image');
  if(blob.size>20*1024*1024)throw Error('Image file must be smaller than 20 MB');
  if(type==='image/svg+xml')validateSVG(await blob.text(),document);
  signal?.throwIfAborted();
  const window=document.defaultView,image=new window.Image(),url=URL.createObjectURL(blob);
  try{
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{image.onload=image.onerror=null;signal?.removeEventListener('abort',abort);};
      const abort=()=>{cleanup();image.src='';reject(signal.reason||new DOMException('Aborted','AbortError'));};
      image.onload=()=>{cleanup();resolve();};image.onerror=()=>{cleanup();reject(Error('The image could not be decoded'));};
      signal?.addEventListener('abort',abort,{once:true});image.src=url;
    });
    signal?.throwIfAborted();
    const originalWidth=image.naturalWidth,originalHeight=image.naturalHeight;
    if(!originalWidth||!originalHeight||originalWidth*originalHeight>67108864)throw Error('Invalid or oversized image dimensions');
    const scale=Math.min(1,maxSide/Math.max(originalWidth,originalHeight),Math.sqrt(maxPixels/(originalWidth*originalHeight)));
    const width=Math.max(1,Math.floor(originalWidth*scale)),height=Math.max(1,Math.floor(originalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    try{
      const context=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
      context.drawImage(image,0,0,width,height);
      const rgba=context.getImageData(0,0,width,height).data;
      return {width,height,rgba,mask:false,type,originalWidth,originalHeight,decodeMs:performance.now()-start};
    }finally{canvas.width=canvas.height=0;}
  }finally{URL.revokeObjectURL(url);image.src='';}
}
