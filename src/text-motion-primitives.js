// Small GPU building blocks shared by edit motions. All paths run from scattered
// (t=0) to the untouched mesh (t=1); removal only reverses the captured phase.
export const textMotionPrimitives=`
  // Text effects live above their resting surface. Reflect inward depth instead
  // of letting the opaque control body cut off a still-visible particle. This
  // same path is reversed for removal; normal scene depth testing stays enabled.
  float thdFrontDepth(float resting,float animated){
    return resting+abs(animated-resting);
  }
  // A fixed one-em cell: longer edits add cells instead of stretching a path.
  // All vertices of a triangle choose the cell using their shared centroid.
  vec2 thdMotionCell(vec2 target,vec2 origin,float em){
    float size=max(em,0.0001);
    return origin+floor((target-origin)/size)*size;
  }
  // Preserve the tuned wind distribution for EVERY preset: no particle cohorts,
  // no per-motion lifetime. Time = randomized distance / randomized speed.
  vec2 thdParticleTravel(float seed,float drift,float pace,float seconds){
    float spread=fract(seed*7.31+drift*13.71);
    float distanceJitter=mix(0.8,1.2,spread);
    float distance=mix(0.0,7.8,seed)*distanceJitter;
    float speed=(7.8*1.2/max(seconds,0.001))*mix(1.0,4.0,pace);
    return vec2(distance,distance/speed);
  }
  float thdMotionPhase(vec4 clock,float travelSeconds,float seconds){
    float progress=travelSeconds>0.0?clamp(clock.x*seconds/travelSeconds,0.0,1.0):1.0;
    float initial=travelSeconds>0.0?clamp(max(0.0,clock.z-1.0)*seconds/travelSeconds,0.0,1.0):1.0;
    return clock.z>0.5?max(0.0,initial-progress):progress;
  }
  float thdStagger(float t,float order,float spread){
    if(t>=1.0)return 1.0;
    if(t<=0.0)return 0.0;
    float delay=clamp(order,0.0,1.0)*spread;
    return clamp((t-delay)/max(1.0-delay,0.001),0.0,1.0);
  }
  // Continuous per-particle appearance: sparse at first, progressively denser.
  // Use the existing reversible motion phase so exit follows the same envelope.
  float thdParticleAppearance(float t,float order){
    float start=0.55*sqrt(clamp(order,0.0,1.0));
    float fade=clamp((t-start)/0.25,0.0,1.0);
    return fade*fade;
  }
  vec2 thdTurn(vec2 v,float angle){
    return vec2(v.x*cos(angle)-v.y*sin(angle),v.x*sin(angle)+v.y*cos(angle));
  }
  vec3 thdFold(vec3 v,vec3 axis,float angle){
    return v*cos(angle)+cross(axis,v)*sin(angle)+axis*dot(axis,v)*(1.0-cos(angle));
  }
  // Linear projected opening, while preserving each preset's initial angle.
  // A linear angle looks almost flat too early because its projection is cosine.
  float thdOpeningAngle(float progress,float initialAngle){
    // Some GPU acos approximations leave a tiny angle at 1. Return exact ends.
    if(progress>=1.0)return 0.0;
    if(progress<=0.0)return initialAngle;
    return acos(clamp(mix(cos(initialAngle),1.0,progress),-1.0,1.0));
  }
  vec3 thdHinge(vec3 point,vec3 pivot,vec3 axis,float angle){
    return pivot+thdFold(point-pivot,axis,angle);
  }
  vec2 thdCurve(vec2 a,vec2 b,vec2 c,vec2 d,float t){
    float q=1.0-t;
    return q*q*q*a+3.0*q*q*t*b+3.0*q*t*t*c+t*t*t*d;
  }
  float thdPulse(float t){return 4.0*t*(1.0-t);}
  // Bounded sinusoidal drift anchored at zero, so a shared path joins the text
  // exactly without per-effect offsets or a separate deletion implementation.
  float thdSway(float progress,float phase,float turns){
    return sin(phase+progress*turns*6.2831853)-sin(phase);
  }
  // Ballistic drop + four diminishing rebounds. One drop time is the unit;
  // restitution scales vertical speed at each impact (energy scales by e^2).
  // Horizontal friction reduces speed after every impact. Result: height as
  // a fraction of the original drop, and accumulated horizontal travel [0,1].
  // This evaluates a pose directly, so reverse playback needs no simulation.
  vec2 thdGravityBounce(float departure,float restitution,float friction){
    float total=1.0,totalX=1.0,speed=restitution,slide=friction;
    for(int i=0;i<4;i++){
      total+=2.0*speed;totalX+=2.0*speed*slide;
      speed*=restitution;slide*=friction;
    }
    float time=clamp(departure,0.0,1.0)*total;
    if(time<=1.0)return vec2(max(0.0,1.0-time*time),time/totalX);
    time-=1.0;
    float distance=1.0;speed=restitution;slide=friction;
    for(int i=0;i<4;i++){
      float flight=2.0*speed;
      if(time<=flight)return vec2(max(0.0,2.0*speed*time-time*time),(distance+slide*time)/totalX);
      time-=flight;distance+=slide*flight;
      speed*=restitution;slide*=friction;
    }
    return vec2(0.0,1.0);
  }
  float thdSpring(float t){return (1.0-t)*cos(t*10.9955743);}
  float thdFall(float t){
    if(t<0.64){float f=t/0.64;return 1.0-f*f;}
    return 0.14*sin((t-0.64)/0.36*3.1415927);
  }
`;
