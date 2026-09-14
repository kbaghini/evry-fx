export const MOTION_SAMPLES = 32;

// A fixed-size radial lookup replaces one CPU rotation calculation per vertex.
// The vertex shader and pointer projection interpolate the same samples.
export class RadialMotion {
  constructor() {
    this.angles = new Float32Array(MOTION_SAMPLES * 2);
    this.targetX = 0;
    this.targetY = 0;
    this.radius = 1;
    this.active = false;
  }

  rotate(x, y) {
    this.targetX += x;
    this.targetY += y;
    this.active = true;
  }

  step(dt) {
    if (!this.active) return false;
    let error = 0;
    for (let i = 0; i < MOTION_SAMPLES; i++) {
      const factor = 1 - Math.exp(-(11.9 - i / (MOTION_SAMPLES - 1) * 8.8) * dt);
      for (let axis = 0; axis < 2; axis++) {
        const at = i * 2 + axis;
        const target = axis ? this.targetY : this.targetX;
        this.angles[at] += (target - this.angles[at]) * factor;
        error = Math.max(error, Math.abs(target - this.angles[at]));
      }
    }
    this.active = error >= 0.0005;
    if (!this.active) {
      for (let i = 0; i < MOTION_SAMPLES; i++) {
        this.angles[i * 2] = this.targetX;
        this.angles[i * 2 + 1] = this.targetY;
      }
    }
    return true;
  }

  transform(x, y, out, z = 0) {
    const sample = Math.min(1, Math.hypot(x, y) / Math.max(this.radius, 0.001)) * (MOTION_SAMPLES - 1);
    const low = Math.min(MOTION_SAMPLES - 2, Math.floor(sample));
    const t = sample - low;
    const ax = this.angles[low * 2] * (1 - t) + this.angles[(low + 1) * 2] * t;
    const ay = this.angles[low * 2 + 1] * (1 - t) + this.angles[(low + 1) * 2 + 1] * t;
    const ry = y * Math.cos(ax) - z * Math.sin(ax);
    const rz = y * Math.sin(ax) + z * Math.cos(ax);
    return out.set(x * Math.cos(ay) + rz * Math.sin(ay), ry, -x * Math.sin(ay) + rz * Math.cos(ay));
  }
}
