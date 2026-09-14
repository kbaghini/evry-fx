import { bidi } from './text-direction.js';
const segmenter = new Intl.Segmenter('fa', { granularity: 'grapheme' });

export function shapeNativeRuns(line, direction) {
  const embedding = bidi.getEmbeddingLevels(line, direction);
  const ranks = new Map(bidi.getReorderedIndices(line, embedding).map((index, rank) => [index, rank]));
  const items = [];
  let cp = 0;
  for (const { segment, index } of segmenter.segment(line)) {
    const level = embedding.levels[index] || 0;
    let run = items.at(-1);
    if (!run || run.level !== level) {
      run = { ch:'', i:cp, utf16:index, level, rank:ranks.get(index) ?? 0, form:0, direction:level & 1 ? 'rtl':'ltr' };
      items.push(run);
    }
    run.ch += segment; run.rank = Math.min(run.rank, ranks.get(index) ?? 0);
    cp += Array.from(segment).length;
  }
  for (const run of items) { run.key = `native:${run.direction}:${run.ch}`; run.rasterText = run.ch; }
  items.sort((a,b)=>a.rank-b.rank);
  return { logical:Array.from(line), items };
}

export function nativeRunMetrics(engine, line, shaping) {
  const {logical}=shaping;
  const items=shaping.items.map(run=>({...run,glyph:engine.records.get(`${run.key}:0`)}));
  const width=items.reduce((sum,item)=>sum+item.glyph.advance,0);
  const boundary=new Array(logical.length+1), cells=[];
  let pen=-width/2;
  for(const item of items){
    item.x=pen;
    const advance=item.glyph.advance;
    engine.rasterizer.configure(item.direction);
    const segments=Array.from(segmenter.segment(item.ch));
    let cp=item.i, previous=item.level&1?pen+advance:pen;
    boundary[cp]=previous;
    for(let i=0;i<segments.length;i++){
      const segment=segments[i];
      const end=segment.index+segment.segment.length;
      // Canvas exposes whole-run advances, not font ligature caret tables.
      // Prefix measures are an experimental approximation inside joined clusters.
      const progress=i===segments.length-1?advance:Math.max(0,Math.min(advance,
        engine.rasterizer.context.measureText(item.ch.slice(0,end)).width));
      const x=item.level&1?pen+advance-progress:pen+progress;
      const length=Array.from(segment.segment).length;
      for(let j=1;j<length;j++)boundary[cp+j]=previous;
      boundary[cp+length]=x;
      cells.push({start:item.utf16+segment.index,end:item.utf16+end,x:Math.min(previous,x),width:Math.abs(x-previous)});
      previous=x;cp+=length;
    }
    pen+=advance;
  }
  boundary[0] ??= 0;
  let offset=0;
  const utf16Offsets=logical.map(ch=>{const at=offset;offset+=ch.length;return at;});utf16Offsets.push(offset);
  const lookup=new Map(utf16Offsets.map((offset,index)=>[offset,index]));
  const stops=Array.from(segmenter.segment(line),s=>s.index);stops.push(line.length);
  const carets=stops.map(index=>({index,x:boundary[lookup.get(index)]})).sort((a,b)=>a.x-b.x||a.index-b.index);
  return {text:line,items,boundary,utf16Offsets,carets,cells,height:engine.fontMetrics.height};
}
