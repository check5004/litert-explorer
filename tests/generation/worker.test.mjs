import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../../src/generation/policy.mjs';
// Unit tests exercise selection/configuration and network boundaries only.
// They do not replace the separately recorded real WASM/browser smoke tests.
const workerSource=(await fs.readFile(new URL('../../src/generation/worker.mjs',import.meta.url),'utf8'))
 .replace(/^import[^\n]*\n/,'').replace("import('@litert-lm/core')",'Promise.resolve(fakeSdk)');
function setup(hashModel=policy.MODEL){
 const events=[],calls={loads:0,engines:[],conversations:[],prompts:[],fetches:[]};
 const self={location:{href:'https://example.test/generation/runtime/lm-worker.js'},postMessage:event=>events.push(event),importScripts:()=>{},fetch:async(url,init)=>{calls.fetches.push({url,init});return {ok:true,url};}};
 const chat={sendMessageStreaming:async function*(prompt){calls.prompts.push(prompt);yield {content:[{type:'text',text:'<b>架空の応答</b>'}]};},getBenchmarkInfo:async()=>({lastDecodeTokenCount:2}),getTokenCount:async()=>20,delete:async()=>{}};
 const fakeSdk={Backend:{CPU:'CPU'},SamplerType:{TOP_P:'TOP_P'},loadLiteRtLm:async()=>{calls.loads++;await self.fetch('https://example.test/generation/runtime/'+policy.WASM);},Engine:{create:async settings=>{calls.engines.push(settings);return {createConversation:async config=>{calls.conversations.push(config);return chat;}};}}};
 const scope={...policy,self,URL,Headers,Request,ArrayBuffer,Uint8Array,ReadableStream,performance:{now:()=>100},crypto:{subtle:{digest:async()=>Uint8Array.from(hashModel.sha256.match(/../g),b=>parseInt(b,16)).buffer}},supportsRelaxedSimd:()=>true,fakeSdk};
 vm.runInNewContext(workerSource,scope);
 return {self,events,calls};
}
for(const model of policy.MODELS)test('Worker pins model/hash/configuration for '+model.id,async()=>{
 const env=setup(model);await env.self.onmessage({data:{type:'initialize',modelId:model.id,buffer:new ArrayBuffer(model.bytes)}});
 assert.equal(env.calls.loads,1);assert.equal(env.calls.engines.length,1);assert.equal(env.calls.engines[0].backend,'CPU');assert.equal(env.calls.engines[0].mainExecutorSettings.maxNumTokens,512);
 assert.equal(env.events.find(event=>event.type==='ready')?.modelId,model.id);
 assert.equal(env.calls.fetches[0].init.credentials,'omit');assert.equal(env.calls.fetches[0].init.redirect,'error');
 await assert.rejects(env.self.fetch('https://example.test/generation/runtime/'+policy.WASM),/closed/);
 await env.self.onmessage({data:{type:'generate',prompt:model.samples[0],maxOutputTokens:32}});
 assert.equal(env.calls.conversations.length,1);
 if(model.disableThinking)assert.equal(env.calls.conversations[0].preface.extra_context.enable_thinking,false);
 else assert.equal(env.calls.conversations[0].preface,undefined);
 assert.equal(env.calls.prompts[0],model.samples[0]);assert.equal(env.events.find(event=>event.type==='chunk')?.text,'<b>架空の応答</b>');
});
test('unknown model ID and incorrect size are rejected before runtime import/load',async()=>{
 for(const data of [{modelId:'unknown',buffer:new ArrayBuffer(1)},{modelId:policy.MODEL.id,buffer:new ArrayBuffer(1)}]){
  const env=setup();await env.self.onmessage({data:{type:'initialize',...data}});assert.equal(env.calls.loads,0);assert.equal(env.calls.engines.length,0);assert.equal(env.events.at(-1).type,'error');
 }
});
test('Worker rejects the other model hash before the SDK load',async()=>{
 const model=policy.MODELS[1],env=setup(policy.MODEL);await env.self.onmessage({data:{type:'initialize',modelId:model.id,buffer:new ArrayBuffer(model.bytes)}});
 assert.equal(env.calls.loads,0);assert.equal(env.calls.engines.length,0);assert(env.events.some(event=>event.name==='SHA-256 再検証 (Worker)'&&event.status==='failed'));
});
test('Worker retains Smol ASCII validation and rejects unbounded output limits',async()=>{
 const model=policy.MODELS[1],env=setup(model);await env.self.onmessage({data:{type:'initialize',modelId:model.id,buffer:new ArrayBuffer(model.bytes)}});
 await env.self.onmessage({data:{type:'generate',prompt:'日本語',maxOutputTokens:32}});assert.equal(env.calls.conversations.length,0);
 await env.self.onmessage({data:{type:'generate',prompt:'Hello',maxOutputTokens:4096}});assert.equal(env.calls.conversations.length,0);
});
