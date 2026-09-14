// CSS display pixels, independent of source resolution and triangle density.
// 32px at a 200px short side; sublinear growth with bounded extremes.
export function imageMotionPixels(width,height){
  const side=Math.max(1,Math.min(width,height));
  return Math.min(64,Math.max(8,32*Math.sqrt(side/200)));
}
// Identity inside the normal envelope, C1-continuous outside it; no hard clamp.
export function regulatedMotionLength(length,unit){
  const radius=4*Math.max(unit,0.0001);
  if(length<=radius)return length;
  const excess=length-radius;
  return radius+radius*excess/(radius+excess);
}
export const motionEnvelopeShader=`
vec3 thdRegulateMotion(vec3 delta,float unit){
  float radius=4.0*max(unit,0.0001);
  float distance=length(delta);
  if(distance<=radius)return delta;
  float excess=distance-radius;
  return delta*((radius+radius*excess/(radius+excess))/distance);
}
`;
