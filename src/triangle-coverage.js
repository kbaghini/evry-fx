// Ten evenly distributed interior barycentric points (four triangular rows).
// Approximate coverage for runtime text. These samples cannot prove that a
// triangle is entirely opaque; geometric merging must use exact integration.
const patterns=[];
for(const parity of [0,1])for(const side of [0,1]){
  const pair=parity===0
    ? [[[1,0],[0,1],[0,0]],[[1,0],[1,1],[0,1]]]
    : [[[0,0],[1,1],[1,0]],[[0,0],[0,1],[1,1]]];
  const points=[];
  for(let i=0;i<=3;i++)for(let j=0;j<=3-i;j++){
    const weights=[(i+1/3)/4,(j+1/3)/4,(3-i-j+1/3)/4];
    points.push(pair[side].reduce((v,p,k)=>v+p[0]*weights[k],0),pair[side].reduce((v,p,k)=>v+p[1]*weights[k],0));
  }
  patterns.push(points);
}
export function integrateTenSamples(rgba,width,height,rows,columns,cw,ch,sums,counts){
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)for(let side=0;side<2;side++){
    const points=patterns[((row+column)%2)*2+side];let sum=0;
    for(let i=0;i<20;i+=2){
      const x=Math.min(width-1,Math.floor((column+points[i])*cw)),y=Math.min(height-1,Math.floor((row+points[i+1])*ch));
      sum+=rgba[(y*width+x)*4+3]/255;
    }
    const at=(row*columns+column)*2+side;sums[at]=sum;counts[at]=10;
  }
}
