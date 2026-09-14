import bidiFactory from '../assets/vendor/bidi.min.js';

// bidi-js 1.0.3, Unicode 13 UAX #9; vendored locally with its MIT license.
export const bidi = bidiFactory();
export const isBidiControl = ch => /^[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]$/u.test(ch);

// Horizontal keyboard navigation deliberately follows the whole document.
export function documentDirection(text, fallback = 'rtl') {
  for (const ch of text) {
    const type = bidi.getBidiCharTypeName(ch);
    if (type === 'L') return 'ltr';
    if (type === 'R' || type === 'AL') return 'rtl';
  }
  return fallback;
}

// UTF-16 logical runs for visual effects; neutral characters inherit resolved bidi levels.
export function directionalRanges(text,start,end,base='auto'){
  const {levels}=bidi.getEmbeddingLevels(text,base==='auto'?undefined:base),ranges=[];
  for(let i=start;i<end;i++){
    const direction=levels[i]%2?'rtl':'ltr',last=ranges.at(-1);
    if(last?.direction===direction)last.end=i+1;else ranges.push({start:i,end:i+1,direction});
  }
  return ranges;
}
