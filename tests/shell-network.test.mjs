import test from 'node:test';import assert from 'node:assert/strict';import {installShellNetworkPolicy} from '../src/network-policy.mjs';import {MODEL,MODELS} from '../src/generation/policy.mjs';
function setup(active=false){const calls=[];const scope={navigator:{},fetch:async(u,init)=>{calls.push({u,init});return{url:u}}};installShellNetworkPolicy(scope,{appBase:'https://example.test/lab/',isGenerationActive:()=>active});return{scope,calls};}
test('local static fetch is credential-free and rejects redirects',async()=>{const {scope,calls}=setup();await scope.fetch('models/graph.json');assert.equal(calls[0].u,'https://example.test/lab/models/graph.json');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.referrerPolicy,'no-referrer');});
test('no external model request outside generation tab',async()=>{const {scope,calls}=setup();await assert.rejects(scope.fetch(MODEL.url));assert.equal(calls.length,0);});
test('only exact external model GET is allowed in active generation tab',async()=>{const {scope,calls}=setup(true);await scope.fetch(MODEL.url);assert.equal(calls.length,1);assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.cache,'no-store');for(const [u,i]of [['https://evil.test/',{}],[MODEL.url+'?input=hello',{}],[MODEL.url,{method:'POST',body:'text'}],[MODEL.url,{headers:{Authorization:'secret'}}]])await assert.rejects(scope.fetch(u,i));assert.equal(calls.length,1);});
test('local requests cannot carry input via query, body or headers',async()=>{const {scope,calls}=setup();for(const [u,i]of [['asset?input=hello',{}],['../other',{}],['asset',{body:'hello'}],['asset',{headers:{custom:'hello'}}]])await assert.rejects(scope.fetch(u,i));assert.equal(calls.length,0);});
test('unexpected transport channels are blocked',()=>{const {scope}=setup();assert.throws(()=>new scope.XMLHttpRequest());assert.throws(()=>new scope.WebSocket());assert.equal(scope.navigator.sendBeacon('https://evil.test/','text'),false);});

test('both pinned catalog models are allowed, but redirects cannot switch model identity',async()=>{
 const {scope,calls}=setup(true);
 for(const model of MODELS)await scope.fetch(model.url);
 assert.equal(calls.length,MODELS.length);
 for(const model of MODELS){
  const target=MODELS.find(other=>other!==model),scope={navigator:{},fetch:async()=>({url:target.finalOrigin+target.finalPath+'?signature=public'})};
  installShellNetworkPolicy(scope,{appBase:'https://example.test/lab/',isGenerationActive:()=>true});
  await assert.rejects(scope.fetch(model.url),/配布先/);
 }
});
