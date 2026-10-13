import {nms} from './math.mjs';
export type Anchor=[number,number,number,number];
export type Detection={classId:number,label:string,score:number,anchorIndex:number,box:number[]};
/** Exact fixed anchors and decode flags come from this model's embedded metadata. */
export function decodeDetections(scores:Float32Array,boxes:Float32Array,threshold:number,anchors:Anchor[],labels:string[]):Detection[]{
 if(anchors.length!==19206||scores.length!==19206*90||boxes.length!==19206*4||labels.length!==90)throw Error('検出モデルの出力・アンカー・ラベルの契約が一致しません。');
 if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('検出しきい値が不正です。');
 const candidates:Detection[]=[];
 for(let a=0;a<anchors.length;a++){
  let classId=0,score=-Infinity;for(let c=0;c<90;c++)if(scores[a*90+c]>score){score=scores[a*90+c];classId=c}
  if(!Number.isFinite(score)||score<threshold||labels[classId]==='???')continue;
  // Metadata: x/y/w/h scale=1, exponential size=true, sigmoid=false.
  // Raw location format: [dy, dx, dh, dw]. Anchors: [xCenter,yCenter,width,height].
  const [ax,ay,aw,ah]=anchors[a],dy=boxes[a*4],dx=boxes[a*4+1],dh=boxes[a*4+2],dw=boxes[a*4+3];
  const cy=dy*ah+ay,cx=dx*aw+ax,h=Math.exp(dh)*ah,w=Math.exp(dw)*aw;
  if(![cy,cx,h,w].every(Number.isFinite))continue;
  const clamp=(v:number)=>Math.max(0,Math.min(1,v));const box=[clamp(cy-h/2),clamp(cx-w/2),clamp(cy+h/2),clamp(cx+w/2)];
  if(box[2]<=box[0]||box[3]<=box[1])continue;
  candidates.push({classId,label:labels[classId],score,anchorIndex:a,box});
 }
 return nms(candidates,.5,20);
}
