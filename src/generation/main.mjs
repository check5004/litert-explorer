import {MODEL,SAMPLES,exactGet,validateFinalModelUrl,validatePrompt,blockOtherChannels,fixedProperty,supportsRelaxedSimd,createServiceWorkerGate} from './policy.mjs';
const $ = id => document.getElementById(id);
const originalFetch=window.fetch.bind(window);
fixedProperty(window,'fetch',async(input,init={})=>{
  const url=exactGet(input,init,location.href,[MODEL.url]);
  const response=await originalFetch(url,{method:'GET',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',cache:'no-store',signal:init.signal,mode:'cors'});
  validateFinalModelUrl(response.url);
  return response;
});
blockOtherChannels(window);
let worker=null,abort=null,epoch=0,state='empty',file=null,startAt=0,visibleAt=null,clock=null;
let mainPreparation=false;
const expectedScope=new URL('../',import.meta.url).href;
const expectedScriptURL=new URL('sw.js',expectedScope).href;
const swGate=createServiceWorkerGate({serviceWorker:navigator.serviceWorker,expectedScope,expectedScriptURL,MessageChannel:globalThis.MessageChannel,setTimeout:globalThis.setTimeout?.bind(globalThis),clearTimeout:globalThis.clearTimeout?.bind(globalThis)});
const hasController=()=>!swGate.isAccepted();
async function verifyController(){
 const captured=epoch;
 const accepted=await swGate.validate({isCurrent:()=>captured===epoch});
 if(captured!==epoch)return;
 if(!accepted||!swGate.isAccepted()){fail(new Error('Service Workerの配信ポリシーを確認できません。サイトを再読み込み・更新してください。古いCoreオフライン設定のままでは、この実験を開始しません。'));return;}
 setState(state);
}
const traces=new Map();
const ms=value=>Number.isFinite(value)?(value/1000).toFixed(2)+' s':'—';
function status(text){$('status').textContent=text;}
function setState(value){
 state=value;const busy=['loading','generating'].includes(value),ack=$('ack').checked,controlled=hasController();
 $('download').disabled=busy||mainPreparation||!ack||controlled;$('local-load').disabled=busy||mainPreparation||!ack||!file||controlled;
 $('file').disabled=busy||mainPreparation;$('ack').disabled=busy||mainPreparation;$('run').disabled=value!=='ready'||controlled||mainPreparation;
 $('prompt').disabled=busy;$('limit').disabled=busy;$('stop').disabled=!busy;
 $('release').disabled=!worker||busy;
 $('state').textContent=value==='stopped'&&mainPreparation?'停止済み・読み取り/ハッシュの終了待ち':({empty:'未読み込み',loading:'読み込み中',ready:'準備完了',generating:'生成中',stopped:'停止済み',error:'エラー'})[value];
}
function resetMetrics(){for(const id of ['elapsed','visible-time','worker-time','sdk-ttft','generated-tokens','prefill-tokens','decode-speed','chunk-count','context-tokens'])$(id).textContent='—';}
function trace(name,value){
 traces.set(name,value);$('trace').replaceChildren();
 for(const [key,item] of traces){const li=document.createElement('li'),title=document.createElement('b'),time=document.createElement('span');title.textContent=key;time.textContent=item.status==='running'?'実行中':item.status==='failed'?'失敗':item.status==='interrupted'?'中断':ms(item.milliseconds);li.append(title,time);$('trace').append(li);}
}
function finishPending(value){for(const [name,item] of [...traces])if(item.status==='running')trace(name,{status:value});}
function clearGenerationTraces(){
 for(const name of ['createConversation','sendMessageStreaming','getBenchmarkInfo','Conversation.delete'])traces.delete(name);
 $('trace').replaceChildren();for(const [name,item] of [...traces])trace(name,item);
}
function changedPrompt(){
 if(['loading','generating'].includes(state))return;
 $('output').textContent='';resetMetrics();
 clearGenerationTraces();
 if(state==='ready')status('入力を変更しました。「生成する」で新しい結果を作成してください。');
}
function clearClock(){clearInterval(clock);clock=null;}
function destroy(){worker?.terminate();worker=null;abort?.abort();abort=null;if(clock!==null)$('elapsed').textContent=ms(performance.now()-startAt);clearClock();}
function fail(error,id=epoch){if(id!==epoch)return;epoch++;destroy();finishPending('failed');$('progress').hidden=true;setState('error');$('error').hidden=false;$('error').textContent=error instanceof Error?error.message:String(error);status('停止しました。ファイルを再読み込みするか、明示的に再ダウンロードしてください。');}
function beginLoad(){
 if(mainPreparation)throw new Error('前の読み取り/ハッシュ処理の終了を待っています。');
 if(!$('ack').checked)throw new Error('PC向けの実験であることを確認してください。');
 if(hasController())throw new Error('Service Workerの配信ポリシー確認が未完了です。ページを再読み込みしてください。');
 if(!globalThis.crypto?.subtle)throw new Error('HTTPS または localhost の安全な環境が必要です。');
 if(!supportsRelaxedSimd())throw new Error('Wasm relaxed SIMD対応のデスクトップブラウザが必要です。');
 destroy();epoch++;mainPreparation=true;setState('loading');$('error').hidden=true;$('output').textContent='';resetMetrics();traces.clear();$('trace').replaceChildren();$('progress').hidden=false;$('progress').value=0;return epoch;
}
function endMainPreparation(id){mainPreparation=false;setState(state);if(id!==epoch&&state==='stopped')status('停止済み。Main側の読み取り/ハッシュ処理も終了しました。再実行にはモデルを再読み込みしてください。メモリの回収時期はブラウザに依存します。');}
async function verifyAndStart(buffer,id){
 if(id!==epoch)return;
 if(buffer.byteLength!==MODEL.bytes)throw new Error('指定モデルのサイズ（373,719,040 bytes）と一致しません。');
 status('SHA-256でモデル全体を検証中。まだ推論は始めていません。');trace('SHA-256 検証 (Main)',{status:'running'});
 const before=performance.now(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(id!==epoch)return;
 if(hash!==MODEL.sha256)throw new Error('SHA-256が一致しません。指定の公式モデル以外は読み込みません。');
 trace('SHA-256 検証 (Main)',{status:'done',milliseconds:performance.now()-before});
 $('progress').hidden=true;status('モデル検証済み。隔離したWorkerでLiteRTを初期化しています。');
 if(!swGate.isAccepted())throw new Error('Service Workerの制御が変わったため初期化を中止しました。');
 worker=new Worker(new URL('./runtime/lm-worker.js',import.meta.url),{name:'litert-english-lab'});
 worker.onerror=event=>{event.preventDefault();fail(new Error('Workerの実行に失敗しました。モデルを再読み込みしてください。'),id);};
 worker.onmessage=({data})=>{
  if(id!==epoch)return;
  if(data.type==='phase')trace(data.name,data);
  else if(data.type==='blocked-network')fail(new Error('予期しない通信をブロックしたため、Workerを停止しました。'),id);
  else if(data.type==='ready'){setState('ready');status('モデル準備完了。英語の架空の文章を入力し、「生成する」を押してください。');}
  else if(data.type==='chunk'){
   if(state!=='generating')return;
   if(typeof data.text==='string'&&data.text){
    if(visibleAt===null){visibleAt=performance.now()-startAt;$('visible-time').textContent=ms(visibleAt);}
    $('output').textContent+=data.text;
   }
   $('chunk-count').textContent=String(data.chunks);$('worker-time').textContent=ms(data.workerFirstObservedChunkMs);
  } else if(data.type==='complete'){
   clearClock();setState('ready');$('elapsed').textContent=ms(performance.now()-startAt);
   const m=data.metrics||{};$('sdk-ttft').textContent=Number.isFinite(m.timeToFirstTokenInSecond)?m.timeToFirstTokenInSecond.toFixed(2)+' s':'—';
   $('generated-tokens').textContent=Number.isFinite(m.lastDecodeTokenCount)?String(m.lastDecodeTokenCount):'—';
   $('prefill-tokens').textContent=Number.isFinite(m.lastPrefillTokenCount)?String(m.lastPrefillTokenCount):'—';
   $('decode-speed').textContent=Number.isFinite(m.lastDecodeTokensPerSecond)?m.lastDecodeTokensPerSecond.toFixed(2)+' token/s':'—';
   $('context-tokens').textContent=Number.isFinite(data.contextTokens)?String(data.contextTokens):'—';
   status('生成完了。内容は未検証です。次の実行は新しい会話として開始します。');
  } else if(data.type==='error')fail(new Error(data.message),id);
 };
 if(!swGate.isAccepted())throw new Error('Service Workerの制御が変わったため初期化を中止しました。');
 worker.postMessage({type:'initialize',buffer},[buffer]);
}
async function downloadModel(){
 if(mainPreparation||['loading','generating'].includes(state))return;
 let id;
 try{
  id=beginLoad();abort=new AbortController();const signal=abort.signal;const before=performance.now();trace('公式モデル GET',{status:'running'});status('公式Hugging Faceから約374 MBを取得中。入力文は送信しません。');
  const response=await fetch(MODEL.url,{signal});
  if(!response.ok||!response.body)throw new Error('モデルを取得できませんでした。HTTP '+response.status);
  // Content-Length can describe compressed transfer bytes; decoded byte count and SHA-256 are authoritative.
  const chunks=[];let size=0;const reader=response.body.getReader();
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MODEL.bytes)throw new Error('配布モデルが想定サイズを超えています。');chunks.push(value);if(id!==epoch){await reader.cancel();return;}$('progress').value=size/MODEL.bytes;status('公式モデル取得中：'+(size/1000000).toFixed(1)+' / 373.7 MB');}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(size!==MODEL.bytes)throw new Error('モデルの取得が不完全です。');
  const buffer=new ArrayBuffer(size);const bytes=new Uint8Array(buffer);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}chunks.length=0;
  trace('公式モデル GET',{status:'done',milliseconds:performance.now()-before});abort=null;
  await verifyAndStart(buffer,id);
 }catch(error){if(id===undefined){$('error').hidden=false;$('error').textContent=error.message;}else fail(error,id);}
 finally{if(id!==undefined)endMainPreparation(id);}
}
$('file').addEventListener('change',()=>{file=$('file').files?.[0]||null;$('filename').textContent=file?file.name+' · '+(file.size/1000000).toFixed(1)+' MB':'未選択';if(file&&file.size!==MODEL.bytes){$('error').hidden=false;$('error').textContent='指定モデルとサイズが異なります。373,719,040 bytesのファイルを選んでください。';file=null;}setState(state);});
$('local-load').addEventListener('click',async()=>{if(mainPreparation||['loading','generating'].includes(state))return;let id;try{if(!file)throw new Error('指定モデルのファイルを選択してください。');id=beginLoad();const start=performance.now();trace('File.arrayBuffer',{status:'running'});const buffer=await file.arrayBuffer();if(id!==epoch)return;trace('File.arrayBuffer',{status:'done',milliseconds:performance.now()-start});await verifyAndStart(buffer,id);}catch(error){if(id===undefined){$('error').hidden=false;$('error').textContent=error.message;}else fail(error,id);}finally{if(id!==undefined)endMainPreparation(id);}});
$('download').addEventListener('click',downloadModel);
$('ack').addEventListener('change',()=>setState(state));
$('run').addEventListener('click',()=>{
 try{if(!swGate.isAccepted())throw new Error('Service Workerの制御を再確認してください。');const prompt=validatePrompt($('prompt').value);if(state!=='ready'||!worker)throw new Error('モデルを読み込んでください。');$('error').hidden=true;$('output').textContent='';resetMetrics();clearGenerationTraces();visibleAt=null;startAt=performance.now();setState('generating');status('CPUで生成中。最初の表示まで十数秒かかり、まとめて表示される場合があります。');$('elapsed').textContent='0.00 s';clock=setInterval(()=>{$('elapsed').textContent=ms(performance.now()-startAt);},100);worker.postMessage({type:'generate',prompt,maxOutputTokens:Number($('limit').value)});}
 catch(error){$('error').hidden=false;$('error').textContent=error.message;}
});
$('stop').addEventListener('click',()=>{epoch++;destroy();finishPending('interrupted');setState('stopped');$('progress').hidden=true;status(mainPreparation?'Workerとダウンロードを停止しました。Main側の読み取り/ハッシュ処理は中止できないため、終了を待っています。その間は新しい読み込みを開始しません。':'停止しました。Workerを破棄しました。続けるには再読み込みが必要です。表示済みの文章は途中結果です。メモリの回収時期はブラウザに依存します。');});
$('release').addEventListener('click',()=>{epoch++;destroy();setState('empty');status('Workerを破棄しました。次の利用にはモデルを再読み込みしてください。');});
for(const [index,prompt] of SAMPLES.entries()){const button=document.createElement('button');button.className='sample';button.textContent=['架空の問い合わせを整える','短い文を補完する','架空のロボットを描写する'][index];button.addEventListener('click',()=>{if(!['loading','generating'].includes(state)){$('prompt').value=prompt;changedPrompt();}});$('samples').append(button);}
$('prompt').addEventListener('input',changedPrompt);
$('prompt').value=SAMPLES[0];$('hash').textContent=MODEL.sha256;$('model-link').href=MODEL.url;
function interruptForNavigation(){swGate.invalidate();epoch++;destroy();finishPending('interrupted');$('progress').hidden=true;setState('stopped');status('ページ移動でWorkerとモデルを破棄しました。表示中の文章は移動前の結果で、生成途中なら未完了です。再初期化が必要です。');}
window.addEventListener('pagehide',interruptForNavigation);
window.addEventListener('pageshow',event=>{
 if(!event.persisted)return;
 interruptForNavigation();
 void verifyController();
 status(mainPreparation?'ページを復元しました。以前のWorkerは停止済みです。Main側の読み取り/ハッシュ処理の終了を待ってから再読み込みできます。':'ページを復元しました。以前のWorkerは破棄済みです。表示中の文章は移動前の結果（途中停止なら未完了）です。モデルを再初期化してください。');
});
navigator.serviceWorker?.addEventListener('controllerchange',()=>{swGate.invalidate();fail(new Error('Service Workerの制御が変わったためモデルとWorkerを破棄しました。ページを再読み込みして配信ポリシーを再確認してください。'));});
setState('empty');
void verifyController();
