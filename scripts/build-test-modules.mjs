import {build} from 'esbuild';await build({entryPoints:['src/corpus.ts','src/detection.ts'],outdir:'tmp',outExtension:{'.js':'.mjs'},format:'esm',bundle:true,platform:'node'});
