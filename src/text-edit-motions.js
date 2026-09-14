// Public catalogue contains metadata only. Paths come from shared recipes.
import {compileTextMotionRecipe,textMotionRecipes,textMotionAliases} from './text-motion-recipes.js';
export const DEFAULT_TEXT_EFFECT_DURATION=2000;
const definitions=[{"key":"dust-wind","id":0,"label":"باد و گردوخاک","description":"ذرات با باد می‌آیند و هنگام حذف همان مسیر را برمی‌گردند. تنظیم قبلی باد حفظ شده است."},{"key":"smoke","id":4,"label":"دود و پراکندگی","description":"قطعه‌ها هنگام حذف رو به بالا می‌پیچند، ریز و محو می‌شوند. تایپ همان حرکت را برعکس می‌کند."},{"key":"melt","id":10,"label":"ذوب و انجماد","description":"هنگام حذف، وجه‌ها کش می‌آیند و مثل قطره پایین می‌روند؛ ورود متن، جمع‌شدن و انجماد همان قطره‌هاست."},{"key":"drifting-snow","id":28,"label":"برف معلق","description":"مثلث‌ها مثل دانه‌های برف با چرخش و نوسان جانبی آرام پایین می‌آیند و می‌نشینند؛ حذف، همان حرکت را برمی‌گرداند."}];
const catalogue=Object.assign(Object.create(null),Object.fromEntries(definitions.map(({key,id,label,description,contour=false,characterCenters=false,characterFloor=false,characterFrame=false})=>[key,Object.freeze({id,label,description,contour,characterCenters,characterFloor,characterFrame,duration:DEFAULT_TEXT_EFFECT_DURATION})])));
for(const [key,alias] of Object.entries(textMotionAliases))Object.defineProperty(catalogue,key,{value:catalogue[alias.base],enumerable:false});
export const textEditMotions=Object.freeze(catalogue);
export const isInputEffect=value=>typeof value==='string'&&(value==='none'||Object.hasOwn(textEditMotions,value));
export const additionalTextMotion=definitions.map(({id,key})=>`
#if THD_EDIT_MODE == ${id}
{
${compileTextMotionRecipe(textMotionRecipes[key])}
}
#endif
`).join('');
