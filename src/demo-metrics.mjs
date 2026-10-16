// Presentation helpers keep absent measurements distinct from measured zero.
export const measuredNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function coreMeasurements(result,events=[]){
  const assets=events.filter(e=>e.type==='asset'&&measuredNumber(e.ms)!==null);
  return {inferenceMs:measuredNumber(result?.inferenceMs),totalMs:measuredNumber(result?.totalMs),preparationMs:measuredNumber(result?.preparationMs),downloadMs:assets.length?assets.reduce((s,e)=>s+e.ms,0):null,downloaded:assets.length>0,reused:result?.cold===false};
}
export function modelCompute(summary){return {macs:measuredNumber(summary?.knownMacs??summary?.totalMacs),flops:measuredNumber(summary?.knownFlops??summary?.totalFlops),unknown:measuredNumber(summary?.unknownOperatorCount)};}
export const CORE_FLOWS={
  detect:[['画像','写真を1枚選ぶ'],['形をそろえる','320 × 320のRGB値に変換'],['モデルで検出','物体の種類と位置を推定'],['結果を整理','重複を除き、枠を表示']],
  search:[['検索文','探したい内容を入力'],['意味を数値にする','384個の数値へ変換'],['文書と比べる','8件の文書との類似度を計算'],['近い順に表示','関連する文書を探す']]
};
