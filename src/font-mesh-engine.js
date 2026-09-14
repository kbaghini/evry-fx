const isJoinControl = (value) => value === '\u200C' || value === '\u200D';
import { bidi, isBidiControl } from './text-direction.js';
const forms = {
  'آ':['\uFE81','\uFE82'], 'أ':['\uFE83','\uFE84'], 'إ':['\uFE87','\uFE88'], 'ؤ':['\uFE85','\uFE86'], 'ئ':['\uFE89','\uFE8A','\uFE8B','\uFE8C'],
  'ا':['\uFE8D','\uFE8E'],'ب':['\uFE8F','\uFE90','\uFE91','\uFE92'],'پ':['\uFB56','\uFB57','\uFB58','\uFB59'],'ت':['\uFE95','\uFE96','\uFE97','\uFE98'],'ث':['\uFE99','\uFE9A','\uFE9B','\uFE9C'],'ج':['\uFE9D','\uFE9E','\uFE9F','\uFEA0'],'چ':['\uFB7A','\uFB7B','\uFB7C','\uFB7D'],'ح':['\uFEA1','\uFEA2','\uFEA3','\uFEA4'],'خ':['\uFEA5','\uFEA6','\uFEA7','\uFEA8'],'د':['\uFEA9','\uFEAA'],'ذ':['\uFEAB','\uFEAC'],'ر':['\uFEAD','\uFEAE'],'ز':['\uFEAF','\uFEB0'],'ژ':['\uFB8A','\uFB8B'],'س':['\uFEB1','\uFEB2','\uFEB3','\uFEB4'],'ش':['\uFEB5','\uFEB6','\uFEB7','\uFEB8'],'ص':['\uFEB9','\uFEBA','\uFEBB','\uFEBC'],'ض':['\uFEBD','\uFEBE','\uFEBF','\uFEC0'],'ط':['\uFEC1','\uFEC2','\uFEC3','\uFEC4'],'ظ':['\uFEC5','\uFEC6','\uFEC7','\uFEC8'],'ع':['\uFEC9','\uFECA','\uFECB','\uFECC'],'غ':['\uFECD','\uFECE','\uFECF','\uFED0'],'ف':['\uFED1','\uFED2','\uFED3','\uFED4'],'ق':['\uFED5','\uFED6','\uFED7','\uFED8'],'ک':['\uFB8E','\uFB8F','\uFB90','\uFB91'],'گ':['\uFB92','\uFB93','\uFB94','\uFB95'],'ل':['\uFEDD','\uFEDE','\uFEDF','\uFEE0'],'م':['\uFEE1','\uFEE2','\uFEE3','\uFEE4'],'ن':['\uFEE5','\uFEE6','\uFEE7','\uFEE8'],'ه':['\uFEE9','\uFEEA','\uFEEB','\uFEEC'],'و':['\uFEED','\uFEEE'],'ی':['\uFBFC','\uFBFD','\uFBFE','\uFBFF']
};
export { forms as JOINING_FORMS };
const graphemes = new Intl.Segmenter('fa', { granularity: 'grapheme' });
const clusterBase = value => value === 'ۀ' ? 'ه' : Array.from(value || '')[0];
const formIndexFor = (character, previous, next) => {
  if (!forms[character]) return 0;
  const joinsBefore = Boolean(forms[previous]?.length > 2);
  const joinsAfter = Boolean(forms[character]?.length > 2 && forms[next]?.length > 1);
  return forms[character].length === 2 ? (joinsBefore ? 1 : 0) : joinsBefore && joinsAfter ? 3 : joinsBefore ? 1 : joinsAfter ? 2 : 0;
};
const visualOrder = (line, direction) => {
  const chars = []; let index = 0;
  for (const { segment } of graphemes.segment(line)) {
    // Joining controls remain boundaries even when Segmenter attaches them to a letter.
    for (const ch of segment.split(/([\u200C\u200D])/u).filter(Boolean)) {
      chars.push({ ch, i: index }); index += Array.from(ch).length;
    }
  }
  const embedding = bidi.getEmbeddingLevels(line, direction);
  const order = bidi.getReorderedIndices(line, embedding);
  const ranks = new Map(order.map((logical, visual) => [logical, visual]));
  let utf16 = 0;
  for (const item of chars) {
    item.level = embedding.levels[utf16] || 0;
    item.visual = ranks.get(utf16);
    item.mirrored = item.level & 1 ? bidi.getMirroredCharacter(item.ch) : null;
    utf16 += item.ch.length;
  }
  return chars.sort((a, b) => a.visual - b.visual);
};

export function shapeLine(line, direction) {
  const logical = Array.from(line);
  const items = visualOrder(line, direction).map(({ ch, i, level, mirrored }) => {
    let previous = i - 1;
    while (previous >= 0 && /\p{Mark}/u.test(logical[previous])) previous--;
    const form = formIndexFor(clusterBase(ch), clusterBase(logical[previous]), clusterBase(logical[i + Array.from(ch).length]));
    const key = ch === 'ۀ' ? 'هٔ' : (mirrored || ch).normalize('NFC');
    const base = Array.from(key)[0];
    const rasterText = (form ? forms[base]?.[form] || base : base) + Array.from(key).slice(1).join('');
    return { ch, i, level, form, key, rasterText, control: isJoinControl(ch) || isBidiControl(ch) };
  });
  return { logical, items };
}

export class FontMeshEngine {
  constructor({ scale = 0.012, lineHeight = 1 } = {}) {
    this.scale = scale;
    this.lineHeight = lineHeight;
    this.records = new Map();
    this.lineCache = new Map();
    this.cachedLayout = null;
  }

  async load(source) {
    const compressed = source instanceof Blob ? await source.arrayBuffer() : await (await fetch(source)).arrayBuffer();
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(new Uint8Array(compressed)); writer.close();
    const bytes = new Uint8Array(await new Response(stream.readable).arrayBuffer());
    const view = new DataView(bytes.buffer);
    if (String.fromCharCode(...bytes.slice(0, 3)) !== 'TMG' || view.getUint8(3) !== 53) {
      throw new Error('فقط فرمت TMG5 پشتیبانی می‌شود.');
    }
    this.lineCache.clear();
    this.cachedLayout = null;
    this.fontMetrics = { ascent: 80, descent: 0, height: 80 };
    this.lineAdvance = 240;
    this.records.clear();
    let offset = 8;
    const count = view.getUint32(offset, true); offset += 4;
    for (let i = 0; i < count; i += 1) {
      const length = view.getUint8(offset++);
      let character = '';
      for (let j = 0; j < length; j += 1) { character += String.fromCodePoint(view.getUint32(offset, true)); offset += 4; }
      const form = view.getUint8(offset++);
      const width = view.getUint16(offset, true); offset += 2;
      const height = view.getUint16(offset, true); offset += 2;
      const advance = view.getFloat32(offset, true); offset += 4;
      const baseline = view.getFloat32(offset, true); offset += 4;
      const drawOffsetX = view.getUint16(offset, true); offset += 2;
      const triangleCount = view.getUint32(offset, true); offset += 4;
      const triangles = [];
      for (let t = 0; t < triangleCount; t += 1) {
        const points = [];
        for (let p = 0; p < 3; p += 1) {
          points.push([view.getUint16(offset, true) / 65535 * width, view.getUint16(offset + 2, true) / 65535 * height]); offset += 4;
        }
        const average = view.getUint8(offset++) / 6;
        if (average > 0) triangles.push({ points, average });
      }
      this.records.set(`${character}:${form}`, { triangles, advance, baseline, drawOffsetX, width, height });
    }
    // TMG5 stores the raster ascent and full canvas height for every glyph.
    // Resolve one font-wide box on load, never from the current text line.
    let ascent = 0, descent = 0;
    for (const glyph of this.records.values()) {
      ascent = Math.max(ascent, glyph.baseline);
      descent = Math.max(descent, glyph.height - glyph.baseline);
    }
    this.fontMetrics = { ascent, descent, height: Math.max(1, ascent + descent) };
    this.lineAdvance = Math.max(this.fontMetrics.height, this.fontMetrics.height * this.lineHeight);
    return { glyphCount: this.records.size };
  }

  // Cache font-space metrics, so changes to scale do not invalidate shaping.
  layoutLine(line, shaping = shapeLine(line)) {
    const { logical, items: shaped } = shaping;
    let meshWidth = 0;
    const items = [];
    for (const { ch, i, form, key, level, control } of shaped) {
      if (control) continue;
      const selected = this.records.get(`${key}:${form}`) || this.records.get(`${ch}:${form}`) || this.records.get(`${clusterBase(ch)}:${form}`);
      const fallback = this.records.get(`${key}:0`) || this.records.get(`${ch}:0`) || this.records.get(`${clusterBase(ch)}:0`);
      // Preserve the existing mesh centering and missing-glyph behavior.
      meshWidth += selected?.advance || fallback?.advance || 0;
      if (!isJoinControl(ch)) items.push({ ch, i, level, glyph: selected || fallback || this.records.get(' :0') });
    }
    const width = items.reduce((sum, item) => sum + (item.glyph?.advance || 0), 0);
    const boundary = new Array(logical.length + 1);
    let pen = -width / 2;
    let meshPen = -meshWidth / 2;
    for (const item of items) {
      const advance = item.glyph?.advance || 0;
      item.x = meshPen;
      meshPen += advance;
      if (item.level & 1) {
        boundary[item.i] = pen + advance;
        boundary[item.i + Array.from(item.ch).length] = pen;
      } else {
        boundary[item.i] = pen;
        boundary[item.i + Array.from(item.ch).length] = pen + advance;
      }
      pen += advance;
    }
    for (let i = 0; i < boundary.length; i++) {
      if (boundary[i] === undefined) boundary[i] = i ? boundary[i - 1] : -width / 2;
    }
    let utf16Offset = 0;
    const utf16Offsets = logical.map(ch => { const at = utf16Offset; utf16Offset += ch.length; return at; });
    utf16Offsets.push(utf16Offset);
    const stops = Array.from(graphemes.segment(line), part => part.index);
    stops.push(line.length);
    const offsetMap = new Map(utf16Offsets.map((offset, index) => [offset, index]));
    const carets = stops.map(index => ({ index, x: boundary[offsetMap.get(index)] }))
      .sort((a, b) => a.x - b.x || a.index - b.index);
    const caretEdges = new Map(), stopSet = new Set(stops);
    const addEdge = (index, x, affinity) => {
      if (!stopSet.has(index)) return;
      const edges = caretEdges.get(index) || [];
      if (!edges.some(edge => edge.x === x)) edges.push({ x, affinity });
      caretEdges.set(index, edges);
    };
    for (const item of items) {
      const left = item.x, right = left + (item.glyph?.advance || 0);
      addEdge(utf16Offsets[item.i], item.level & 1 ? right : left, 'downstream');
      addEdge(utf16Offsets[item.i + Array.from(item.ch).length], item.level & 1 ? left : right, 'upstream');
    }
    // Ordinary boundaries need no extra retained metadata.
    for (const [index, edges] of caretEdges) if (edges.length < 2) caretEdges.delete(index);
    return { text: line, items, boundary, utf16Offsets, carets, caretEdges, height: items.at(-1)?.glyph?.height || 80 };
  }

  layout(text) {
    if (this.cachedLayout?.text === text) return this.cachedLayout;
    const lines = text.split(/\r?\n/u);
    const blockHeight = Math.max(0, (lines.length - 1) * this.lineAdvance);
    const nextCache = new Map();
    let offset = 0;
    const entries = lines.map((line, index) => {
      const metrics = nextCache.get(line) || this.lineCache.get(line) || this.layoutLine(line);
      nextCache.set(line, metrics);
      const entry = { metrics, offset, length: line.length,
        baseline: 100 + (lines.length - 1 - index) * this.lineAdvance - blockHeight / 2 };
      offset += line.length + 1;
      return entry;
    });
    // Retain only lines in the current document, not the entire editing history.
    this.lineCache = nextCache;
    this.cachedLayout = { text, entries };
    return this.cachedLayout;
  }

  // Geometry is local to the line; vertical placement is a renderer uniform.
  buildLine(metrics) {
    if (metrics.mesh?.scale === this.scale) return metrics.mesh;
    const triangleCount = metrics.items.reduce((sum, { glyph }) =>
      sum + (glyph?.meshData?.triangleCount ?? glyph?.triangles?.length ?? 0), 0);
    const positions = new Float32Array(triangleCount * 9);
    const colors = new Float32Array(triangleCount * 9);
    const delays = new Float32Array(triangleCount * 3);
    let vertex = 0;
    let minY = Infinity, maxY = -Infinity;
    const glyphRects = [];
    for (const { ch: character, i, glyph, x } of metrics.items) {
      if (!glyph) continue;
      glyphRects.push({ x: (x - glyph.drawOffsetX) * this.scale, y: -glyph.height * this.scale,
        width: glyph.width * this.scale, height: glyph.height * this.scale, character, index: metrics.utf16Offsets[i] });
      const packed = glyph.meshData;
      const count = packed ? packed.triangleCount : glyph.triangles.length;
      for (let t = 0; t < count; t++) {
        const delay = Math.random();
        const average = packed ? packed.coverage[t] / 6 : glyph.triangles[t].average;
        for (let point = 0; point < 3; point++) {
          const px = packed ? packed.coordinates[t * 6 + point * 2] : glyph.triangles[t].points[point][0];
          const py = packed ? packed.coordinates[t * 6 + point * 2 + 1] : glyph.triangles[t].points[point][1];
          const y = -py * this.scale;
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          const at = vertex * 3;
          positions[at] = (x + px - glyph.drawOffsetX) * this.scale;
          positions[at + 1] = y;
          colors[at] = colors[at + 1] = colors[at + 2] = average;
          delays[vertex++] = delay;
        }
      }
    }
    metrics.mesh = { scale: this.scale, positions, colors, delays, glyphRects,
      triangleCount,
      inkMinY: Number.isFinite(minY) ? minY : -80 * this.scale,
      inkMaxY: Number.isFinite(maxY) ? maxY : 0 };
    return metrics.mesh;
  }

  buildLines(text) {
    return this.layout(text).entries.map(entry => ({ ...entry,
      baseline: entry.baseline * this.scale, mesh: this.buildLine(entry.metrics) }));
  }

  selectionRects(text, start, end) {
    if (start >= end) return [];
    const rectangles = [];
    for (const { metrics, offset, baseline } of this.layout(text).entries) {
      // Ink bounds include overhangs; advance cells partition the visual line.
      const { bottom, height } = this.fontLineBox(baseline);
      let run = null;
      for (const item of metrics.items) {
        const index = offset + metrics.utf16Offsets[item.i];
        const selected = index < end && index + item.ch.length > start;
        const advance = item.glyph?.advance || 0;
        if (!selected) { run = null; continue; }
        if (advance <= 0) continue;
        const left = item.x * this.scale;
        const right = (item.x + advance) * this.scale;
        if (run && Math.abs(run.x + run.width - left) < 1e-6) {
          run.width = right - run.x;
        } else {
          run = { x: left, y: bottom, width: right - left, height };
          rectangles.push(run);
        }
      }
    }
    return rectangles;
  }

  fontLineBox(rasterTop) {
    const baseline = rasterTop - this.fontMetrics.ascent;
    const { ascent, descent, height } = this.lineBoxMetrics || this.fontMetrics;
    return { top: (baseline + ascent) * this.scale, bottom: (baseline - descent) * this.scale,
      baseline: baseline * this.scale, height: height * this.scale,
      ascent: ascent * this.scale, descent: descent * this.scale };
  }

  // DOM selectionStart/End count UTF-16 code units, unlike Array.from().
  caretLocation(text, index) {
    const entries = this.layout(text).entries;
    const position = Math.max(0, Math.min(text.length, index));
    let low = 0, high = entries.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (position > entries[middle].offset + entries[middle].length) low = middle + 1;
      else high = middle;
    }
    const { metrics, offset, baseline } = entries[low];
    const within = position - offset;
    let char = 0, end = metrics.utf16Offsets.length - 1;
    while (char < end) {
      const middle = Math.ceil((char + end) / 2);
      if (metrics.utf16Offsets[middle] <= within) char = middle;
      else end = middle - 1;
    }
    return { metrics, char, within, baseline };
  }

  caretPositionNative(text, index, affinity) {
    const { metrics, char, within, baseline } = this.caretLocation(text, index);
    const edge = affinity && metrics.caretEdges?.get(within)?.find(edge => edge.affinity === affinity);
    return { x: (edge ? edge.x : metrics.boundary[char]) * this.scale, ...this.fontLineBox(baseline) };
  }

  caretPositionsNative(text, index) {
    const { metrics, char, within, baseline } = this.caretLocation(text, index);
    const box = this.fontLineBox(baseline), primary = metrics.boundary[char] * this.scale;
    const positions = [{ x: primary, ...box, affinity: null }];
    for (const edge of metrics.caretEdges?.get(within) || []) {
      const x = edge.x * this.scale;
      if (!positions.some(p => Math.abs(p.x - x) < 1e-8)) positions.push({ x, ...box, affinity: edge.affinity });
    }
    return positions;
  }

  verticalCaret(text, index, delta, preferredX) {
    const { entries } = this.layout(text);
    let line = 0, last = entries.length - 1;
    while (line < last) {
      const middle = (line + last) >>> 1;
      if (index > entries[middle].offset + entries[middle].length) line = middle + 1;
      else last = middle;
    }
    const x = preferredX ?? this.caretPositionNative(text, index).x;
    const target = line + delta;
    if (target < 0 || target >= entries.length) return { index, x };
    const entry = entries[target];
    const carets = entry.metrics.carets;
    let low = 0, high = carets.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (carets[middle].x * this.scale < x) low = middle + 1;
      else high = middle;
    }
    let nearest = carets[low];
    if (low && Math.abs(carets[low - 1].x * this.scale - x) <= Math.abs(nearest.x * this.scale - x)) nearest = carets[low - 1];
    return { index: entry.offset + nearest.index, x };
  }

  build(text) {
    const positions = [], colors = [], glyphRects = [];
    for (const { metrics, offset, baseline } of this.layout(text).entries) {
      for (const { ch: character, i, glyph, x } of metrics.items) {
        if (!glyph) continue;
        glyphRects.push({ x: (x - glyph.drawOffsetX) * this.scale, y: (baseline - glyph.height) * this.scale,
          width: glyph.width * this.scale, height: glyph.height * this.scale, character, index: offset + i });
        const packed = glyph.meshData;
        const count = packed ? packed.triangleCount : glyph.triangles.length;
        for (let t = 0; t < count; t++) {
          const average = packed ? packed.coverage[t] / 6 : glyph.triangles[t].average;
          for (let point = 0; point < 3; point++) {
            const px = packed ? packed.coordinates[t * 6 + point * 2] : glyph.triangles[t].points[point][0];
            const py = packed ? packed.coordinates[t * 6 + point * 2 + 1] : glyph.triangles[t].points[point][1];
            positions.push((x + px - glyph.drawOffsetX) * this.scale, (baseline - py) * this.scale, 0);
            colors.push(average, average, average);
          }
        }
      }
    }
    return { positions: new Float32Array(positions), colors: new Float32Array(colors), glyphRects, triangleCount: positions.length / 9 };
  }

  caretPosition(text, index) {
    const { entries } = this.layout(text);
    const position = Math.max(0, index);
    // Find the line without reshaping or scanning all preceding lines.
    let low = 0, high = entries.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (position > entries[middle].offset + entries[middle].length) low = middle + 1;
      else high = middle;
    }
    const { metrics, offset, baseline } = entries[low];
    const caretInLine = Math.min(metrics.boundary.length - 1, position - offset);
    return { x: metrics.boundary[caretInLine] * this.scale, baseline: baseline * this.scale,
      height: Math.max(0.3, metrics.height * this.scale) };
  }
}
