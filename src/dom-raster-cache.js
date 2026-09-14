// Document-scoped, bounded source pixels only. Geometry, tint and motion remain
// attachment-owned. Live glyph records can outlive an LRU entry safely.
const documents=new WeakMap();
const MAX_BYTES=16*1024*1024,MAX_ENTRIES=128,MAX_FONTS=64;
export function domRasterCache(document){
  let cache=documents.get(document);if(cache)return cache;
  const rasters=new Map(),fonts=new Map();let bytes=0,hits=0,misses=0,epoch=0;
  function invalidate(){epoch++;rasters.clear();fonts.clear();bytes=0;}
  cache={
    get epoch(){return epoch;},
    font(key,load){
      let promise=fonts.get(key);
      if(!promise){promise=Promise.resolve().then(load);fonts.set(key,promise);if(fonts.size>MAX_FONTS)fonts.delete(fonts.keys().next().value);promise.catch(()=>{if(fonts.get(key)===promise)fonts.delete(key);});}
      return promise;
    },
    raster(key,build){
      const old=rasters.get(key);
      if(old){rasters.delete(key);rasters.set(key,old);hits++;return old;}
      misses++;const result=build(),size=result.rgba.byteLength;
      if(size<=MAX_BYTES){
        while(rasters.size&&(bytes+size>MAX_BYTES||rasters.size>=MAX_ENTRIES)){const first=rasters.keys().next().value;bytes-=rasters.get(first).rgba.byteLength;rasters.delete(first);}
        rasters.set(key,result);bytes+=size;
      }
      return result;
    },
    stats:()=>({bytes,entries:rasters.size,hits,misses,epoch,maxBytes:MAX_BYTES}),
    invalidate
  };
  // Font files may finish after an engine first used the CSS fallback font.
  document.fonts?.addEventListener('loadingdone',invalidate);
  document.fonts?.addEventListener('loadingerror',invalidate);
  documents.set(document,cache);return cache;
}
