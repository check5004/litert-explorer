export type Mode='search'|'detect';
export type Trace={step:number,name:string,state:'start'|'end',ms?:number,detail?:unknown,at:number};
export type RunResult={mode:Mode,cold:boolean,totalMs:number,inferenceMs:number,preparationMs?:number,backend:string,inputDetails:unknown,outputDetails:unknown,data:any};
export const steps=[['入力','Input'],['前処理','Preprocess'],['テンソル化','Tensor'],['モデル実行','Model.run'],['出力データ','Readback'],['後処理','Postprocess']];
