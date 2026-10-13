import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {helperEntry} from './prepare-generation-assets.mjs';
await fs.mkdir('public/generation/runtime',{recursive:true});
await build({entryPoints:['src/generation/main.mjs'],outfile:'public/generation/main.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false,logLevel:'info'});
await build({entryPoints:['src/generation/worker.mjs'],outfile:'public/generation/runtime/lm-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:false,logLevel:'info',plugins:[{name:'pin-proven-wasm-helper',setup(build){build.onResolve({filter:/^@litertjs\/wasm-utils$/},()=>({path:helperEntry}));}}]});
