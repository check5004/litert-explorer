import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const sdk=process.env.LITERT_LM_SDK_DIR||path.resolve('node_modules/@litert-lm/core');
const out=process.env.LITERT_ASSET_DIR||'public/generation/runtime';
const manifest=JSON.parse(await fs.readFile(path.join(sdk,'package.json'),'utf8'));
if(manifest.name!=='@litert-lm/core'||manifest.version!=='0.18.0')throw Error('Exact @litert-lm/core 0.18.0 required');
const sdkRequire=createRequire(path.join(sdk,'package.json'));
const helper=JSON.parse(await fs.readFile(sdkRequire.resolve('@litertjs/wasm-utils/package.json'),'utf8'));
if(helper.name!=='@litertjs/wasm-utils'||helper.version!=='2.0.0')throw Error('The LLM bundle requires the proven wasm-utils 2.0.0 helper');
export const helperEntry=sdkRequire.resolve('@litertjs/wasm-utils');
const helperHash=createHash('sha256').update(await fs.readFile(helperEntry)).digest('hex');
if(helperHash!=='e0e20bc28ab001ac732cf40d15b6eebd24fb0deaeb95eeba5100f51eebf015f2')throw Error('wasm-utils helper source integrity mismatch');
const files={
 'litertlm_wasm_asyncify_internal.js':{bytes:303787,sha256:'bbd95c7e178c369b956160f41b1430c0defae9d05a6cd7c810806e4f464c941b'},
 'litertlm_wasm_asyncify_internal.wasm':{bytes:34417794,sha256:'91b1e77b17139893d5ba5adddb755870244ba589e55d5bcf8ae191bd1c0b1f6f'}
};
await fs.mkdir(out,{recursive:true});
for(const [name,expected] of Object.entries(files)){
 const data=await fs.readFile(path.join(sdk,'wasm',name));
 const hash=createHash('sha256').update(data).digest('hex');
 if(data.byteLength!==expected.bytes||hash!==expected.sha256)throw Error('Runtime integrity mismatch: '+name);
 await fs.writeFile(path.join(out,name),data);
}
await fs.writeFile(path.join(out,'runtime-manifest.json'),JSON.stringify({sdk:'@litert-lm/core@0.18.0',helper:'@litertjs/wasm-utils@2.0.0',helperEntrySha256:helperHash,selection:'explicit Asyncify + relaxed SIMD',files,modelBundled:false},null,2)+'\n');
console.log('Copied only the verified runtime pair; no model file copied.');
