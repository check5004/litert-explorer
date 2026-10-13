import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
let publishedBytes=0;async function checkTree(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);assert(!e.isSymbolicLink(),'Symlink in Pages artifact');assert(!e.name.endsWith('.map'),'Source map in public artifact');if(e.isDirectory())await checkTree(p);else publishedBytes+=(await fs.stat(p)).size}}await checkTree('dist');
const required=['decision/panel.html','generation/panel.html','redirect-lab.js','index.html','sw.js','cache-manifest.json','wasm/inference-worker.js','wasm/litert_wasm_internal.wasm','models/minilm-int32.tflite','models/efficientdet.tflite','models/efficientdet-anchors.json','models/labels.txt','tokenizer/tokenizer.json','licenses/THIRD_PARTY.md','licenses/Apache-2.0.txt','generation/index.html','generation/main.js','generation/runtime/lm-worker.js','generation/runtime/litertlm_wasm_asyncify_internal.wasm','decision/index.html','decision/main.mjs','decision/decision-worker.mjs','decision/assets/decision_bundle.mjs','decision/assets/wasm/decision_wasm_module_internal.wasm','decision/assets/embeddinggemma-2-text-270m.litertlm'];
for(const file of required)assert((await fs.stat(path.join('dist',file))).isFile(),`Missing ${file}`);
const html=await fs.readFile('dist/index.html','utf8');assert(!/(?:src|href)=["']\/(?!\/)/.test(html),'Root-absolute asset URL breaks repository Pages');
const manifest=JSON.parse(await fs.readFile('dist/cache-manifest.json','utf8'));let total=0;for(const f of manifest.files){const url=new URL(f,'https://example.github.io/litert-explorer/');assert(url.pathname.startsWith('/litert-explorer/'),'Asset escapes repository base');if(f!=='./')total+=(await fs.stat(path.join('dist',f))).size}
assert(publishedBytes<900*1024*1024,`Published bytes ${total} too close to Pages1GB limit`);
assert(!html.includes('Cross-Origin-Embedder-Policy'),'Pages deployment must not depend on unsupported headers');
console.log(JSON.stringify({passed:true,base:'/litert-explorer/',publishedBytes,cacheAssetBytes:total,pagesLimitBytes:1e9,requiredAssets:required.length,cacheFiles:manifest.files.length},null,2));

assert(!manifest.files.some(f=>f.startsWith('./decision/')||f.startsWith('./generation/')), 'Extension assets must not silently expand Core offline download');

for(const tab of ["decision","generation"]){const legacy=await fs.readFile(`dist/${tab}/index.html`,"utf8");assert(legacy.includes(`../#${tab}`));assert(legacy.includes("redirect-lab.js"));}
