import { MOTION_SAMPLES, RadialMotion } from './motion.js';
import {attachRasterTexture,applyRasterTextureShader} from './raster-texture-material.js';

const vertexShader = `
  attribute vec3 color;
  attribute float delay;
  uniform vec2 angles[${MOTION_SAMPLES}];
  uniform float radius;
  uniform float baseline;
  uniform float effectTime;
  varying vec3 vColor;
  varying vec3 vViewPosition;
  void main() {
    vec3 p = position + vec3(0.0, baseline, 0.0);
    float sampleIndex = clamp(length(p.xy) / max(radius, 0.001), 0.0, 1.0) * ${MOTION_SAMPLES - 1}.0;
    int low = min(${MOTION_SAMPLES - 2}, int(floor(sampleIndex)));
    vec2 angle = mix(angles[low], angles[low + 1], sampleIndex - float(low));
    float ry = p.y * cos(angle.x) - p.z * sin(angle.x);
    float rz = p.y * sin(angle.x) + p.z * cos(angle.x);
    p = vec3(p.x * cos(angle.y) + rz * sin(angle.y), ry, -p.x * sin(angle.y) + rz * cos(angle.y));
    float progress = clamp((effectTime - delay) / 0.5, 0.0, 1.0);
    vColor = color * (1.0 - pow(1.0 - progress, 3.0));
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const fragmentShader = `
  uniform float brightness;
  uniform float presentationOpacity;
  uniform vec3 tint;
  varying vec3 vColor;
  varying vec3 vViewPosition;
  void main() {
    vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    float facing = abs(faceNormal.z);
    float diffuse = mix(0.16, 1.0, pow(facing, 0.72));
    float sheen = 0.16 * pow(facing, 10.0);
    float coverage = clamp(max(max(vColor.r, vColor.g), vColor.b) * brightness, 0.0, 1.0);
    // Coverage belongs in alpha only; multiplying RGB by it as well darkens thin strokes twice.
    gl_FragColor = vec4(tint * min(1.0, diffuse + sheen), coverage);
    // CSS tint and sampled image RGB are linear in Three's working space.
    // Encode RGB once for the render target; coverage alpha stays unchanged.
    #include <colorspace_fragment>
    gl_FragColor.a *= presentationOpacity;
  }
`;

export class TextScene {
  constructor(THREE, engine, scene) {
    this.THREE = THREE;
    this.engine = engine;
    this.scene = scene;
    this.motion = new RadialMotion();
    this.resources = new Map();
    this.lines = [];
    this.glyphs = [];
    this.version = 0;
    this.effectStarted = null;
    this.uniforms = { presentationOpacity:{value:1}, angles: { value: this.motion.angles }, radius: { value: 1 }, effectTime: { value: 2 }, brightness: { value: 1.25 }, tint: { value: new THREE.Color(1,1,1) } };
  }

  setText(text) {
    const THREE = this.THREE;
    const entries = this.engine.buildLines(text);
    const retained = new Map();
    const available = new Map();
    for (const line of this.lines) {
      const queue = available.get(line.entry.mesh) || [];
      queue.push(line);
      available.set(line.entry.mesh, queue);
    }
    this.glyphs = [];
    this.triangleCount = 0;
    this.lines = entries.map(entry => {
      let geometry = retained.get(entry.mesh) || this.resources.get(entry.mesh);
      if (!geometry) {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(entry.mesh.positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(entry.mesh.colors, 3));
        geometry.setAttribute('delay', new THREE.BufferAttribute(entry.mesh.delays, 1));
        geometry.computeBoundingBox();
      }
      retained.set(entry.mesh, geometry);
      let line = available.get(entry.mesh)?.shift();
      if (!line) {
        const material = new THREE.ShaderMaterial({
          uniforms: { ...this.uniforms, baseline: { value: entry.baseline } },
          vertexShader, fragmentShader, side: THREE.DoubleSide, transparent: true,
          depthWrite: false, extensions: { derivatives: true },
        });
        const mesh = new THREE.Mesh(geometry, material);
        // Positions move in the vertex shader, outside the undeformed bounding box.
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        line = { mesh };
      }
      line.entry = entry;
      line.mesh.material.uniforms.baseline.value = entry.baseline;
      for (const glyph of entry.mesh.glyphRects) {
        this.glyphs.push({ ...glyph, y: glyph.y + entry.baseline, index: glyph.index + entry.offset });
      }
      this.triangleCount += entry.mesh.triangleCount;
      return line;
    });
    for (const queue of available.values()) for (const line of queue) {
      this.scene.remove(line.mesh);
      line.mesh.material.dispose();
    }
    for (const [key, geometry] of this.resources) if (!retained.has(key)) geometry.dispose();
    this.resources = retained;
    this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const { mesh, entry } of this.lines) {
      if (!entry.mesh.positions.length) continue;
      const box = mesh.geometry.boundingBox;
      this.bounds.minX = Math.min(this.bounds.minX, box.min.x);
      this.bounds.maxX = Math.max(this.bounds.maxX, box.max.x);
      this.bounds.minY = Math.min(this.bounds.minY, box.min.y + entry.baseline);
      this.bounds.maxY = Math.max(this.bounds.maxY, box.max.y + entry.baseline);
    }
    if (!Number.isFinite(this.bounds.minX)) this.bounds = { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
    const b = this.bounds;
    this.motion.radius = Math.max(0.001, Math.hypot(Math.max(Math.abs(b.minX), Math.abs(b.maxX)), Math.max(Math.abs(b.minY), Math.abs(b.maxY))));
    this.uniforms.radius.value = this.motion.radius;
    this.effectStarted = null;
    this.uniforms.effectTime.value = 2;
    this.version++;
  }

  startEffect(now) { this.effectStarted = now; this.uniforms.effectTime.value = 0; }

  caretMaterial() {
    const material = new this.THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, baseline: { value: 0 }, effectTime: { value: 2 } },
      vertexShader, fragmentShader, side: this.THREE.DoubleSide, transparent: true,
      depthTest: false, depthWrite: false, extensions: { derivatives: true },
    });
    material.defaultAttributeValues.delay = [0];
    return material;
  }

  caretGeometry(p) {
    // One column of square cells, at the same sampling density as the font.
    const rows = this.engine.divisions || 48;
    const cell = p.height / rows;
    const positions = [], colors = [];
    for (let row = 0; row < rows; row++) {
      for (const [index, [u, v]] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]].entries()) {
        positions.push(p.x + (u - 0.5) * cell, p.bottom + (row + v) * cell, 0.04);
        const coverage = index < 3 ? 1 : 0.7;
        colors.push(coverage, coverage, coverage);
      }
    }
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new this.THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }

  overlayMaterial(alpha) {
    const material = new this.THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, baseline: { value: 0 }, effectTime: { value: 2 } },
      vertexShader, fragmentShader: `varying vec3 vColor; void main(){gl_FragColor=vec4(vColor, ${alpha.toFixed(2)});}`,
      side: this.THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false,
    });
    material.defaultAttributeValues.delay = [0];
    return material;
  }

  step(dt, now) {
    if (this.motion.step(dt)) this.version++;
    if (this.effectStarted !== null) {
      this.uniforms.effectTime.value = (now - this.effectStarted) / 1000;
      if (this.uniforms.effectTime.value >= 1.5) this.effectStarted = null;
    }
    return this.motion.active || this.effectStarted !== null;
  }

  dispose() {
    for (const line of this.lines) { this.scene.remove(line.mesh); line.mesh.material.dispose(); }
    for (const geometry of this.resources.values()) geometry.dispose();
    this.resources.clear();
    this.lines = [];
  }
}

// Shared path: one draw per distinct glyph, with one XY offset per occurrence.
export class SharedTextScene extends TextScene {
  setText(text) {
    const THREE = this.THREE, scale = this.engine.scale;
    const entries = this.engine.layout(text).entries;
    const groups = new Map();
    this.glyphs = []; this.triangleCount = 0;
    for (const entry of entries) for (const item of entry.metrics.items) {
      const { glyph, x, ch, i } = item;
      if (!glyph) continue;
      const baseline = entry.baseline * scale;
      this.glyphs.push({ x: (x-glyph.drawOffsetX)*scale, y: baseline-glyph.height*scale,
        width: glyph.width*scale, height:glyph.height*scale, character:ch,
        index:entry.offset+entry.metrics.utf16Offsets[i] });
      const count = glyph.meshData?.triangleCount ?? glyph.triangles?.length ?? 0;
      if (!count) continue;
      let offsets = groups.get(glyph);
      if (!offsets) groups.set(glyph, offsets=[]);
      offsets.push(x*scale, baseline);
      this.triangleCount += count;
    }
    const previous = this.sharedGroups || new Map(), next = new Map();
    this.bounds = {minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
    this.bufferBytes = 0;this.textureBytes=0;
    for (const [glyph, offsets] of groups) {
      let resource = previous.get(glyph);
      if (resource && resource.scale !== scale) { this.releaseShared(resource); resource=null; }
      if (!resource) {
        const local = this.engine.buildLine({items:[{glyph,x:0,ch:'',i:0}],utf16Offsets:[0]});
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position',new THREE.BufferAttribute(local.positions,3));
        geometry.setAttribute('color',new THREE.BufferAttribute(local.colors,3));
        geometry.setAttribute('delay',new THREE.BufferAttribute(local.delays,1));
        geometry.computeBoundingBox();
        const shader = vertexShader.replace('attribute float delay;', 'attribute float delay; attribute vec2 glyphOffset;')
          .replace('position + vec3(0.0, baseline, 0.0)', 'position + vec3(glyphOffset, 0.0)')
          .replace('(effectTime - delay)', '(effectTime - fract(delay + dot(glyphOffset, vec2(0.173, 0.317))))');
        const material = new THREE.ShaderMaterial({uniforms:{...this.uniforms,baseline:{value:0}},
          vertexShader:shader,fragmentShader,side:THREE.DoubleSide,transparent:true,depthWrite:false,extensions:{derivatives:true}});
        let releaseTexture=null;
        if(glyph.rasterSurface){
          geometry.setAttribute('rasterUV',new THREE.BufferAttribute(glyph.meshData.uvs,2));
          applyRasterTextureShader(material,{mask:glyph.rasterSurface.mask!==false});
          releaseTexture=attachRasterTexture(THREE,material,glyph.rasterSurface);
        }
        const mesh = new THREE.Mesh(geometry,material);mesh.frustumCulled=false;this.scene.add(mesh);
        resource={mesh,scale,releaseTexture};
      }
      const geometry=resource.mesh.geometry;
      let attribute=geometry.getAttribute('glyphOffset');
      // Keep the same GPU buffer while capacity suffices; edits upload only offsets.
      if (!attribute || attribute.count < offsets.length/2 ||
          (attribute.array.length > 32 && offsets.length < attribute.array.length / 4)) {
        // Replacing a BufferAttribute does not release its old GPU buffer in Three.
        if (attribute) geometry.dispose();
        const capacity = 2 ** Math.ceil(Math.log2(Math.max(8, offsets.length)));
        attribute=new THREE.InstancedBufferAttribute(new Float32Array(capacity),2);
        geometry.setAttribute('glyphOffset',attribute);
      }
      let changed = geometry.instanceCount !== offsets.length / 2 || attribute.version === 0;
      for (let i=0; i<offsets.length && !changed; i++) changed = attribute.array[i] !== Math.fround(offsets[i]);
      if (changed) {
        attribute.array.set(offsets);
        attribute.updateRange.offset=0; attribute.updateRange.count=offsets.length;
        attribute.needsUpdate=true;
      }
      geometry.instanceCount=offsets.length/2;
      const box=geometry.boundingBox;
      for(let i=0;i<offsets.length;i+=2){
        this.bounds.minX=Math.min(this.bounds.minX,box.min.x+offsets[i]);
        this.bounds.maxX=Math.max(this.bounds.maxX,box.max.x+offsets[i]);
        this.bounds.minY=Math.min(this.bounds.minY,box.min.y+offsets[i+1]);
        this.bounds.maxY=Math.max(this.bounds.maxY,box.max.y+offsets[i+1]);
      }
      for(const attr of Object.values(geometry.attributes))this.bufferBytes+=attr.array.byteLength;
      if(glyph.rasterSurface)this.textureBytes+=glyph.rasterSurface.rgba.byteLength;
      next.set(glyph,resource);
    }
    for(const [glyph,resource] of previous)if(!next.has(glyph))this.releaseShared(resource);
    this.sharedGroups=next;this.drawCalls=next.size;
    if(!Number.isFinite(this.bounds.minX))this.bounds={minX:-.5,maxX:.5,minY:-.5,maxY:.5};
    const b=this.bounds;
    this.motion.radius=Math.max(.001,Math.hypot(Math.max(Math.abs(b.minX),Math.abs(b.maxX)),Math.max(Math.abs(b.minY),Math.abs(b.maxY))));
    this.uniforms.radius.value=this.motion.radius;this.effectStarted=null;this.uniforms.effectTime.value=2;this.version++;
  }
  releaseShared(resource){this.scene.remove(resource.mesh);resource.mesh.geometry.dispose();resource.mesh.material.dispose();resource.releaseTexture?.();}
  dispose(){for(const resource of this.sharedGroups?.values() || [])this.releaseShared(resource);this.sharedGroups?.clear();super.dispose();}
}
