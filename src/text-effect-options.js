// Public intent controls; the engine derives particle ranges and timing from them.
import {normalizeTextMotionRecipe,textMotionAliases} from './text-motion-recipes.js';
import {textEditMotions} from './text-edit-motions.js';
export const TEXT_EFFECT_DEFAULTS=Object.freeze({particleShape:'triangle',exitEffect:'same',duration:2000,motion:1,formation:0,chaos:0.5,horizontal:1,vertical:1,flipX:false,flipY:false,exitFlipX:false,exitFlipY:false,bounceLines:false,seed:null,recipe:normalizeTextMotionRecipe()});
export const cloneTextEffectOptions=value=>({...value,...(value.recipe?{recipe:{...value.recipe}}:{})});
const limits={duration:[200,8000],motion:[0.25,2],formation:[-1,1],chaos:[0,1],horizontal:[0,2],vertical:[0,2],seed:[0,4294967295]};
export function normalizeTextEffectOptions(value={},mode='dust-wind'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw TypeError('Effect settings must be an object');
  for(const [key,v] of Object.entries(value)){
    if(!Object.hasOwn(TEXT_EFFECT_DEFAULTS,key))throw TypeError('Unknown effect setting: '+key);
    if(key==='exitEffect'){if(v!=='same'&&(typeof v!=='string'||!Object.keys(textEditMotions).includes(v)))throw TypeError('Invalid exitEffect');continue;}
    if(key==='particleShape'){if(!['triangle','square'].includes(v))throw TypeError('Invalid particleShape');continue;}
    if(key==='recipe'){normalizeTextMotionRecipe(v,mode);continue;}
    if(key==='seed'&&v===null)continue;
    if(limits[key]){const [lo,hi]=limits[key];if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi||(key==='seed'&&!Number.isInteger(v)))throw RangeError('Invalid effect setting: '+key);}
    else if(typeof v!=='boolean')throw TypeError(key+' must be boolean');
  }
  return Object.freeze({...TEXT_EFFECT_DEFAULTS,bounceLines:textMotionAliases[mode]?.bounceLines??(mode==='dust-wind-upward'),...value,recipe:normalizeTextMotionRecipe(value.recipe,mode)});
}

export const textEffectOptionShader=`
  // The distance/speed ratio retains the wind distribution at formation=0.
  // A continuous exponent adjusts arrival spread; no fixed particle cohorts.
  float thdFormationSeconds(float seconds,float duration,float formation){
    if(formation==0.0)return seconds;
    return duration*pow(clamp(seconds/duration,0.0,1.0),exp2(formation));
  }
`;

