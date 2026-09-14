// Reuse a single canvas. A common vertical origin keeps all joining forms aligned.
export class FontRasterizer {
  constructor(family, weight = 200) {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.font = `${weight} 200px "${family}"`;
    this.configure();
    const metric = this.context.measureText('آبپچگژهمیABCgj');
    this.ascent = Math.ceil(Math.max(metric.fontBoundingBoxAscent || 0, metric.actualBoundingBoxAscent || 0));
    this.descent = Math.ceil(Math.max(metric.fontBoundingBoxDescent || 0, metric.actualBoundingBoxDescent || 0));
    this.cache = new Map();
  }

  configure(direction = 'ltr') {
    this.context.font = this.font;
    // Build the cached source for legibility, independently of the GPU's cheaper
    // moving-particle sampler. Reapply after canvas resize resets drawing state.
    if ('textRendering' in this.context) this.context.textRendering = 'optimizeLegibility';
    if ('fontKerning' in this.context) this.context.fontKerning = 'normal';
    if ('letterSpacing' in this.context) this.context.letterSpacing = `${this.letterSpacing || 0}px`;
    if ('wordSpacing' in this.context) this.context.wordSpacing = `${this.wordSpacing || 0}px`;
    this.context.textAlign = 'left'; this.context.textBaseline = 'alphabetic';
    // Layout already resolves bidi and mirrors punctuation. Do not mirror it again
    // when Canvas draws an isolated, direction-neutral glyph such as a bracket.
    this.context.direction = direction; this.context.fillStyle = '#fff';
  }

  raster(text, direction = 'ltr') {
    const key = direction + ':' + text;
    if (this.cache.has(key)) return this.cache.get(key);
    this.configure(direction);
    const metric = this.context.measureText(text);
    const padding = 2;
    const drawOffsetX = Math.ceil(Math.max(0, metric.actualBoundingBoxLeft || 0)) + padding;
    const baseline = Math.ceil(Math.max(this.ascent, metric.actualBoundingBoxAscent || 0)) + padding;
    const width = Math.max(2, Math.ceil(Math.max(metric.width, metric.actualBoundingBoxRight || 0) + drawOffsetX + padding));
    const height = Math.max(2, Math.ceil(baseline + Math.max(this.descent, metric.actualBoundingBoxDescent || 0) + padding));
    this.canvas.width = width; this.canvas.height = height; this.configure(direction);
    this.context.fillText(text, drawOffsetX, baseline);
    const rgba = this.context.getImageData(0, 0, width, height).data;
    const result = { width, height, baseline, drawOffsetX, advance: metric.width, rgba };
    this.cache.set(key, result);
    return result;
  }
}

export async function collectDroppedFiles(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [], item => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = Array.from(dataTransfer.files || []);
  async function walk(entry) {
    if (entry.isFile) return [await new Promise((resolve, reject) => entry.file(resolve, reject))];
    if (!entry.isDirectory) return [];
    const reader = entry.createReader(), result = [];
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) result.push(...await walk(child));
    }
    return result;
  }
  if (!entries.length) return fallback;
  const result = [];
  for (const entry of entries) result.push(...await walk(entry));
  return result;
}
