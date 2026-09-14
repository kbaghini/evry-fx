import { JOINING_FORMS } from './font-mesh-engine.js';
import { integrateTenSamples } from './triangle-coverage.js';

export const DIVISIONS = [24, 36, 48, 60, 72];
export const PERSIAN_ALPHABET = 'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
export const EXTRA_CHARACTERS = ['أ', 'إ', 'ؤ', 'ئ', 'هٔ', 'اً'];
export const SAMPLE_TEXT = 'آ ا ب پ ت ث ج چ ح خ د ذ ر ز ژ\nس ش ص ض ط ظ ع غ ف ق ک گ ل م ن و ه ی\nپدر، پنجره، سپید، توپ؛ چشمه، پژوهش و زندگی\nخانۀ ما، خانهٔ ما؛ لطفاً، واقعاً، سؤال، مسئول\n۰۱۲۳۴۵۶۷۸۹  ٠١٢٣٤٥٦٧٨٩  0123456789\nABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz';

export function repertoire(extras = true) {
  const chars = [...new Set(Array.from(PERSIAN_ALPHABET + 'ء' + '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
    ' `~!@#$%^&*()-_=+[]{}\\|;:\'",.<>/?،؛؟«»٪٫٬'))];
  if (extras) chars.push(...EXTRA_CHARACTERS);
  return chars.flatMap(character => {
    const base = Array.from(character)[0];
    const marks = Array.from(character).slice(1).join('');
    const variants = JOINING_FORMS[base] || [base];
    return variants.map((form, formIndex) => ({ character, formIndex,
      rasterText: (formIndex === 0 ? base : form) + marks }));
  });
}

// Exact antialiased coverage by default; runtime text can opt into the tested
// ten-point approximation. Both paths share the same grid and output format.
export function rasterToTriangles(rgba, width, height, divisions, packed = false, coverageSamples = 0) {
  if (!DIVISIONS.includes(divisions)) throw new Error('تقسیمات نامعتبر است.');
  if (coverageSamples !== 0 && coverageSamples !== 10) throw new RangeError('Coverage samples must be 0 (all pixels) or 10');
  const rows = divisions, columns = Math.max(1, Math.round(width / (height / rows)));
  const cellWidth = width / columns, cellHeight = height / rows;
  const sums = new Float64Array(rows * columns * 2);
  const counts = new Uint32Array(sums.length);
  // Keep exact integration for export and for cells already smaller than the
  // sample budget. Runtime callers opt into ten-point coverage explicitly.
  if (coverageSamples === 10 && cellWidth * cellHeight > 20) integrateTenSamples(rgba,width,height,rows,columns,cellWidth,cellHeight,sums,counts);
  else if (width > 1024) integrateWideRaster(rgba,width,height,rows,columns,cellWidth,cellHeight,sums,counts);
  else for (let y = 0; y < height; y++) {
    const gy = (y + 0.5) / cellHeight, row = Math.min(rows - 1, Math.floor(gy)), fy = gy - row;
    for (let x = 0; x < width; x++) {
      const gx = (x + 0.5) / cellWidth, column = Math.min(columns - 1, Math.floor(gx)), fx = gx - column;
      const side = (row + column) % 2 === 0 ? (fx + fy <= 1 ? 0 : 1) : (fy <= fx ? 0 : 1);
      const slot = (row * columns + column) * 2 + side;
      sums[slot] += rgba[(y * width + x) * 4 + 3] / 255;
      counts[slot]++;
    }
  }
  let triangleCount = 0;
  if (packed) for (let at = 0; at < sums.length; at++) if (sums[at] >= 0.08) triangleCount++;
  // Float64 preserves font-space arithmetic until the final GPU Float32 write.
  const coordinates = packed ? new Float64Array(triangleCount * 6) : null;
  const coverage = packed ? new Uint8Array(triangleCount) : null;
  const triangles = packed ? null : [];
  let triangleIndex = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = column * cellWidth, right = (column + 1) * cellWidth;
    const top = row * cellHeight, bottom = (row + 1) * cellHeight;
    const even = (row + column) % 2 === 0;
    const pair = packed ? null : even
      ? [[[right, top], [left, bottom], [left, top]], [[right, top], [right, bottom], [left, bottom]]]
      : [[[left, top], [right, bottom], [right, top]], [[left, top], [left, bottom], [right, bottom]]];
    for (let side = 0; side < 2; side++) {
      const at = (row * columns + column) * 2 + side;
      if (sums[at] < 0.08) continue;
      const level = Math.max(1, Math.min(6, Math.round(sums[at] / counts[at] * 6)));
      if (packed) {
        const at = triangleIndex * 6;
        coordinates[at] = even ? right : left;
        coordinates[at + 1] = top;
        coordinates[at + 2] = even ? (side ? right : left) : (side ? left : right);
        coordinates[at + 3] = bottom;
        coordinates[at + 4] = even ? left : right;
        coordinates[at + 5] = side ? bottom : top;
        coverage[triangleIndex++] = level;
      } else triangles.push({ points: pair[side], average: level / 6 });
    }
  }
  return packed ? { coordinates, coverage, triangleCount } : triangles;
}

// Long paragraphs have many pixels per grid cell. Resolve each axis once and
// accumulate locally instead of dividing and writing two arrays per pixel.
// Within each triangle pixels retain the reference's y/x order and /255 sum;
// grid boundaries, threshold decisions and quantized coverage remain identical.
function integrateWideRaster(rgba,width,height,rows,columns,cellWidth,cellHeight,sums,counts){
  function axis(size,step,bins){
    const starts=new Uint32Array(bins+1),fractions=new Float64Array(size);let previous=0;
    for(let pixel=0;pixel<size;pixel++){
      const grid=(pixel+.5)/step,bin=Math.min(bins-1,Math.floor(grid));fractions[pixel]=grid-bin;
      while(previous<bin)starts[++previous]=pixel;
    }
    starts.fill(size,previous+1);return {starts,fractions};
  }
  const x=axis(width,cellWidth,columns),y=axis(height,cellHeight,rows);
  for(let row=0;row<rows;row++){
    const top=y.starts[row],bottom=y.starts[row+1];if(top===bottom)continue;
    for(let column=0;column<columns;column++){
      const left=x.starts[column],right=x.starts[column+1];if(left===right)continue;
      const even=(row+column)%2===0;let sum0=0,sum1=0,count0=0,count1=0;
      for(let py=top;py<bottom;py++){
        const fy=y.fractions[py];let alpha=(py*width+left)*4+3;
        for(let px=left;px<right;px++,alpha+=4){
          if(even?x.fractions[px]+fy<=1:fy<=x.fractions[px]){sum0+=rgba[alpha]/255;count0++;}
          else {sum1+=rgba[alpha]/255;count1++;}
        }
      }
      const slot=(row*columns+column)*2;
      sums[slot]=sum0;sums[slot+1]=sum1;counts[slot]=count0;counts[slot+1]=count1;
    }
  }
}

export function encodeTMG(records) {
  const size = 12 + records.reduce((sum, r) => sum + 20 + Array.from(r.character).length * 4 + r.triangles.length * 13, 0);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  bytes.set([84, 77, 71, 53, 1, 0, 0, 0]);
  view.setUint32(8, records.length, true);
  let offset = 12;
  for (const r of records) {
    const codePoints = Array.from(r.character, ch => ch.codePointAt(0));
    view.setUint8(offset++, codePoints.length);
    for (const cp of codePoints) { view.setUint32(offset, cp, true); offset += 4; }
    view.setUint8(offset++, r.formIndex);
    for (const value of [r.width, r.height]) { view.setUint16(offset, value, true); offset += 2; }
    for (const value of [r.advance, r.baseline]) { view.setFloat32(offset, value, true); offset += 4; }
    view.setUint16(offset, r.drawOffsetX, true); offset += 2;
    view.setUint32(offset, r.triangles.length, true); offset += 4;
    for (const t of r.triangles) {
      for (const [x, y] of t.points) {
        view.setUint16(offset, Math.round(x / r.width * 65535), true);
        view.setUint16(offset + 2, Math.round(y / r.height * 65535), true); offset += 4;
      }
      view.setUint8(offset++, Math.round(t.average * 6));
    }
  }
  if (offset !== size) throw new Error('اندازهٔ خروجی با رکوردها سازگار نیست.');
  return bytes;
}

export async function compressTMG(records) {
  return new Blob([await new Response(new Blob([encodeTMG(records)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()], { type: 'application/gzip' });
}

export function assertCoverage(records, extras = true) {
  const map = new Map(records.map(r => [`${r.character}:${r.formIndex}`, r]));
  const missing = repertoire(extras).filter(r => {
    const found = map.get(`${r.character}:${r.formIndex}`);
    return !found || (r.character.trim() && !found.triangles.length);
  });
  return missing.map(r => `${r.character}:${r.formIndex}`);
}
