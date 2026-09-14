import {motionPrograms} from './text-motion-programs.js';

const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// Trusted internal operation graphs. Public settings accept bounded values,
// never expressions, GLSL, or executable source.
export const textMotionRecipes=freeze(motionPrograms);
export const textMotionAliases=freeze({});
export const textRecipeControls=freeze({
  angle:{label:'جهت حرکت',default:0,min:-180,max:180,step:15,choices:{'0':'اصلی','45':'مورب بالا','-45':'مورب پایین','90':'چرخش بالا','-90':'چرخش پایین','180':'معکوس'}},
  depth:{label:'عمق',default:1,min:0,max:2,step:.1},
  spin:{label:'پیچش',default:1,min:0,max:2,step:.1},
  sway:{label:'موج و نوسان',default:1,min:0,max:2,step:.1},
  shape:{label:'تغییر شکل مثلث‌ها',default:1,min:0,max:1.5,step:.1},
  glow:{label:'درخشش',default:1,min:0,max:2,step:.1},
  palette:{label:'رنگ درخشش',default:'original',choices:{original:'اصلی',cool:'آبی',warm:'گرم',mint:'نعنایی'}},
  rebound:{label:'قدرت جهش',default:1,min:.25,max:1.5,step:.05},
  pace:{label:'ریتم جهش',default:1,min:.25,max:2,step:.05}
});
export function normalizeTextMotionRecipe(value={},mode='dust-wind'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw TypeError('Recipe settings must be an object');
  const result=Object.fromEntries(Object.entries(textRecipeControls).map(([key,control])=>[key,control.default]));
  result.angle=textMotionAliases[mode]?.angle??(mode==='dust-wind-upward'?45:0);
  for(const [key,v] of Object.entries(value)){
    if(!Object.hasOwn(textRecipeControls,key))throw TypeError('Unknown recipe setting: '+key);
    const control=textRecipeControls[key];
    if(key==='palette'){if(typeof v!=='string'||!Object.hasOwn(control.choices,v))throw TypeError('Invalid recipe palette');}
    else if(typeof v!=='number'||!Number.isFinite(v)||v<control.min||v>control.max)throw RangeError('Invalid recipe setting: '+key);
    result[key]=v;
  }
  return Object.freeze(result);
}

// Shared compiler: expressions describe math, operations describe composition,
// uniforms supply the bounded public intent controls.
export function compileTextMotionRecipe(recipe){
  if(!recipe||!Array.isArray(recipe.operations)||!recipe.operations.length)throw TypeError('Invalid motion recipe');
  const types={face:recipe.ownFace?'vec2':'vec3'};
  const lines=recipe.ownFace?[]:['vec3 face=p-vec3(dustTarget,p.z);'];
  const expression=value=>{if(typeof value!=='string'||!value||/[;{}#]/.test(value))throw TypeError('Invalid recipe expression');return value;};
  const target=value=>{if(typeof value!=='string'||!/^\w+(?:\.[xyzwrgba]{1,4})?$/.test(value))throw TypeError('Invalid recipe target');return value;};
  for(const step of recipe.operations){
    const v=step.value===undefined?'':expression(step.value);
    if(step.op==='let'){
      if(!['float','vec2','vec3','vec4','bool'].includes(step.type)||!/^\w+$/.test(step.name))throw TypeError('Invalid recipe declaration');
      types[step.name]=step.type;lines.push(`${step.type} ${step.name}=${v};`);
      if(step.parameter==='sway')lines.push(`${step.name}*=dustRecipeSway;`);
      else if(step.parameter==='rebound')lines.push(`if(dustRecipeRebound!=1.0)${step.name}=clamp(${step.name}*dustRecipeRebound,0.05,0.95);`);
      else if(step.parameter)throw TypeError('Unsupported recipe parameter');
    }else if(['set','add','subtract','multiply'].includes(step.op)){
      lines.push(`${target(step.target)}${{set:'=',add:'+=',subtract:'-=',multiply:'*='}[step.op]}${v};`);
    }else if(step.op==='turn')lines.push(`${target(step.target)}=thdTurn(${expression(step.vector)},(${expression(step.angle)})*dustRecipeSpin);`);
    else if(step.op==='hinge')lines.push(`${target(step.target)}=thdHinge(${expression(step.point)},${expression(step.pivot)},${expression(step.axis)},(${expression(step.angle)})*dustRecipeShape);`);
    else if(step.op==='deform'){
      const to=target(step.target),type=to.includes('.')?(to.split('.')[1].length===1?'float':'vec'+to.split('.')[1].length):types[to];
      if(!type||type==='bool')throw TypeError('Invalid deformation type');
      lines.push(`if(dustRecipeShape==1.0)${to}*=${v};else ${to}*=max(${type}(0.01),mix(${type}(1.0),${type}(${v}),dustRecipeShape));`);
    }else throw TypeError('Unsupported recipe operation: '+step.op);
  }
  return lines.join('\n');
}
export const textRecipeUniformShader=`
uniform vec2 dustRecipeDirection;
uniform float dustRecipeDepth;
uniform float dustRecipeSpin;
uniform float dustRecipeSway;
uniform float dustRecipeShape;
uniform float dustRecipeGlow;
uniform vec3 dustRecipePalette;
uniform float dustRecipeRebound;
uniform float dustRecipePace;
`;
