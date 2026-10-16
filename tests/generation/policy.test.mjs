import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL,MODELS,getModel,modelForUrl,exactGet,validateFinalModelUrl,validatePrompt,textFromChunk,finiteMetrics,fixedProperty,blockOtherChannels} from '../../src/generation/policy.mjs';
const base='https://example.test/lab/index.html';
test('only exact GET model URL is allowed',()=>{
 assert.equal(exactGet(MODEL.url,{},base,[MODEL.url]),MODEL.url);
 for(const url of [MODEL.url+'?x=1',MODEL.url+'#x','https://evil.test/model','https://huggingface.co/elsewhere',MODEL.url.replace('https:','http:')])assert.throws(()=>exactGet(url,{},base,[MODEL.url]));
 for(const init of [{method:'POST'},{body:'prompt'},{headers:{Authorization:'anything'}}])assert.throws(()=>exactGet(MODEL.url,init,base,[MODEL.url]));
 assert.throws(()=>exactGet(new Request(MODEL.url,{method:'POST',body:'prompt'}),{},base,[MODEL.url]));
});
test('final model redirects are restricted to pinned path and verified origin',()=>{
 assert.equal(validateFinalModelUrl(MODEL.url),true);
 assert.equal(validateFinalModelUrl(MODEL.finalOrigin+MODEL.finalPath+'?signed=test'),true);
 for(const url of ['https://evil.test'+MODEL.finalPath,MODEL.finalOrigin+'/other',MODEL.finalOrigin+MODEL.finalPath+'#x',MODEL.url+'?download=1'])assert.throws(()=>validateFinalModelUrl(url));
});
test('model catalog is immutable, pinned and defaults to Japanese Qwen',()=>{
 assert.equal(MODEL.id,'qwen3-0.6b-int4');assert.equal(MODELS.length,2);
 for(const model of MODELS){
  assert.equal(getModel(model.id),model);assert.equal(modelForUrl(model.url),model);
  assert.equal(model.revision.length,40);assert.equal(model.sha256.length,64);
  assert(model.url.includes('/resolve/'+model.revision+'/'));
  assert.throws(()=>{model.sha256='wrong';});assert.throws(()=>model.samples.push('x'));
 }
 assert.throws(()=>getModel('unknown'));assert.throws(()=>modelForUrl(MODEL.url+'?prompt=x'));
});
test('Japanese is accepted for Qwen and English restriction remains on SmolLM2',()=>{
 const english=MODELS.find(m=>m.asciiOnly);
 assert.equal(validatePrompt('  会議は明日です。  '),'会議は明日です。');
 assert.equal(validatePrompt('  Hello!  ',english),'Hello!');
 for(const model of MODELS)for(const prompt of ['', ' ', 'x'.repeat(401),{},null])assert.throws(()=>validatePrompt(prompt,model));
 for(const prompt of ['あいう','é'])assert.throws(()=>validatePrompt(prompt,english));
 assert.equal(validatePrompt('<script>alert(1)</script>'),'<script>alert(1)</script>');
});
test('redirect validation is bound to the selected model, not the whole CDN',()=>{
 for(const model of MODELS){
  assert.equal(validateFinalModelUrl(model.url,model),true);
  assert.equal(validateFinalModelUrl(model.finalOrigin+model.finalPath+'?signed=test',model),true);
  for(const other of MODELS.filter(m=>m!==model)){
   assert.throws(()=>validateFinalModelUrl(other.url,model));
   assert.throws(()=>validateFinalModelUrl(other.finalOrigin+other.finalPath+'?signed=test',model));
  }
 }
});
test('text chunks remain raw text; chunks are not counted as tokens',()=>{
 assert.equal(textFromChunk({content:[{type:'text',text:'<b>Hello</b>'},{type:'image',text:'no'}]}),'<b>Hello</b>');
 assert.equal(textFromChunk({content:'unexpected'}),'');
 const m=finiteMetrics({lastDecodeTokenCount:21,lastPrefillTokenCount:33,timeToFirstTokenInSecond:10.8,lastDecodeTokensPerSecond:NaN});
 assert.equal(m.lastDecodeTokenCount,21);assert.equal(m.lastDecodeTokensPerSecond,null);
});
test('network gates cannot be overwritten; alternative channels fail closed',()=>{
 const scope={navigator:{}};fixedProperty(scope,'fetch',()=>42);assert.throws(()=>{scope.fetch=()=>0;});assert.equal(scope.fetch(),42);
 const seen=[];blockOtherChannels(scope,x=>seen.push(x));
 for(const name of ['XMLHttpRequest','WebSocket','EventSource','WebTransport','RTCPeerConnection','SharedWorker'])assert.throws(()=>new scope[name]());
 assert.equal(scope.navigator.sendBeacon('https://evil.test'),false);assert.equal(seen.length,7);
});
