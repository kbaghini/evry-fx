// UTF-16 edit range shared by both adapters. The selection disambiguates repeats.
export function insertedRange(before,after,inputType='insertText'){
  if(!before||!after||!/^insert/.test(inputType)||before.text===after.text)return null;
  const start=before.start??0,end=before.end??start;
  const length=after.text.length-(before.text.length-(end-start));
  if(length>0&&after.text.slice(0,start)===before.text.slice(0,start)&&after.text.slice(start+length)===before.text.slice(end))return {start,end:start+length};
  let left=0,right=0;
  while(left<before.text.length&&left<after.text.length&&before.text[left]===after.text[left])left++;
  while(right<before.text.length-left&&right<after.text.length-left&&before.text[before.text.length-1-right]===after.text[after.text.length-1-right])right++;
  return after.text.length-right>left?{start:left,end:after.text.length-right}:null;
}

// Keep the surviving pieces of an older insertion when a later edit shifts it.
export function remapInsertionRange(range,start,oldEnd,delta){
  const pieces=[];
  if(range.start<start)pieces.push({start:range.start,end:Math.min(range.end,start)});
  if(range.end>oldEnd)pieces.push({start:Math.max(range.start,oldEnd)+delta,end:range.end+delta});
  return pieces.filter(piece=>piece.end>piece.start);
}

export function removedRange(before,after,inputType=''){
  if(!before||!after||!/^delete/.test(inputType))return null;
  const length=before.text.length-after.text.length;if(length<=0)return null;
  const caret=before.start??0;
  const start=before.end>caret?caret:/Backward$/.test(inputType)?Math.max(0,caret-length):caret;
  if(before.text.slice(0,start)+before.text.slice(start+length)===after.text)return {start,end:start+length};
  let left=0;while(left<after.text.length&&before.text[left]===after.text[left])left++;
  return {start:left,end:left+length};
}
