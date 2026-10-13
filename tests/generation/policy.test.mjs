import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL,exactGet,validateFinalModelUrl,validatePrompt,textFromChunk,finiteMetrics,fixedProperty,blockOtherChannels} from '../../src/generation/policy.mjs';
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
test('English bounds are enforced',()=>{
 assert.equal(validatePrompt('  Hello!  '),'Hello!');
 for(const prompt of ['', ' ', 'あいう', 'é', 'x'.repeat(401),{},null])assert.throws(()=>validatePrompt(prompt));
 assert.equal(validatePrompt('<script>alert(1)</script>'),'<script>alert(1)</script>'); // display remains textContent
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
