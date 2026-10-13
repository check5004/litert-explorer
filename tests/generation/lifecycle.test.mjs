import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../../src/generation/policy.mjs';
// These are isolated UI-unit tests with mock platform objects, not browser or inference QA.
const source=(await fs.readFile(new URL('../../src/generation/main.mjs',import.meta.url),'utf8')).replace(/^import[^\n]*\n/,'').replaceAll('import.meta.url','"https://example.test/lab/main.js"');
class Element {
 constructor(){this.textContent='';this.value='32';this.checked=false;this.disabled=false;this.hidden=false;this.files=[];this.handlers=new Map();this.children=[];}
 addEventListener(name,fn){this.handlers.set(name,fn);}
 async dispatch(name){return await this.handlers.get(name)?.({target:this});}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
}
async function flushValidation(){for(let i=0;i<8;i++)await Promise.resolve();}
function setup(controlled=false){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const workers=[],swHandlers=new Map(),windowHandlers=new Map();
 class Worker {constructor(){this.terminated=false;workers.push(this);}postMessage(data,transfer){this.lastMessage=data;this.transfer=transfer;}terminate(){this.terminated=true;}emit(data){this.onmessage?.({data});}}
 const scope={...policy,document:{getElementById:get,createElement:()=>new Element()},location:{href:'https://example.test/lab/index.html'},navigator:{serviceWorker:{controller:controlled?{scriptURL:'https://unknown.test/sw.js'}:null,addEventListener:(name,fn)=>swHandlers.set(name,fn)}},Worker,URL,Headers,Request,ArrayBuffer,Uint8Array,AbortController,ReadableStream,performance:{now:()=>100},crypto:{subtle:{digest:async()=>Uint8Array.from(policy.MODEL.sha256.match(/../g),b=>parseInt(b,16)).buffer}},fetch:async()=>{throw Error('Unexpected network in unit test');},setInterval:()=>1,clearInterval:()=>{},addEventListener:(name,fn)=>windowHandlers.set(name,fn),console};
 scope.window=scope;vm.runInNewContext(source,scope);
 return {get,workers,scope,swHandlers,windowHandlers};
}
async function loadMockModel(env){
 env.get('ack').checked=true;await env.get('ack').dispatch('change');
 // Actual ArrayBuffer allocation verifies the transfer-list object; bytes are never inferred or read in this mock test.
 const buffer=new ArrayBuffer(policy.MODEL.bytes);
 env.get('file').files=[{name:policy.MODEL.name,size:policy.MODEL.bytes,arrayBuffer:async()=>buffer}];
 await env.get('file').dispatch('change');await env.get('local-load').dispatch('click');
 return {worker:env.workers.at(-1),buffer};
}
test('no auto-init; explicit local load passes an ownership-transfer list',async()=>{
 const env=setup();assert.equal(env.workers.length,0);assert.equal(env.get('download').disabled,true);
 const {worker,buffer}=await loadMockModel(env);assert(worker);assert.equal(worker.lastMessage.type,'initialize');assert.equal(worker.lastMessage.buffer,buffer);assert.equal(worker.transfer[0],buffer);
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,false);
});
test('Stop terminates the worker and ignores stale completion; retry creates a new worker',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});
 await env.get('run').dispatch('click');assert.equal(worker.lastMessage.type,'generate');
 await env.get('stop').dispatch('click');assert.equal(worker.terminated,true);assert.equal(env.get('run').disabled,true);
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
 await env.get('local-load').dispatch('click');assert.equal(env.workers.length,2);assert.notEqual(env.workers[1],worker);
});
test('Worker error messages are sanitized and invalidate stale queued messages',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);
 worker.onerror({preventDefault(){},message:'SECRET_PROMPT_DO_NOT_ECHO'});
 assert.equal(worker.terminated,true);assert(!env.get('error').textContent.includes('SECRET_PROMPT'));
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
});
test('Service Worker control prevents initialization and controllerchange terminates active state',async()=>{
 const blocked=setup(true);await flushValidation();assert.equal(blocked.workers.length,0);assert.equal(blocked.get('download').disabled,true);assert.match(blocked.get('error').textContent,/Service Worker/);
 const env=setup();const {worker}=await loadMockModel(env);env.scope.navigator.serviceWorker.controller={scriptURL:'https://example.test/sw.js'};env.swHandlers.get('controllerchange')();
 assert.equal(worker.terminated,true);assert.equal(env.get('local-load').disabled,true);worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
});
test('Stop marks unfinished stages interrupted, hides progress, and freezes elapsed',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});await env.get('run').dispatch('click');
 worker.emit({type:'phase',name:'sendMessageStreaming',status:'running'});env.get('progress').hidden=false;
 await env.get('stop').dispatch('click');assert.equal(env.get('progress').hidden,true);assert.match(env.get('elapsed').textContent,/s$/);
 const row=env.get('trace').children.find(x=>x.children[0].textContent==='sendMessageStreaming');assert.equal(row.children[1].textContent,'中断');
});
test('Changing input clears old response and metrics without executing the model',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});
 env.get('output').textContent='Old response';env.get('generated-tokens').textContent='21';env.get('elapsed').textContent='15 s';
 await env.get('prompt').dispatch('input');assert.equal(env.get('output').textContent,'');assert.equal(env.get('generated-tokens').textContent,'—');assert.equal(env.get('elapsed').textContent,'—');assert.equal(worker.lastMessage.type,'initialize');
 env.get('output').textContent='Old response';await env.get('samples').children[1].dispatch('click');assert.equal(env.get('output').textContent,'');assert.equal(env.get('prompt').value,policy.SAMPLES[1]);
});
for(const phase of ['loading','ready','generating'])test('BFCache restoration from '+phase+' requires a fresh worker',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);
 if(phase!=='loading')worker.emit({type:'ready'});
 if(phase==='generating'){await env.get('run').dispatch('click');worker.emit({type:'phase',name:'sendMessageStreaming',status:'running'});worker.emit({type:'chunk',text:'Partial output',chunks:1});}
 env.windowHandlers.get('pagehide')({persisted:true});env.windowHandlers.get('pageshow')({persisted:true});
 assert.equal(env.get('download').disabled,true); await flushValidation();
 assert.equal(worker.terminated,true);assert.equal(env.get('run').disabled,true);assert.equal(env.get('local-load').disabled,false);assert.equal(env.get('download').disabled,false);assert.equal(env.get('progress').hidden,true);assert.match(env.get('status').textContent,/再初期化/);
 if(phase==='generating')assert.equal(env.get('output').textContent,'Partial output');
 worker.emit({type:'ready'});assert.equal(env.get('run').disabled,true);
 await env.get('local-load').dispatch('click');assert.equal(env.workers.length,2);
});
test('A new Run clears all previous generation-phase timings',async()=>{
 const env=setup();const {worker}=await loadMockModel(env);worker.emit({type:'ready'});
 for(const name of ['createConversation','sendMessageStreaming','getBenchmarkInfo','Conversation.delete'])worker.emit({type:'phase',name,status:'done',milliseconds:123});
 await env.get('run').dispatch('click');
 const names=env.get('trace').children.map(row=>row.children[0].textContent);
 for(const name of ['createConversation','sendMessageStreaming','getBenchmarkInfo','Conversation.delete'])assert(!names.includes(name));
});
for(const phase of ['read','hash'])test('Stop during Main '+phase+' blocks rapid retry until the non-cancellable operation settles',async()=>{
 const env=setup();env.get('ack').checked=true;await env.get('ack').dispatch('change');
 let finish,reads=0;const pending=new Promise(resolve=>finish=resolve);const buffer=new ArrayBuffer(policy.MODEL.bytes);
 const digest=Uint8Array.from(policy.MODEL.sha256.match(/../g),b=>parseInt(b,16)).buffer;
 let markHashStarted;const hashStarted=new Promise(resolve=>markHashStarted=resolve);
 if(phase==='hash')env.scope.crypto.subtle.digest=async()=>{markHashStarted();return pending;};
 env.get('file').files=[{name:policy.MODEL.name,size:policy.MODEL.bytes,arrayBuffer:async()=>{reads++;return phase==='read'?pending:buffer;}}];
 await env.get('file').dispatch('change');const operation=env.get('local-load').dispatch('click');
 if(phase==='hash')await hashStarted;else{await Promise.resolve();await Promise.resolve();}
 await env.get('stop').dispatch('click');assert.equal(env.get('local-load').disabled,true);assert.equal(env.get('download').disabled,true);assert.match(env.get('state').textContent,/終了待ち/);
 await env.get('local-load').dispatch('click');assert.equal(reads,1);assert.equal(env.workers.length,0);
 finish(phase==='read'?buffer:digest);await operation;
 assert.equal(env.get('local-load').disabled,false);assert.equal(env.get('download').disabled,false);assert.equal(env.workers.length,0);assert.equal(env.get('run').disabled,true);assert.match(env.get('status').textContent,/終了しました/);
});
