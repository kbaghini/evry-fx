// Rounded ancestor clips supplement the owner's rectangular scissor. Coordinates
// are absolute CSS viewport pixels; radii run clockwise from the top-left corner.
export const MAX_VIEWPORT_CLIPS=8;
const clipsOverflow=value=>/^(auto|scroll|hidden|clip)$/.test(value);
const cornerNames=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'];

function radiusLength(value,size){
  const match=/^(\d*\.?\d+)(px|%)?$/.exec(value);
  if(!match||!match[2]&&Number(match[1])!==0)throw TypeError('Viewport clipping requires resolved px or percentage border radii');
  return Number(match[1])*(match[2]==='%'?size/100:1);
}

export function readViewportClip(node,style,box){
  // A visible axis does not acquire rounded clipping from the other axis.
  if(!clipsOverflow(style.overflowX)||!clipsOverflow(style.overflowY))return null;
  const width=node.offsetWidth,height=node.offsetHeight;
  if(!(width>0&&height>0&&box.width>0&&box.height>0&&node.clientWidth>0&&node.clientHeight>0))return null;
  const radii=cornerNames.map(name=>{
    const pair=(style[name]||'0px').trim().split(/\s+/);
    if(pair.length>2)throw TypeError('Viewport clipping requires resolved px or percentage border radii');
    return [radiusLength(pair[0],width),radiusLength(pair[1]||pair[0],height)];
  });
  // CSS reduces every outer radius by one common factor before computing the
  // inner border curve. Do not renormalize inner radii: a thick opposite border
  // can legitimately truncate an arc to less than a quarter ellipse.
  const factor=Math.min(1,
    width/(radii[0][0]+radii[1][0]||1),width/(radii[3][0]+radii[2][0]||1),
    height/(radii[0][1]+radii[3][1]||1),height/(radii[1][1]+radii[2][1]||1));
  const left=node.clientLeft,top=node.clientTop,right=Math.max(0,width-left-node.clientWidth),bottom=Math.max(0,height-top-node.clientHeight);
  const sx=box.width/width,sy=box.height/height;
  const insets=[[left,top],[right,top],[right,bottom],[left,bottom]];
  for(let i=0;i<4;i++){
    radii[i][0]=Math.max(0,radii[i][0]*factor-insets[i][0])*sx;
    radii[i][1]=Math.max(0,radii[i][1]*factor-insets[i][1])*sy;
  }
  if(!radii.some(([x,y])=>x>0&&y>0))return null;
  // Client dimensions include padding; subtracting content padding here would
  // incorrectly hide overflow that CSS allows to paint inside that padding.
  return {left:box.left+left*sx,top:box.top+top*sy,right:box.left+(left+node.clientWidth)*sx,bottom:box.top+(top+node.clientHeight)*sy,radii};
}

const marker='/* THD_VIEWPORT_ROUNDED_CLIP */';
const clipMaterials=new WeakSet();
const clipShader=`${marker}
uniform int thdViewportClipCount;
uniform vec4 thdViewportClipRects[${MAX_VIEWPORT_CLIPS}];
uniform vec4 thdViewportClipRadiiX[${MAX_VIEWPORT_CLIPS}];
uniform vec4 thdViewportClipRadiiY[${MAX_VIEWPORT_CLIPS}];
uniform vec3 thdViewportClipOrigin;
float thdViewportCornerAlpha(vec2 delta,vec2 radius){
  if(radius.x<=0.0||radius.y<=0.0||delta.x<=0.0||delta.y<=0.0)return 1.0;
  vec2 q=delta/radius;
  float edge=dot(q,q)-1.0;
  // First-order ellipse distance supplies one physical pixel of antialiasing,
  // without requiring derivative extensions or changing the surface's RGB.
  float distance=edge/max(2.0*length(q/radius),0.000001);
  return clamp(0.5-distance/thdViewportClipOrigin.z,0.0,1.0);
}
float thdViewportClipAlpha(){
  vec2 p=vec2(thdViewportClipOrigin.x+gl_FragCoord.x*thdViewportClipOrigin.z,
    thdViewportClipOrigin.y-gl_FragCoord.y*thdViewportClipOrigin.z);
  float alpha=1.0;
  for(int i=0;i<${MAX_VIEWPORT_CLIPS};i++){
    if(i>=thdViewportClipCount)break;
    vec4 b=thdViewportClipRects[i],rx=thdViewportClipRadiiX[i],ry=thdViewportClipRadiiY[i];
    alpha=min(alpha,thdViewportCornerAlpha(vec2(b.x+rx.x-p.x,b.y+ry.x-p.y),vec2(rx.x,ry.x)));
    alpha=min(alpha,thdViewportCornerAlpha(vec2(p.x-b.z+rx.y,b.y+ry.y-p.y),vec2(rx.y,ry.y)));
    alpha=min(alpha,thdViewportCornerAlpha(vec2(p.x-b.z+rx.z,p.y-b.w+ry.z),vec2(rx.z,ry.z)));
    alpha=min(alpha,thdViewportCornerAlpha(vec2(b.x+rx.w-p.x,p.y-b.w+ry.w),vec2(rx.w,ry.w)));
  }
  return alpha;
}
`;

function decorateMaterial(material){
  if(material.fragmentShader.includes(marker))return;
  const source=material.fragmentShader;
  // Preserve functions following main as well as existing opacity/effect hooks.
  const clean=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,match=>' '.repeat(match.length));
  const main=/\bvoid\s+main\s*\(\s*(?:void\s*)?\)\s*\{/.exec(clean);
  if(!main)throw TypeError('Viewport clipping requires a ShaderMaterial main function');
  let end=main.index+main[0].length,depth=1;
  for(;end<clean.length&&depth;end++){if(clean[end]==='{')depth++;else if(clean[end]==='}')depth--;}
  if(depth)throw TypeError('Viewport clipping requires a complete ShaderMaterial main function');
  const finish='\nfloat thdClipCoverage=thdViewportClipAlpha();\nif(thdClipCoverage<=0.0)discard;\ngl_FragColor.a *= thdClipCoverage;\n';
  material.fragmentShader=clipShader+source.slice(0,end-1)+finish+source.slice(end-1);
  material.needsUpdate=true;
}

export function applyViewportClips(scene,clips,viewport,dpr){
  if(clips.length>MAX_VIEWPORT_CLIPS)throw RangeError(`At most ${MAX_VIEWPORT_CLIPS} rounded viewport clips are supported`);
  if(!(Number.isFinite(dpr)&&dpr>0))throw RangeError('A positive viewport pixel ratio is required');
  scene.traverse(object=>{
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material?.isShaderMaterial)continue;
      if(!clips.length&&!material.fragmentShader.includes(marker))continue;
      decorateMaterial(material);
      const uniforms=material.uniforms;
      // Three's uniform clone can retain typed-array references. Give each new
      // material its own clip buffers so cloned scenes cannot move a peer's clip.
      if(!clipMaterials.has(material)){
        uniforms.thdViewportClipCount={value:0};
        uniforms.thdViewportClipOrigin={value:new Float32Array(3)};
        for(const name of ['thdViewportClipRects','thdViewportClipRadiiX','thdViewportClipRadiiY'])uniforms[name]={value:new Float32Array(MAX_VIEWPORT_CLIPS*4)};
        clipMaterials.add(material);
      }
      uniforms.thdViewportClipCount.value=clips.length;
      uniforms.thdViewportClipOrigin.value.set([viewport.left,viewport.bottom,1/dpr]);
      for(let i=0;i<clips.length;i++){
        const clip=clips[i],offset=i*4;
        uniforms.thdViewportClipRects.value.set([clip.left,clip.top,clip.right,clip.bottom],offset);
        for(let corner=0;corner<4;corner++){
          uniforms.thdViewportClipRadiiX.value[offset+corner]=clip.radii[corner][0];
          uniforms.thdViewportClipRadiiY.value[offset+corner]=clip.radii[corner][1];
        }
      }
    }
  });
}
