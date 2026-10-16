import {MODEL,MODELS,getModel,exactGet,validateFinalModelUrl,validatePrompt,supportsRelaxedSimd,createServiceWorkerGate} from './policy.mjs';

/**
 * The shell supplies the panel fragment and owns the shared window transport policy.
 * Mounting/activating never imports the SDK, downloads a model, or creates a Worker.
 * Every departure releases the model and requires a new acknowledgement and load.
 */
export function mountGeneration(root,{assetBase,appBase}) {
 const $=id=>root.querySelector('#'+id);
 const assets=new URL(assetBase),app=new URL(appBase);
 for(const base of [assets,app])if(!base.pathname.endsWith('/')||base.search||base.hash||base.username||base.password)throw new TypeError('Panel bases must be absolute directory URLs.');
 if(assets.origin!==app.origin)throw new TypeError('Generation assets must share the application origin.');
 const doc=root.ownerDocument||document;
 const stylesheet=doc.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('style.css',assets).href;root.prepend(stylesheet);
 let selectedModel=MODEL;
 const originalFetch=window.fetch.bind(window);
 async function fetchModel(input,init={},model=selectedModel) {
  const url=exactGet(input,init,app.href,[model.url]);
  const response=await originalFetch(url,{method:'GET',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',cache:'no-store',signal:init.signal,mode:'cors'});
  validateFinalModelUrl(response.url,model);
  return response;
 }
 let worker=null,abort=null,epoch=0,state='empty',file=null,startAt=0,visibleAt=null,clock=null;
 let mainPreparation=false,active=false,disposed=false,swGate=null,activatedBefore=false;
 const listeners=[],traces=new Map();
 const ms=value=>Number.isFinite(value)?(value/1000).toFixed(2)+' s':'—';
 const isCurrent=id=>active&&!disposed&&id===epoch;
 const hasController=()=>!swGate?.isAccepted();
 const listen=(target,name,handler)=>{target.addEventListener(name,handler);listeners.push(()=>target.removeEventListener(name,handler));};
 function status(text){$('status').textContent=text;}
 function setState(value){
  state=value;
  const unavailable=!active||disposed,busy=['loading','generating'].includes(value),ack=$('ack').checked,controlled=hasController();
  $('model').disabled=unavailable;
  $('download').disabled=unavailable||busy||mainPreparation||!ack||controlled;
  $('local-load').disabled=unavailable||busy||mainPreparation||!ack||!file||controlled;
  $('file').disabled=unavailable||busy||mainPreparation;$('ack').disabled=unavailable||busy||mainPreparation;
  $('run').disabled=unavailable||value!=='ready'||controlled||mainPreparation;
  $('prompt').disabled=unavailable||busy;$('limit').disabled=unavailable||busy;
  $('stop').disabled=unavailable||!busy;$('release').disabled=unavailable||!worker||busy;
  for(const button of $('samples').children)button.disabled=unavailable||busy;
  $('state').textContent=value==='stopped'&&mainPreparation?'停止済み・読み取り/ハッシュの終了待ち':({empty:'未読み込み',loading:'読み込み中',ready:'準備完了',generating:'生成中',stopped:'停止済み',error:'エラー'})[value];
 }
 function resetMetrics(){for(const id of ['elapsed','visible-time','worker-time','sdk-ttft','generated-tokens','prefill-tokens','decode-speed','chunk-count','context-tokens'])$(id).textContent='—';}
 function resetLoadMetrics(){for(const id of ['download-time','setup-time'])$(id).textContent='—';}
 function trace(name,value){
  traces.set(name,value);$('trace').replaceChildren();
  for(const [key,item] of traces){const li=doc.createElement('li'),title=doc.createElement('b'),time=doc.createElement('span');title.textContent=key;time.textContent=item.status==='running'?'実行中':item.status==='failed'?'失敗':item.status==='interrupted'?'中断':ms(item.milliseconds);li.append(title,time);$('trace').append(li);}
 }
 function finishPending(value){for(const [name,item] of [...traces])if(item.status==='running')trace(name,{status:value});}
 function clearGenerationTraces(){
  for(const name of ['createConversation','sendMessageStreaming','getBenchmarkInfo','Conversation.delete'])traces.delete(name);
  $('trace').replaceChildren();for(const [name,item] of [...traces])trace(name,item);
 }
 function changedPrompt(){
  if(!active||disposed||['loading','generating'].includes(state))return;
  $('output').textContent='';resetMetrics();clearGenerationTraces();
  if(state==='ready')status('入力を変更しました。「生成する」で新しい結果を作成してください。');
 }
 function clearClock(){clearInterval(clock);clock=null;}
 function destroy(){
  worker?.terminate();worker=null;abort?.abort();abort=null;
  if(clock!==null)$('elapsed').textContent=ms(performance.now()-startAt);clearClock();
 }
 function fail(error,id=epoch){
  if(!isCurrent(id))return;
  epoch++;destroy();finishPending('failed');$('progress').hidden=true;$('output').textContent='';resetMetrics();
  setState('error');$('error').hidden=false;$('error').textContent=error instanceof Error?error.message:String(error);
  status('処理を停止し、未完了の結果を消去しました。ファイルを再読み込みするか、明示的に再ダウンロードしてください。');
 }
 async function verifyController(){
  const captured=epoch,gate=swGate;
  const accepted=await gate.validate({isCurrent:()=>isCurrent(captured)&&gate===swGate});
  if(!isCurrent(captured)||gate!==swGate)return;
  if(!accepted||!gate.isAccepted()){fail(new Error('Service Workerの配信ポリシーを確認できません。サイトを再読み込み・更新してください。古いCoreオフライン設定のままでは、この実験を開始しません。'));return;}
  setState(state);
 }
 function beginLoad(){
  if(!active||disposed)throw new Error('文章生成タブを開いてから開始してください。');
  if(mainPreparation)throw new Error('前の読み取り/ハッシュ処理の終了を待っています。');
  if(!$('ack').checked)throw new Error('PC向けの実験であることを確認してください。');
  if(hasController())throw new Error('Service Workerの配信ポリシー確認が未完了です。ページを再読み込みしてください。');
  if(!globalThis.crypto?.subtle)throw new Error('HTTPS または localhost の安全な環境が必要です。');
  if(!supportsRelaxedSimd())throw new Error('Wasm relaxed SIMD対応のデスクトップブラウザが必要です。');
  destroy();epoch++;mainPreparation=true;setState('loading');$('error').hidden=true;$('output').textContent='';resetMetrics();resetLoadMetrics();traces.clear();$('trace').replaceChildren();$('progress').hidden=false;$('progress').value=0;return epoch;
 }
 function endMainPreparation(id){
  // File.arrayBuffer() and subtle.digest() cannot be aborted. Never release this
  // single-flight lock merely because the panel was stopped, hidden, or disposed.
  mainPreparation=false;
  if(disposed)return;
  setState(state);
  if(id!==epoch&&state==='stopped')status('停止済み。Main側の読み取り/ハッシュ処理も終了しました。確認欄を確認し、モデルを再読み込みしてください。メモリの回収時期はブラウザに依存します。');
 }
 async function verifyAndStart(buffer,id,model){
  if(!isCurrent(id))return;
  if(buffer.byteLength!==model.bytes)throw new Error('選択モデルのサイズ（'+model.bytes.toLocaleString()+' bytes）と一致しません。');
  const setupStartedAt=performance.now();
  status('SHA-256でモデル全体を検証中。まだ推論は始めていません。');trace('SHA-256 検証 (Main)',{status:'running'});
  const before=performance.now(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!isCurrent(id))return;
  if(hash!==model.sha256)throw new Error('SHA-256が一致しません。指定の公式モデル以外は読み込みません。');
  trace('SHA-256 検証 (Main)',{status:'done',milliseconds:performance.now()-before});
  $('progress').hidden=true;status('モデル検証済み。隔離したWorkerでLiteRTを初期化しています。');
  if(!swGate?.isAccepted())throw new Error('Service Workerの制御が変わったため初期化を中止しました。');
  worker=new Worker(new URL('runtime/lm-worker.js',assets),{name:'litert-generation-lab'});
  worker.onerror=event=>{event.preventDefault();fail(new Error('Workerの実行に失敗しました。モデルを再読み込みしてください。'),id);};
  worker.onmessage=({data})=>{
   if(!isCurrent(id))return;
   if(data.type==='phase')trace(data.name,data);
   else if(data.type==='blocked-network')fail(new Error('予期しない通信をブロックしたため、Workerを停止しました。'),id);
   else if(data.type==='ready'){
    if(state!=='loading')return;
    $('setup-time').textContent=ms(performance.now()-setupStartedAt);
    setState('ready');status(model.title+'の準備ができました。入力を確認して「生成する」を押してください。');
   } else if(data.type==='chunk'){
    if(state!=='generating')return;
    if(typeof data.text==='string'&&data.text){
     if(visibleAt===null){visibleAt=performance.now()-startAt;$('visible-time').textContent=ms(visibleAt);}
     $('output').textContent+=data.text;
    }
    $('chunk-count').textContent=String(data.chunks);$('worker-time').textContent=ms(data.workerFirstObservedChunkMs);
   } else if(data.type==='complete'){
    if(state!=='generating')return;
    clearClock();setState('ready');$('elapsed').textContent=ms(performance.now()-startAt);
    const m=data.metrics||{};$('sdk-ttft').textContent=Number.isFinite(m.timeToFirstTokenInSecond)?m.timeToFirstTokenInSecond.toFixed(2)+' s':'—';
    $('generated-tokens').textContent=Number.isFinite(m.lastDecodeTokenCount)?String(m.lastDecodeTokenCount):'—';
    $('prefill-tokens').textContent=Number.isFinite(m.lastPrefillTokenCount)?String(m.lastPrefillTokenCount):'—';
    $('decode-speed').textContent=Number.isFinite(m.lastDecodeTokensPerSecond)?m.lastDecodeTokensPerSecond.toFixed(2)+' token/s':'—';
    $('context-tokens').textContent=Number.isFinite(data.contextTokens)?String(data.contextTokens):'—';
    status('生成完了。内容は未検証です。次の実行は新しい会話として開始します。');
   } else if(data.type==='error')fail(new Error(data.message),id);
  };
  if(!isCurrent(id)||!swGate?.isAccepted())throw new Error('Service Workerの制御が変わったため初期化を中止しました。');
  worker.postMessage({type:'initialize',modelId:model.id,buffer},[buffer]);
 }
 async function downloadModel(){
  if(!active||disposed||mainPreparation||['loading','generating'].includes(state))return;
  let id;const model=selectedModel;
  try{
   id=beginLoad();abort=new AbortController();const signal=abort.signal;const before=performance.now();trace('公式モデル GET',{status:'running'});status('Hugging Faceから'+model.downloadLabel+'を取得中。入力文は送信しません。');
   const response=await fetchModel(model.url,{signal},model);
   if(!isCurrent(id)){await response.body?.cancel().catch(()=>{});return;}
   if(!response.ok||!response.body)throw new Error('モデルを取得できませんでした。HTTP '+response.status);
   // Content-Length can describe compressed transfer bytes; decoded byte count and SHA-256 are authoritative.
   const chunks=[];let size=0;const reader=response.body.getReader();
   try{
    while(true){
     const {value,done}=await reader.read();
     if(!isCurrent(id)){await reader.cancel();return;}
     if(done)break;
     size+=value.byteLength;if(size>model.bytes)throw new Error('配布モデルが想定サイズを超えています。');
     chunks.push(value);$('progress').value=size/model.bytes;status('公式モデル取得中：'+(size/1000000).toFixed(1)+' / '+(model.bytes/1000000).toFixed(1)+' MB');
    }
   }catch(error){await reader.cancel().catch(()=>{});throw error;}
   if(size!==model.bytes)throw new Error('モデルの取得が不完全です。');
   const buffer=new ArrayBuffer(size),bytes=new Uint8Array(buffer);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}chunks.length=0;
   const downloadMs=performance.now()-before;trace('公式モデル GET',{status:'done',milliseconds:downloadMs});$('download-time').textContent=ms(downloadMs);abort=null;
   await verifyAndStart(buffer,id,model);
  }catch(error){if(id===undefined){$('error').hidden=false;$('error').textContent=error.message;}else fail(error,id);}
  finally{if(id!==undefined)endMainPreparation(id);}
 }
 listen($('file'),'change',()=>{
  if(!active||disposed||mainPreparation||['loading','generating'].includes(state))return;
  file=$('file').files?.[0]||null;$('filename').textContent=file?file.name+' · '+(file.size/1000000).toFixed(1)+' MB':'未選択';
  if(file&&file.size!==selectedModel.bytes){$('error').hidden=false;$('error').textContent='選択モデルとサイズが異なります。'+selectedModel.bytes.toLocaleString()+' bytesのファイルを選んでください。';file=null;}
  setState(state);
 });
 listen($('local-load'),'click',async()=>{
  if(!active||disposed||mainPreparation||['loading','generating'].includes(state))return;
  let id;const model=selectedModel;
  try{
   if(!file)throw new Error('指定モデルのファイルを選択してください。');
   id=beginLoad();const start=performance.now();trace('File.arrayBuffer',{status:'running'});
   const buffer=await file.arrayBuffer();if(!isCurrent(id))return;
   const readMs=performance.now()-start;trace('File.arrayBuffer',{status:'done',milliseconds:readMs});$('download-time').textContent=ms(readMs);await verifyAndStart(buffer,id,model);
  }catch(error){if(id===undefined){$('error').hidden=false;$('error').textContent=error.message;}else fail(error,id);}
  finally{if(id!==undefined)endMainPreparation(id);}
 });
 listen($('download'),'click',downloadModel);
 listen($('ack'),'change',()=>{if(!disposed)setState(state);});
 listen($('run'),'click',()=>{
  if(!active||disposed)return;
  try{
   if(!swGate?.isAccepted())throw new Error('Service Workerの制御を再確認してください。');
   const prompt=validatePrompt($('prompt').value,selectedModel);
   if(state!=='ready'||!worker)throw new Error('モデルを読み込んでください。');
   $('error').hidden=true;$('output').textContent='';resetMetrics();clearGenerationTraces();visibleAt=null;startAt=performance.now();
   setState('generating');status('CPUで生成中。数十秒かかり、文字列が最後にまとめて届く場合があります。');$('elapsed').textContent='0.00 s';
   clock=setInterval(()=>{if(active&&!disposed)$('elapsed').textContent=ms(performance.now()-startAt);},100);
   worker.postMessage({type:'generate',prompt,maxOutputTokens:Number($('limit').value)});
  }catch(error){
   if(state==='generating')fail(error);
   else{$('error').hidden=false;$('error').textContent=error.message;}
  }
 });
 listen($('stop'),'click',()=>{
  if(!active||disposed||!['loading','generating'].includes(state))return;
  epoch++;destroy();finishPending('interrupted');setState('stopped');$('progress').hidden=true;
  status(mainPreparation?'Workerとダウンロードを停止しました。Main側の読み取り/ハッシュ処理は中止できないため、終了を待っています。その間は新しい読み込みを開始しません。':'停止しました。Workerを破棄しました。続けるには再読み込みが必要です。表示済みの文章は途中結果です。メモリの回収時期はブラウザに依存します。');
 });
 listen($('release'),'click',()=>{
  if(!active||disposed||['loading','generating'].includes(state))return;
  epoch++;destroy();setState('empty');status('Workerを破棄しました。次の利用にはモデルを再読み込みしてください。');
 });
 for(const [index] of MODEL.samples.entries()){
  const button=doc.createElement('button');button.className='sample';
  listen(button,'click',()=>{if(active&&!disposed&&!['loading','generating'].includes(state)){$('prompt').value=selectedModel.samples[index];changedPrompt();}});$('samples').append(button);
 }
 for(const model of MODELS){
  const option=doc.createElement('option');option.value=model.id;option.textContent=model.title+' · '+model.languages+' · '+model.downloadLabel;$('model').append(option);
 }
 function renderModel(){
  $('model').value=selectedModel.id;$('prompt').value=selectedModel.samples[0];
  $('hash').textContent=selectedModel.sha256;$('model-link').href=selectedModel.url;
  $('model-card').href=selectedModel.cardUrl;$('license-link').href=selectedModel.licenseUrl;
  $('model-details').textContent=selectedModel.name+' / '+selectedModel.bytes.toLocaleString()+' bytes / revision '+selectedModel.revision;
  $('model-memory').textContent=selectedModel.memory;
  $('model-language').textContent=selectedModel.inputHint;
  $('model-summary').textContent=selectedModel.title+' · '+selectedModel.languages+' · '+selectedModel.downloadLabel;
  $('download').textContent=selectedModel.downloadLabel+'を取得して準備する';
  for(const [index,button] of [...$('samples').children].entries())button.textContent=selectedModel.sampleNames[index];
 }
 listen($('model'),'change',()=>{
  if(!active||disposed)return;
  let next;try{next=getModel($('model').value);}catch(error){$('model').value=selectedModel.id;$('error').hidden=false;$('error').textContent=error.message;return;}
  if(next===selectedModel)return;
  epoch++;destroy();selectedModel=next;file=null;$('file').value='';$('filename').textContent='未選択';
  $('ack').checked=false;$('output').textContent='';$('error').hidden=true;$('progress').hidden=true;$('progress').value=0;
  resetMetrics();resetLoadMetrics();traces.clear();$('trace').replaceChildren();renderModel();setState(mainPreparation?'stopped':'empty');
  status(mainPreparation?'モデルを切り替えました。前の読み取り/ハッシュ処理の終了を待っています。終了後、確認欄をチェックして読み込んでください。':'モデルを切り替え、前のモデルと結果を消去しました。確認欄をチェックし、選択したモデルを読み込んでください。');
  // A switch invalidates the epoch captured by an in-flight SW handshake.
  // Revalidate the new epoch instead of leaving the selector permanently blocked.
  if(!swGate?.isAccepted())void verifyController();
 });
 listen($('prompt'),'input',changedPrompt);
 renderModel();
 function interrupt(reason){
  swGate?.invalidate();epoch++;destroy();finishPending('interrupted');$('progress').hidden=true;
  $('ack').checked=false;$('output').textContent='';resetMetrics();resetLoadMetrics();$('error').hidden=true;setState('stopped');
  status(reason+(mainPreparation?' Main側の読み取り/ハッシュ処理は中止できないため終了待ちです。':'')+' Workerとモデルを破棄し、結果を消去しました。確認欄をもう一度チェックして、モデルを再初期化してください。');
 }
 function onPageHide(){if(active&&!disposed)interrupt('ページを離れたため停止しました。');}
 function onPageShow(event){
  if(!event.persisted||!active||disposed)return;
  interrupt('ページを復元しました。');void verifyController();
 }
 function onControllerChange(){
  if(!active||disposed)return;
  swGate?.invalidate();fail(new Error('Service Workerの制御が変わったためモデルとWorkerを破棄しました。ページを再読み込みして配信ポリシーを再確認してください。'));
 }
 function activate(){
  if(disposed)throw new Error('The generation panel has been disposed.');
  if(active)return;
  active=true;
  swGate=createServiceWorkerGate({serviceWorker:navigator.serviceWorker,expectedScope:app.href,expectedScriptURL:new URL('sw.js',app).href,MessageChannel:globalThis.MessageChannel,setTimeout:globalThis.setTimeout?.bind(globalThis),clearTimeout:globalThis.clearTimeout?.bind(globalThis)});
  window.addEventListener('pagehide',onPageHide);window.addEventListener('pageshow',onPageShow);
  navigator.serviceWorker?.addEventListener('controllerchange',onControllerChange);
  $('ack').checked=false;
  if(activatedBefore)status(mainPreparation?'以前の読み取り/ハッシュ処理の終了を待っています。確認欄をもう一度チェックし、モデルを再初期化してください。':'モデルは破棄済みです。確認欄をもう一度チェックし、モデルを再初期化してください。');
  activatedBefore=true;setState(state);void verifyController();
 }
 function deactivate(reason='tab-change'){
  if(disposed)return;
  active=false;
  interrupt(reason==='dispose'?'パネルを終了しました。':'タブを離れたため停止しました。');
  window.removeEventListener('pagehide',onPageHide);window.removeEventListener('pageshow',onPageShow);
  navigator.serviceWorker?.removeEventListener('controllerchange',onControllerChange);
  swGate?.dispose();swGate=null;setState(state);
 }
 function dispose(){
  if(disposed)return;
  deactivate('dispose');disposed=true;
  for(const remove of listeners)remove();listeners.length=0;stylesheet.remove();file=null;
 }
 setState('empty');
 return Object.freeze({activate,deactivate,dispose});
}
