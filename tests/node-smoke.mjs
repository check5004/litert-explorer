// Integration check in Node with a minimal browser script-loader shim.
// This runs the exact pinned LiteRT.js WASM/core API. It is NOT browser QA.
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {createRequire} from 'node:module';
globalThis.self=globalThis; globalThis.require=createRequire(import.meta.url);globalThis.__dirname=path.resolve('public/wasm');
globalThis.importScripts=(u)=>vm.runInThisContext(fs.readFileSync(new URL(u),'utf8'),{filename:new URL(u).pathname});
const {loadLiteRt,loadAndCompile,Tensor}=await import('@litertjs/core');
await loadLiteRt(new URL('../public/wasm/',import.meta.url).href,{threads:false,jspi:false});
for(const name of [process.argv[2]||'efficientdet']){let t=performance.now();let m=await loadAndCompile(new Uint8Array(fs.readFileSync('public/models/'+name+'.tflite')),{accelerator:'wasm'});console.log('loaded',name,performance.now()-t,m.getInputDetails(),m.getOutputDetails());const inputs=m.getInputDetails().map(d=>new Tensor(d.dtype==='uint8'?new Uint8Array(d.shape.reduce((a,b)=>a*b,1)):d.dtype==='int32'?new Int32Array(d.shape.reduce((a,b)=>a*b,1)):d.dtype==='int64'?new BigInt64Array(d.shape.reduce((a,b)=>a*b,1)):new Float32Array(d.shape.reduce((a,b)=>a*b,1)),d.shape));t=performance.now();const out=await m.run(inputs);console.log('run',performance.now()-t);for(const o of out){console.log('output',o.shape,Array.from(await o.data()).slice(0,20));o.delete()};inputs.forEach(t=>t.delete());m.delete();}
