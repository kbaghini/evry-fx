// Text and image surfaces share one texture per raster (not per triangle).
// References include deletion ghosts, which can outlive their source scene mesh.
const surfaces=new WeakMap(),materials=new WeakMap();
export function attachRasterTexture(THREE,material,raster,{lodBias=raster.mask===false?0:-.75}={}){
  if(!Number.isFinite(lodBias))throw TypeError('A finite raster LOD bias is required');
  let surface=surfaces.get(raster);
  if(!surface){
    const texture=new THREE.DataTexture(raster.rgba,raster.width,raster.height,THREE.RGBAFormat,THREE.UnsignedByteType);
    if(raster.mask===false)texture.colorSpace=THREE.SRGBColorSpace;
    // One bilinear mip fetch while moving; the shader adds the adjacent mip only
    // near the resting pose. Sampling policy never mutates a shared texture.
    texture.minFilter=THREE.LinearMipmapNearestFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
    surface={texture,refs:0,raster};surfaces.set(raster,surface);
  }
  material.uniforms.rasterMap={value:surface.texture};
  material.uniforms.rasterSize={value:new THREE.Vector2(raster.width,raster.height)};
  material.uniforms.rasterLodBias={value:lodBias};
  return lease(material,surface);
}
// Derivatives describe this triangle's current projected texture footprint.
// Explicit LOD is core in WebGL2 (Three aliases texture2DLodEXT) and optional in
// WebGL1. Without it, keep a single conventional texture lookup as a safe fallback.
const rasterSamplingShader=`
uniform vec2 rasterSize;
uniform float rasterLodBias;
varying float vRasterQuality;
vec4 thdRasterSample(vec2 uv){
  #if __VERSION__ >= 300 || defined(GL_EXT_shader_texture_lod)
    vec2 dx=dFdx(uv*rasterSize),dy=dFdy(uv*rasterSize);
    float footprint=max(max(dot(dx,dx),dot(dy,dy)),0.00000001);
    float lastLevel=floor(log2(max(max(rasterSize.x,rasterSize.y),1.0)));
    float lod=clamp(0.5*log2(footprint)+rasterLodBias,0.0,lastLevel);
    float primary=floor(lod+0.5);
    vec4 sampleColor=texture2DLodEXT(rasterMap,uv,primary);
    float weight=abs(lod-primary)*clamp(vRasterQuality,0.0,1.0);
    if(weight>0.0){
      float adjacent=primary<lod?primary+1.0:primary-1.0;
      sampleColor=mix(sampleColor,texture2DLodEXT(rasterMap,uv,adjacent),weight);
    }
    return sampleColor;
  #else
    return texture2D(rasterMap,uv);
  #endif
}
`;

/** Add the shared sampler to text/image shaders that already declare rasterMap
 * and vRasterUV. The default is settled; TriangleEffect supplies each facet's
 * existing phase without another clock, attribute buffer or per-frame JS work. */
export function applyRasterSamplingShader(material){
  material.defines={...material.defines,THD_RASTER_TEXTURE:1};
  material.extensions={...material.extensions,derivatives:true,shaderTextureLOD:true};
  material.vertexShader='varying float vRasterQuality;\n'+material.vertexShader;
  material.vertexShader=material.vertexShader.replace(/void main\(\)\s*\{/,'void main(){ vRasterQuality=1.0;');
  const main=material.fragmentShader.indexOf('void main');
  material.fragmentShader=material.fragmentShader.slice(0,main)+rasterSamplingShader+material.fragmentShader.slice(main);
  material.fragmentShader=material.fragmentShader.replace('texture2D(rasterMap,vRasterUV)','thdRasterSample(vRasterUV)');
}
function lease(material,surface){
  surface.refs++;materials.set(material,surface);let released=false;
  return ()=>{if(released)return;released=true;materials.delete(material);if(--surface.refs===0){surface.texture.dispose();surfaces.delete(surface.raster);}};
}
export function retainRasterTexture(source,target){
  const surface=materials.get(source);if(!surface)return null;
  // ShaderMaterial.clone clones texture uniforms. Use the shared source instead
  // of uploading an identical new image for each partial deletion.
  if(target.uniforms.rasterMap.value!==surface.texture)target.uniforms.rasterMap.value.dispose();
  target.uniforms.rasterMap.value=surface.texture;
  return lease(target,surface);
}
export function applyRasterTextureShader(material,{mask=true}={}){
  material.vertexShader='attribute vec2 rasterUV; varying vec2 vRasterUV;\n'+material.vertexShader;
  material.vertexShader=material.vertexShader.replace('void main() {','void main() { vRasterUV=rasterUV;');
  material.fragmentShader='uniform sampler2D rasterMap; varying vec2 vRasterUV;\n'+material.fragmentShader;
  material.fragmentShader=material.fragmentShader.replace('float coverage =', 'vec4 rasterSample=texture2D(rasterMap,vRasterUV); float coverage =');
  material.fragmentShader=material.fragmentShader.replace('max(max(vColor.r, vColor.g), vColor.b) * brightness','rasterSample.a * max(max(vColor.r, vColor.g), vColor.b) * min(brightness, 1.0)');
  if(!mask)material.fragmentShader=material.fragmentShader.replace('vec4(tint * min(1.0, diffuse + sheen), coverage)', 'vec4(rasterSample.rgb * tint * min(1.0, diffuse + sheen), coverage)');
  applyRasterSamplingShader(material);
}
