import {build} from 'esbuild';
import fs from 'node:fs/promises';
await fs.rm('public/wasm/inference-worker.js.map',{force:true});
await build({entryPoints:['src/inference-worker.ts'],outfile:'public/wasm/inference-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',sourcemap:false,minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
