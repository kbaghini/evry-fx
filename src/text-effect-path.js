import {motionEnvelopeShader} from './motion-envelope.js';
import {additionalTextMotion} from './text-edit-motions.js';

// One evaluator allows optional rigid facet reflection for every preset. Only
// the selected preset compiles; extra corner evaluations run only with bounce.
export const textEffectPathShader=`${motionEnvelopeShader}
vec3 thdPresetPosition(vec3 p,vec2 dustTarget,vec2 particle,vec4 r,vec4 clock,vec2 travel,float t,float seed,float drift,float pace){
  float remain=1.0-t;
  vec3 recipeOrigin=p;
  vec2 cellSize=vec2(max(dustEm,0.0001));
  vec2 cellMin=thdMotionCell(dustTarget,r.xy,dustEm);
  #if THD_EDIT_CHARACTER_FRAME == 1
  if(dustCharacterFrame.z>0.0&&dustCharacterFrame.w>0.0){
    cellMin=dustCharacterFrame.xy+glyphOffset;
    cellSize=dustCharacterFrame.zw;
  }
  #endif
  vec2 cellCenter=cellMin+cellSize*0.5;
  vec2 cellUV=clamp((dustTarget-cellMin)/cellSize,0.0,1.0);
  float across=cellUV.x;
  if(clock.y<0.0)across=1.0-across;
  {${additionalTextMotion}}
  if(dustRecipeDirection!=vec2(1.0,0.0)){
    vec2 delta=p.xy-recipeOrigin.xy;
    float sine=clock.y*dustRecipeDirection.y;
    p.xy=recipeOrigin.xy+vec2(dustRecipeDirection.x*delta.x-sine*delta.y,sine*delta.x+dustRecipeDirection.x*delta.y);
  }
  if(dustRecipeDepth!=1.0)p.z=recipeOrigin.z+(p.z-recipeOrigin.z)*dustRecipeDepth;
  dustGlow*=dustRecipeGlow;
  if(dustRecipePalette.x>=0.0)dustGlowColor=dustRecipePalette;
  return p;
}
`;
export const textEffectApplicationShader=`
  vec3 original=p;
  p=thdPresetPosition(original,dustTarget,particle,r,clock,travel,t,seed,drift,pace);
  // Regulate the shared triangle centre, preserving facet shape and orientation.
  vec3 center=vec3(dustTarget,original.z);
  float savedGlow=dustGlow,savedOutline=dustOutline;vec3 savedGlowColor=dustGlowColor;
  vec3 moved=thdPresetPosition(center,dustTarget,particle,r,clock,travel,t,seed,drift,pace);
  dustGlow=savedGlow;dustOutline=savedOutline;dustGlowColor=savedGlowColor;
  vec3 delta=moved-center;
  vec3 regulated=thdRegulateMotion(delta,dustEm);
  vec3 adjustment=regulated-delta;
  #if THD_EDIT_ADJUST == 1
  adjustment+=regulated*(dustTransform-vec3(1.0));
  #endif
  p+=adjustment;
  #if THD_EDIT_BOUNCE == 1
  if(dustBounce>0.5 && t<1.0){
    vec3 a=thdPresetPosition(dustCornerA+vec3(glyphOffset,0.0),dustTarget,particle,r,clock,travel,t,seed,drift,pace)+adjustment;
    vec3 b=thdPresetPosition(dustCornerB+vec3(glyphOffset,0.0),dustTarget,particle,r,clock,travel,t,seed,drift,pace)+adjustment;
    vec3 c=thdPresetPosition(dustCornerC+vec3(glyphOffset,0.0),dustTarget,particle,r,clock,travel,t,seed,drift,pace)+adjustment;
    float centerY=(a.y+b.y+c.y)/3.0;
    float low=dustFloor.x+glyphOffset.y+centerY-min(a.y,min(b.y,c.y));
    float high=dustCeiling.x+glyphOffset.y-max(a.y,max(b.y,c.y))+centerY;
    float span=high-low;
    if(span>0.000001)p.y+=low+span-abs(mod(centerY-low,2.0*span)-span)-centerY;
  }
  #endif
`;
