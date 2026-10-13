import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../../src/generation/policy.mjs';
// Isolated UI-unit tests with mock platform objects, not browser or inference QA.
const source=(await fs.readFile(new URL('../../src/generation/main.mjs',import.meta.url),'utf8')).replace(/^import[^\n]*\n/,'').replace('export function mountGeneration','function mountGeneration');
class Events {
 constructor(){this.handlers=new Map();}
 addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(fn);}
 removeEventListener(name,fn){this.handlers.get(name)?.delete(fn);}
 async dispatch(name,event={}){for(const fn of [...(this.handlers.get(name)||[])])await fn({target:this,...event});}
 listenerCount(){return [...this.handlers.values()].reduce((count,handlers)=>count+handlers.size,0);}
}
class Element extends Events {
 constructor(){super();this.textContent='';this.value='32';this.checked=false;this.disabled=false;this.hidden=false;this.files=[];this.children=[];}
 append(...items){this.children.push(...items);}
 prepend(...items){this.children.unshift(...items);}
 replaceChildren(...items){this.children=items;}
 remove(){this.removed=true;}
}
async function flushValidation(){for(let i=0;i<8;i++)await Promise.resolve();}
function setup({controlled=false,autoActivate=true,fetch:fetchImpl}={}){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const workers=[],sw=new Events(),win=new Events(),gateOptions=[],fetches=[],timers=new Set();
 sw.controller=controlled?{scriptURL:'https://unknown.test/sw.js'}:null;
 class Worker {
  constructor(url,options){this.url=url.href;this.options=options;this.terminated=false;workers.push(this);}
  postMessage(data,transfer){this.lastMessage=data;this.transfer=transfer;}
  terminate(){this.terminated=true;}
  emit(data){this.onmessage?.({data});}
 }
 const doc={getElementById(){throw Error('Document-global ID lookup is forbidden');},createElement:()=>new Element()};
 const root=new Element();root.ownerDocument=doc;root.querySelector=selector=>get(selector.slice(1));
 const originalFetch=async(...args)=>{fetches.push(args);if(fetchImpl)return fetchImpl(...args);throw Error('Unexpected network in unit test');};
 const originalXHR=class OriginalXHR{};
 const scope={...policy,document:doc,location:{href:'https://example.test/teaching/#generation'},navigator:{serviceWorker:sw},Worker,URL,Headers,Request,ArrayBuffer,Uint8Array,AbortController,ReadableStream,performance:{now:()=>100},crypto:{subtle:{digest:async()=>digest()}},fetch:originalFetch,XMLHttpRequest:originalXHR,setInterval:()=>{const id={};timers.add(id);return id;},clearInterval:id=>timers.delete(id),addEventListener:win.addEventListener.bind(win),removeEventListener:win.removeEventListener.bind(win),createServiceWorkerGate:options=>{gateOptions.push(options);return policy.createServiceWorkerGate(options);},console};
 scope.window=scope;vm.runInNewContext(source,scope);
 const panel=scope.mountGeneration(root,{assetBase:'https://example.test/teaching/generation/',appBase:'https://example.test/teaching/'});
 if(autoActivate)panel.activate();
 return {get,workers,scope,sw,win,panel,root,gateOptions,fetches,timers,originalFetch,originalXHR};
}
function digest(){return Uint8Array.from(policy.MODEL.sha256.match(/../g),b=>parseInt(b,16)).buffer;}
async function acknowledge(env){env.get('ack').checked=true;await env.get('ack').dispatch('change');}
async function loadMockModel(env){
 await acknowledge(env);
 // An actual ArrayBuffer verifies ownership-transfer identity; bytes are not read in these mock tests.
 const buffer=new ArrayBuffer(policy.MODEL.bytes);
 env.get('file').files=[{name:policy.MODEL.name,size:policy.MODEL.bytes,arrayBuffer:async()=>buffer}];
 await env.get('file').dispatch('change');await env.get('local-load').dispatch('click');
 return {worker:env.workers.at(-1),buffer};
}

test('mount and repeated activation never download, create a Worker, or replace window transports',async()=>{
 const env=setup({autoActivate:false});
 assert.equal(env.workers.length,0);assert.equal(env.fetches.length,0);assert.equal(env.win.listenerCount(),0);assert.equal(env.sw.listenerCount(),0);
 assert.equal(env.get('download').disabled,true);assert.equal(env.scope.fetch,env.originalFetch);assert.equal(env.scope.XMLHttpRequest,env.originalXHR);
 assert.equal(env.root.children[0].href,'https://example.test/teaching/generation/style.css');
 env.panel.activate();env.panel.activate();await flushValidation();
 assert.equal(env.win.listenerCount(),2);assert.equal(env.sw.listenerCount(),2);assert.equal(env.gateOptions.length,1);
 assert.equal(env.gateOptions[0].expectedScope,'https://example.test/teaching/');assert.equal(env.gateOptions[0].expectedScriptURL,'https://example.test/teaching/sw.js');
 assert.equal(env.workers.length,0);assert.equal(env.fetches.length,0);assert.equal(env.get('ack').checked,false);assert.equal(env.get('download').disabled,true);
});
test('explicit local load passes an ownership-transfer list and uses the generation asset base',async()=>{
 const env=setup();const {worker,buffer}=await loadMockModel(env);
 assert(worker);assert.equal(worker.url,'https://example.test/teaching/generation/runtime/lm-worker.js');
 assert.equal(worker.lastMessage.type,'initialize');assert.equal(worker.lastMessage.buffer,buffer);assert.equal(worker.transfer[0],buffer);
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,false);
});
test('Stop terminates the worker and ignores stale completion; retry creates a new worker',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});
 await env.get('run').dispatch('click');assert.equal(worker.lastMessage.type,'generate');
 await env.get('stop').dispatch('click');assert.equal(worker.terminated,true);assert.equal(env.get('run').disabled,true);
 worker.emit({type:'ready'});worker.emit({type:'complete'});assert.equal(env.get('run').disabled,true);
 await env.get('local-load').dispatch('click');assert.equal(env.workers.length,2);assert.notEqual(env.workers[1],worker);
});
test('Worker error messages are sanitized and invalidate stale queued messages',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);
 worker.onerror({preventDefault(){},message:'SECRET_PROMPT_DO_NOT_ECHO'});
 assert.equal(worker.terminated,true);assert(!env.get('error').textContent.includes('SECRET_PROMPT'));
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
});
test('Service Worker control prevents initialization and controllerchange terminates active state',async()=>{
 const blocked=setup({controlled:true});await flushValidation();assert.equal(blocked.workers.length,0);assert.equal(blocked.get('download').disabled,true);assert.match(blocked.get('error').textContent,/Service Worker/);
 const env=setup();const {worker}=await loadMockModel(env);env.sw.controller={scriptURL:'https://example.test/teaching/sw.js'};await env.sw.dispatch('controllerchange');
 assert.equal(worker.terminated,true);assert.equal(env.get('local-load').disabled,true);worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
});
test('Stop marks unfinished stages interrupted, hides progress, and freezes elapsed',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});await env.get('run').dispatch('click');
 worker.emit({type:'phase',name:'sendMessageStreaming',status:'running'});env.get('progress').hidden=false;
 await env.get('stop').dispatch('click');assert.equal(env.get('progress').hidden,true);assert.match(env.get('elapsed').textContent,/s$/);assert.equal(env.timers.size,0);
 const row=env.get('trace').children.find(x=>x.children[0].textContent==='sendMessageStreaming');assert.equal(row.children[1].textContent,'中断');
});
test('Changing input clears old response and metrics without executing the model',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});
 env.get('output').textContent='Old response';env.get('generated-tokens').textContent='21';env.get('elapsed').textContent='15 s';
 await env.get('prompt').dispatch('input');assert.equal(env.get('output').textContent,'');assert.equal(env.get('generated-tokens').textContent,'—');assert.equal(env.get('elapsed').textContent,'—');assert.equal(worker.lastMessage.type,'initialize');
 env.get('output').textContent='Old response';await env.get('samples').children[1].dispatch('click');assert.equal(env.get('output').textContent,'');assert.equal(env.get('prompt').value,policy.SAMPLES[1]);
});
for(const phase of ['loading','ready','generating'])test('BFCache restoration from '+phase+' requires fresh acknowledgement and initialization',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);
 if(phase!=='loading')worker.emit({type:'ready'});
 if(phase==='generating'){await env.get('run').dispatch('click');worker.emit({type:'phase',name:'sendMessageStreaming',status:'running'});worker.emit({type:'chunk',text:'Partial output',chunks:1});}
 await env.win.dispatch('pagehide',{persisted:true});await env.win.dispatch('pageshow',{persisted:true});await flushValidation();
 assert.equal(worker.terminated,true);assert.equal(env.get('run').disabled,true);assert.equal(env.get('local-load').disabled,true);assert.equal(env.get('download').disabled,true);assert.equal(env.get('progress').hidden,true);assert.match(env.get('status').textContent,/再初期化/);
 assert.equal(env.get('ack').checked,false);assert.equal(env.get('output').textContent,'');assert.equal(env.get('generated-tokens').textContent,'—');
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
 await acknowledge(env);await env.get('local-load').dispatch('click');assert.equal(env.workers.length,2);
});
test('A new Run clears all previous generation-phase timings',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});
 for(const name of ['createConversation','sendMessageStreaming','getBenchmarkInfo','Conversation.delete'])worker.emit({type:'phase',name,status:'done',milliseconds:123});
 await env.get('run').dispatch('click');
 const names=env.get('trace').children.map(row=>row.children[0].textContent);
 for(const name of ['createConversation','sendMessageStreaming','getBenchmarkInfo','Conversation.delete'])assert(!names.includes(name));
});
for(const phase of ['read','hash'])test('Stop during Main '+phase+' blocks rapid retry until the non-cancellable operation settles',async()=>{
 const env=setup();await acknowledge(env);
 let finish,reads=0;const pending=new Promise(resolve=>finish=resolve),buffer=new ArrayBuffer(policy.MODEL.bytes);
 let markHashStarted;const hashStarted=new Promise(resolve=>markHashStarted=resolve);
 if(phase==='hash')env.scope.crypto.subtle.digest=async()=>{markHashStarted();return pending;};
 env.get('file').files=[{name:policy.MODEL.name,size:policy.MODEL.bytes,arrayBuffer:async()=>{reads++;return phase==='read'?pending:buffer;}}];
 await env.get('file').dispatch('change');const operation=env.get('local-load').dispatch('click');
 if(phase==='hash')await hashStarted;else await flushValidation();
 await env.get('stop').dispatch('click');assert.equal(env.get('local-load').disabled,true);assert.equal(env.get('download').disabled,true);assert.match(env.get('state').textContent,/終了待ち/);
 await env.get('local-load').dispatch('click');assert.equal(reads,1);assert.equal(env.workers.length,0);
 finish(phase==='read'?buffer:digest());await operation;
 assert.equal(env.get('local-load').disabled,false);assert.equal(env.get('download').disabled,false);assert.equal(env.workers.length,0);assert.equal(env.get('run').disabled,true);assert.match(env.get('status').textContent,/終了しました/);
});
test('tab deactivation during inference destroys work, clears unfinished results, and ignores all late messages',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});await env.get('run').dispatch('click');
 worker.emit({type:'phase',name:'sendMessageStreaming',status:'running'});worker.emit({type:'chunk',text:'Partial output',chunks:1});
 env.panel.deactivate('tab-change');
 assert.equal(worker.terminated,true);assert.equal(env.timers.size,0);assert.equal(env.get('output').textContent,'');assert.equal(env.get('chunk-count').textContent,'—');assert.equal(env.get('ack').checked,false);
 assert.equal(env.win.listenerCount(),0);assert.equal(env.sw.listenerCount(),0);assert.equal(env.get('run').disabled,true);assert.equal(env.get('prompt').disabled,true);
 const row=env.get('trace').children.find(x=>x.children[0].textContent==='sendMessageStreaming');assert.equal(row.children[1].textContent,'中断');
 worker.emit({type:'chunk',text:'STALE',chunks:2});worker.emit({type:'complete',metrics:{lastDecodeTokenCount:42}});worker.emit({type:'ready'});worker.emit({type:'phase',name:'late phase',status:'done',milliseconds:2});
 assert.equal(env.get('output').textContent,'');assert.equal(env.get('generated-tokens').textContent,'—');assert(!env.get('trace').children.some(x=>x.children[0].textContent==='late phase'));
 env.panel.activate();env.panel.activate();await flushValidation();assert.equal(env.get('download').disabled,true);assert.equal(env.get('local-load').disabled,true);assert.equal(env.workers.length,1);
 assert.equal(env.gateOptions.length,2);assert.equal(env.win.listenerCount(),2);assert.equal(env.sw.listenerCount(),2);
 await acknowledge(env);await env.get('local-load').dispatch('click');assert.equal(env.workers.length,2);assert.notEqual(env.workers[1],worker);
});
for(const phase of ['read','hash'])test('tab departure during Main '+phase+' keeps preparation single-flight across reactivation',async()=>{
 const env=setup();await acknowledge(env);
 let finish,reads=0;const pending=new Promise(resolve=>finish=resolve),buffer=new ArrayBuffer(policy.MODEL.bytes);
 let markHashStarted;const hashStarted=new Promise(resolve=>markHashStarted=resolve);
 if(phase==='hash')env.scope.crypto.subtle.digest=async()=>{markHashStarted();return pending;};
 env.get('file').files=[{name:policy.MODEL.name,size:policy.MODEL.bytes,arrayBuffer:async()=>{reads++;return phase==='read'?pending:buffer;}}];
 await env.get('file').dispatch('change');const operation=env.get('local-load').dispatch('click');
 if(phase==='hash')await hashStarted;else await flushValidation();
 env.panel.deactivate();env.panel.activate();await flushValidation();
 assert.equal(env.get('ack').checked,false);assert.equal(env.get('ack').disabled,true);assert.match(env.get('state').textContent,/終了待ち/);
 await env.get('local-load').dispatch('click');await env.get('download').dispatch('click');assert.equal(reads,1);assert.equal(env.fetches.length,0);
 finish(phase==='read'?buffer:digest());await operation;
 assert.equal(env.workers.length,0);assert.equal(env.get('ack').disabled,false);assert.equal(env.get('download').disabled,true);assert.equal(env.get('local-load').disabled,true);
 assert(!env.get('trace').children.some(x=>x.children[0].textContent==='SHA-256 検証 (Main)'&&x.children[1].textContent!=='中断'));
 await acknowledge(env);assert.equal(env.get('local-load').disabled,false);
});
test('tab departure aborts model download and requires opt-in on return',async()=>{
 let signal;
 const env=setup({fetch:async(_url,init)=>{signal=init.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted'))));}});
 await acknowledge(env);const operation=env.get('download').dispatch('click');await flushValidation();
 assert.equal(env.fetches.length,1);assert.equal(signal.aborted,false);env.panel.deactivate();assert.equal(signal.aborted,true);
 await operation;assert.equal(env.workers.length,0);assert.equal(env.get('error').hidden,true);assert.equal(env.get('progress').hidden,true);
 env.panel.activate();await flushValidation();assert.equal(env.get('download').disabled,true);assert.equal(env.get('ack').checked,false);
 const [url,init]=env.fetches[0];assert.equal(url,policy.MODEL.url);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);
});
test('a late download stream read cannot update a reactivated panel or start hashing',async()=>{
 let finishRead,cancelled=0,hashCalls=0;
 const pendingRead=new Promise(resolve=>finishRead=resolve);
 const env=setup({fetch:async()=>({url:policy.MODEL.url,ok:true,body:{getReader:()=>({read:()=>pendingRead,cancel:async()=>{cancelled++;}})}})});
 env.scope.crypto.subtle.digest=async()=>{hashCalls++;return digest();};await acknowledge(env);
 const operation=env.get('download').dispatch('click');await flushValidation();env.panel.deactivate();env.panel.activate();await flushValidation();
 const interruptedStatus=env.get('status').textContent;assert.match(interruptedStatus,/終了/);assert.equal(env.get('download').disabled,true);
 finishRead({value:new Uint8Array([1,2,3]),done:false});await operation;
 assert.equal(cancelled,1);assert.equal(env.get('output').textContent,'');assert.equal(env.get('progress').value,0);assert.equal(env.workers.length,0);assert.equal(hashCalls,0);assert.equal(env.get('ack').checked,false);
});
test('private model fetch rejects an unrecognized final redirect URL',async()=>{
 const env=setup({fetch:async()=>({url:'https://untrusted.test/model',ok:true,body:{}})});await acknowledge(env);await env.get('download').dispatch('click');
 assert.equal(env.workers.length,0);assert.equal(env.get('error').hidden,false);assert.match(env.get('error').textContent,/配布先/);
});
test('reactivation revalidates Service Worker control instead of trusting the previous gate',async()=>{
 const env=setup();await flushValidation();env.panel.deactivate();env.sw.controller={scriptURL:'https://unknown.test/sw.js'};env.panel.activate();await flushValidation();
 assert.equal(env.gateOptions.length,2);assert.equal(env.get('download').disabled,true);assert.match(env.get('error').textContent,/Service Worker/);assert.equal(env.workers.length,0);
});
test('dispose removes local/global listeners and late hash completion remains inert',async()=>{
 const env=setup();await acknowledge(env);let finishHash,started;const pending=new Promise(resolve=>finishHash=resolve),hashStarted=new Promise(resolve=>started=resolve);
 env.scope.crypto.subtle.digest=async()=>{started();return pending;};const buffer=new ArrayBuffer(policy.MODEL.bytes);
 env.get('file').files=[{name:policy.MODEL.name,size:policy.MODEL.bytes,arrayBuffer:async()=>buffer}];await env.get('file').dispatch('change');const operation=env.get('local-load').dispatch('click');await hashStarted;
 env.panel.dispose();env.panel.dispose();assert.equal(env.win.listenerCount(),0);assert.equal(env.sw.listenerCount(),0);assert.equal(env.get('download').listenerCount(),0);assert.equal(env.get('samples').children[0].listenerCount(),0);assert.equal(env.root.children[0].removed,true);
 finishHash(digest());await operation;assert.equal(env.workers.length,0);assert.throws(()=>env.panel.activate(),/disposed/);
});
