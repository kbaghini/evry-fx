import { documentDirection } from './text-direction.js';
import { FontMeshEngine, shapeLine } from './font-mesh-engine.js';
import { FontRasterizer } from './font-rasterizer.js';
import { rasterToTriangles } from './mesh-generator-core.js';
import { shapeNativeRuns, nativeRunMetrics } from './native-run-shaping.js';
import { rasterToTextureMesh } from './raster-texture-mesh.js';
import { normalizeTextMeshOptions, textDivisionsForSize } from './text-mesh-density.js';

let familySequence = 0;

export class RuntimeFontEngine extends FontMeshEngine {
  constructor({ textRendering = 'coverage', divisions = textRendering === 'texture' ? 'auto' : 48, weight = 400, cacheLimit = 512, cacheBudgetBytes = 8 * 1024 * 1024, ...options } = {}) {
    super(options);
    normalizeTextMeshOptions({textRendering,divisions});
    this.divisionMode=divisions;
    this.divisions = divisions==='auto'?textDivisionsForSize(16):divisions;
    this.displayFontSize=null;this.densityChanges=0;
    this.textRendering=textRendering;
    this.weight = weight;
    if (!Number.isInteger(cacheLimit) || cacheLimit < 0 || !Number.isFinite(cacheBudgetBytes) || cacheBudgetBytes < 0) throw new RangeError('Invalid cache limits');
    this.cacheLimit = cacheLimit;
    this.cacheBudgetBytes = Math.floor(cacheBudgetBytes);
    this.cacheBytes = 0; this.activeBytes = 0; this.evicted = 0;
    this.generated = 0;
    this.generationMs = 0;
    this.lastUsed = new Map();
    this.clock = 0;
  }

  async loadFont(source) {
    const started = performance.now();
    let buffer;
    if (source instanceof Blob) buffer = await source.arrayBuffer();
    else {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`بارگذاری فونت ناموفق بود (${response.status}).`);
      buffer = await response.arrayBuffer();
    }
    const family = `THDRuntime${++familySequence}`;
    const nextFace = await new FontFace(family, buffer, { weight: '100 900' }).load();
    if (this.face) document.fonts.delete(this.face);
    this.face = nextFace; document.fonts.add(nextFace);
    this.rasterizer = new FontRasterizer(family, this.weight);
    this.clearMeshes();
    const ascent = this.rasterizer.ascent + 2, descent = this.rasterizer.descent + 2;
    this.fontMetrics = { ascent, descent, height: ascent + descent };
    this.lineAdvance = this.fontMetrics.height * Math.max(1, this.lineHeight);
    this.fontLoadMs = performance.now() - started;
    return { bytes: buffer.byteLength, fontLoadMs: this.fontLoadMs };
  }

  clearMeshes() {
    this.meshRevision = (this.meshRevision || 0) + 1;
    this.records.clear(); this.lastUsed.clear(); this.lineCache.clear(); this.cachedLayout = null;
    this.generated = 0; this.generationMs = 0;
    this.cacheBytes = 0; this.activeBytes = 0; this.evicted = 0;
    this.rasterizer?.cache.clear();
  }

  setDivisions(value) {
    normalizeTextMeshOptions({textRendering:this.textRendering,divisions:value});
    this.divisionMode=value;
    const next=value==='auto'?textDivisionsForSize(this.displayFontSize):value;
    if (next === this.divisions) return;
    this.divisions = next; this.clearMeshes();
  }

  setDisplayFontSize(pixels) {
    if(this.divisionMode!=='auto'||!Number.isFinite(pixels)||pixels<=0)return false;
    const next=textDivisionsForSize(pixels,this.displayFontSize===null?null:this.divisions);
    this.displayFontSize=pixels;
    if(next===this.divisions)return false;
    this.divisions=next;this.densityChanges++;
    // Keep source rasters and GPU texture identity. Replace glyph geometry lazily;
    // the scene can display its previous records until preparation commits.
    this.meshRevision=(this.meshRevision||0)+1;
    this.lineCache.clear();this.cachedLayout=null;
    return true;
  }

  setInputLayout(direction, alignment, width = 0) {
    if (!['auto','ltr','rtl'].includes(direction) || !['left','right','auto'].includes(alignment) || !Number.isFinite(width) || width < 0) throw new TypeError('Invalid input layout');
    if (this.inputDirection === direction && this.inputAlignment === alignment && this.inputWidth === width) return false;
    this.inputDirection = direction; this.inputAlignment = alignment; this.inputWidth = width;
    this.lineCache.clear(); this.cachedLayout = null;
    this.meshRevision = (this.meshRevision || 0) + 1;
    return true;
  }

  shape(line) {
    const direction = this.inputDirection === 'auto' ? undefined : this.inputDirection;
    return this.nativeShaping ? shapeNativeRuns(line, direction) : shapeLine(line, direction);
  }
  metricsForLine(line, shaping) {
    const metrics = this.nativeShaping ? nativeRunMetrics(this,line,shaping) : super.layoutLine(line, shaping);
    if (this.inputAlignment) {
      let left = Infinity, right = -Infinity;
      for (const item of metrics.items) {
        left = Math.min(left, item.x); right = Math.max(right, item.x + (item.glyph?.advance || 0));
      }
      if (!metrics.items.length) left = right = 0;
      const rightAligned = this.inputAlignment === 'auto' ? documentDirection(line, 'ltr') === 'rtl' : this.inputAlignment === 'right';
      const shift = rightAligned ? this.inputWidth / 2 - right : -this.inputWidth / 2 - left;
      for (const item of metrics.items) item.x += shift;
      metrics.boundary = metrics.boundary.map(x => x + shift);
      for (const edges of metrics.caretEdges?.values() || []) for (const edge of edges) edge.x += shift;
      for (const caret of metrics.carets) caret.x += shift;
      for (const cell of metrics.cells || []) cell.x += shift;
    }
    return metrics;
  }

  selectionRects(text,start,end) {
    if (!this.nativeShaping) return super.selectionRects(text,start,end);
    if(start>=end)return [];
    const result=[];
    for(const entry of this.layout(text).entries){
      const box=this.fontLineBox(entry.baseline);
      const cells=entry.metrics.cells.filter(c=>c.start+entry.offset<end && c.end+entry.offset>start && c.width>0).sort((a,b)=>a.x-b.x);
      let run;
      for(const cell of cells){
        const x=cell.x*this.scale,right=(cell.x+cell.width)*this.scale;
        if(run && x<=run.x+run.width+1e-6)run.width=Math.max(right,run.x+run.width)-run.x;
        else {run={x,y:box.bottom,width:right-x,height:box.height};result.push(run);}
      }
    }
    return result;
  }

  layoutLine(line) {
    if (!this.rasterizer) throw new Error('ابتدا فایل فونت را بارگذاری کنید.');
    const shaping = this.shape(line);
    for (const item of shaping.items) {
      if (item.control) continue;
      this.ensureGlyph(item);
    }
    return this.metricsForLine(line, shaping);
  }

  ensureGlyph(item) {
      const key = `${item.key}:${item.form}`;
      this.lastUsed.delete(key); this.lastUsed.set(key, ++this.clock);
      const previous=this.records.get(key);
      if (previous && (this.textRendering!=='texture'||previous.divisions===this.divisions)) return;
      const started = performance.now();
      const raster = previous?.rasterSurface?{...previous.rasterSurface,baseline:previous.rasterBaseline,advance:previous.advance,drawOffsetX:previous.drawOffsetX}:this.rasterizer.raster(item.rasterText, item.direction);
      const textured=this.textRendering==='texture';
      const meshData = textured?rasterToTextureMesh(raster.rgba,raster.width,raster.height,this.divisions):rasterToTriangles(raster.rgba, raster.width, raster.height, this.divisions, true, 10);
      // Raster canvases can grow for unusual marks; align their real baseline
      // with the fixed font-wide origin used by selection and caret.
      const shift = this.fontMetrics.ascent - raster.baseline;
      if (shift) for (let i = 1; i < meshData.coordinates.length; i += 2) meshData.coordinates[i] += shift;
      const byteLength = meshData.coordinates.byteLength + meshData.coverage.byteLength + (textured?meshData.uvs.byteLength+raster.rgba.byteLength:0);
      this.cacheBytes += byteLength-(previous?.byteLength||0);
      this.records.set(key, { cacheKey: key, byteLength, meshData, width: raster.width, height: this.fontMetrics.height,
        baseline: this.fontMetrics.ascent, advance: raster.advance, drawOffsetX: raster.drawOffsetX,
        ...(textured?{divisions:this.divisions,rasterBaseline:raster.baseline,rasterSurface:previous?.rasterSurface||{width:raster.width,height:raster.height,rgba:raster.rgba}}:{}) });
      this.rasterizer.cache.clear(); // The optional texture is owned/accounted by its glyph record.
      this.generated++;
      this.generationMs += performance.now() - started;
  }

  async prepareText(text, { cancelled = () => false, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), budgetMs = 4, buildGeometry = true } = {}) {
    const revision = this.meshRevision;
    const stale = () => cancelled() || revision !== this.meshRevision;
    let started = performance.now(), sliceStart = started, slices = 0, maxSliceMs = 0;
    const nextCache = new Map();
    try {
    for (const line of text.split(/\r?\n/u)) {
      if (stale()) return null;
      let metrics = nextCache.get(line) || this.lineCache.get(line);
      if (!metrics) {
        const shaping = this.shape(line);
        for (const item of shaping.items) {
          if (stale()) return null;
          if (!item.control) this.ensureGlyph(item);
          if (performance.now() - sliceStart >= budgetMs) {
            maxSliceMs = Math.max(maxSliceMs, performance.now() - sliceStart);
            slices++; await yieldTask(); sliceStart = performance.now();
          }
        }
        if (stale()) return null;
        metrics = this.metricsForLine(line, shaping);
      }
      // Prepare each line's GPU arrays before the atomic scene update.
      if (buildGeometry) this.buildLine(metrics);
      nextCache.set(line, metrics);
      if (performance.now() - sliceStart >= budgetMs) {
        maxSliceMs = Math.max(maxSliceMs, performance.now() - sliceStart);
        slices++; await yieldTask(); sliceStart = performance.now();
      }
    }
    if (stale()) return null;
    maxSliceMs = Math.max(maxSliceMs, performance.now() - sliceStart);
    this.lineCache = nextCache; this.cachedLayout = null;
    return { elapsedMs: performance.now() - started, slices, maxSliceMs };
    } finally {
      // Cancelled jobs may have populated the glyph cache; trim them too.
      if (revision === this.meshRevision) this.trimCache();
    }
  }

  layout(text) {
    if (this.cachedLayout?.text === text) return this.cachedLayout;
    const result = super.layout(text);
    this.trimCache();
    return result;
  }

  trimCache() {
    // Reuse shaped metrics, including unchanged lines; no bidi/layout pass here.
    const active = new Set();
    for (const metrics of this.lineCache.values()) for (const { glyph } of metrics.items) {
      if (glyph?.cacheKey && this.records.get(glyph.cacheKey) === glyph) active.add(glyph.cacheKey);
    }
    this.activeBytes = 0;
    for (const key of active) {
      this.activeBytes += this.records.get(key).byteLength;
      this.lastUsed.delete(key); this.lastUsed.set(key, ++this.clock);
    }
    // Map insertion order is LRU; count remains a guard for zero-byte glyphs.
    for (const key of this.lastUsed.keys()) {
      if (this.cacheBytes <= this.cacheBudgetBytes && this.records.size <= this.cacheLimit) break;
      if (active.has(key)) continue;
      const record = this.records.get(key);
      if (record) { this.cacheBytes -= record.byteLength; this.records.delete(key); this.evicted++; }
      this.lastUsed.delete(key);
    }
  }

  cacheStats() {
    return { bytes: this.cacheBytes, activeBytes: this.activeBytes,
      inactiveBytes: this.cacheBytes - this.activeBytes, budgetBytes: this.cacheBudgetBytes,
      overBudgetBytes: Math.max(0, this.cacheBytes - this.cacheBudgetBytes), evicted: this.evicted };
  }

  dispose() {
    this.clearMeshes();
    if (this.face) document.fonts.delete(this.face);
    this.face = null; this.rasterizer = null;
  }
}
