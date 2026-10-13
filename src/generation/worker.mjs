import {MODEL,LOADER,WASM,exactGet,blockOtherChannels,fixedProperty,supportsRelaxedSimd,validatePrompt,textFromChunk,finiteMetrics} from './policy.mjs';

const post = (type, data = {}) => self.postMessage({type,...data});
const wasmUrl = new URL(WASM, self.location.href).href;
const loaderUrl = new URL(LOADER, self.location.href).href;
const originalFetch = self.fetch.bind(self);
const originalImportScripts = self.importScripts.bind(self);
let networkOpen = true;
const audit = channel => post('blocked-network',{channel});
// These guards are installed before the delayed SDK import below.
fixedProperty(self,'fetch',async (input,init={}) => {
  if (!networkOpen) {audit('fetch-after-init');throw new Error('Runtime networking is closed after initialization');}
  let url;
  try {url=exactGet(input,init,self.location.href,[wasmUrl]);}
  catch(error){audit('fetch-rejected');throw error;}
  const response = await originalFetch(url,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:init.signal});
  if (!response.ok || response.url !== wasmUrl) throw new Error('Wasm asset response rejected');
  return response;
});
fixedProperty(self,'importScripts',(...urls) => {
  if (!networkOpen || urls.length !== 1 || new URL(String(urls[0]),self.location.href).href !== loaderUrl) {audit('importScripts');throw new Error('Unexpected runtime script blocked');}
  originalImportScripts(loaderUrl);
});
blockOtherChannels(self,audit);
fixedProperty(self,'Worker',class {constructor(){audit('nested-worker');throw new Error('Nested workers are disabled');}});
let sdk,engine,conversation,busy=false;
async function timed(name,run) {
  const start=performance.now();post('phase',{name,status:'running'});
  try {const result=await run();post('phase',{name,status:'done',milliseconds:performance.now()-start});return result;}
  catch(error){post('phase',{name,status:'failed',milliseconds:performance.now()-start});throw error;}
}
self.onmessage = async ({data}) => {
  if (!data || busy) {post('error',{message:'処理中です。停止してから再実行してください。'});return;}
  busy=true;
  try {
    if (data.type==='initialize') {
      if(engine)throw new Error('Engine is already initialized');
      if(!(data.buffer instanceof ArrayBuffer)||data.buffer.byteLength!==MODEL.bytes)throw new Error('モデルサイズが一致しません。');
      if(!supportsRelaxedSimd())throw new Error('この固定ランタイムにはWasm relaxed SIMD対応のデスクトップブラウザが必要です。');
      await timed('SHA-256 再検証 (Worker)',async()=>{
        const digest=await crypto.subtle.digest('SHA-256',data.buffer);
        const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==MODEL.sha256)throw new Error('モデルのSHA-256が一致しません。');
      });
      sdk=await timed('SDK import',()=>import('@litert-lm/core'));
      await timed('loadLiteRtLm',()=>sdk.loadLiteRtLm(loaderUrl));
      networkOpen=false;
      const model=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(data.buffer));controller.close();}});
      engine=await timed('Engine.create',()=>sdk.Engine.create({model,backend:sdk.Backend.CPU,benchmarkEnabled:true,mainExecutorSettings:{maxNumTokens:512,samplerBackend:sdk.Backend.CPU,backendConfig:{kv_increment_size:128,prefill_chunk_size:128,number_of_threads:1}}}));
      post('ready',{backend:'CPU / XNNPACK',runtime:'@litert-lm/core 0.18.0',model:'SmolLM2 360M',networkClosed:true});
    } else if(data.type==='generate') {
      if(!engine)throw new Error('モデルを先に読み込んでください。');
      const prompt=validatePrompt(data.prompt);
      const maxOutputTokens=Number(data.maxOutputTokens);
      if(![16,32,40].includes(maxOutputTokens))throw new Error('出力上限が不正です。');
      conversation=await timed('createConversation',()=>engine.createConversation({sessionConfig:{maxOutputTokens,samplerBackend:sdk.Backend.CPU,samplerParams:{type:sdk.SamplerType.TOP_P,k:1,p:1,temperature:1,seed:42}}}));
      let chunks=0,firstChunkMs=null;
      const start=performance.now();post('phase',{name:'sendMessageStreaming',status:'running'});
      for await(const chunk of conversation.sendMessageStreaming(prompt)) {
        chunks++;const text=textFromChunk(chunk);
        if(text && firstChunkMs===null)firstChunkMs=performance.now()-start;
        post('chunk',{text,chunks,workerFirstObservedChunkMs:firstChunkMs});
      }
      const milliseconds=performance.now()-start;
      post('phase',{name:'sendMessageStreaming',status:'done',milliseconds});
      const metrics=await timed('getBenchmarkInfo',async()=>finiteMetrics(await conversation.getBenchmarkInfo()));
      const contextTokens=await conversation.getTokenCount();
      await timed('Conversation.delete',()=>conversation.delete());conversation=null;
      post('complete',{milliseconds,chunks,workerFirstObservedChunkMs:firstChunkMs,metrics,contextTokens});
    } else throw new Error('Unknown worker request');
  } catch(error) {
    // Never execute or interpret model text; errors contain no user prompt.
    post('error',{code:'LITERT_RUNTIME_FAILURE',message:'LiteRTの読み込みまたは生成に失敗しました。モデルを解放して再初期化してください。詳細は失敗した関数の表示を確認してください。'});
  } finally {busy=false;}
};
