import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
test('asset preparation rejects an unexpected SDK helper version before copying assets',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'litert-helper-test-'));
 try{
  const helper=path.join(root,'node_modules/@litertjs/wasm-utils');await fs.mkdir(helper,{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'@litert-lm/core',version:'0.18.0'}));
  await fs.writeFile(path.join(helper,'package.json'),JSON.stringify({name:'@litertjs/wasm-utils',version:'2.5.3',main:'index.js'}));
  await fs.writeFile(path.join(helper,'index.js'),'');
  const result=spawnSync(process.execPath,['scripts/prepare-generation-assets.mjs'],{cwd:new URL('../..',import.meta.url),env:{...process.env,LITERT_LM_SDK_DIR:root,LITERT_ASSET_DIR:path.join(root,'out')},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/proven wasm-utils 2\.0\.0/);
  await assert.rejects(fs.access(path.join(root,'out')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('public explanation matches the version-checked root SW exception',async()=>{
 const html=await fs.readFile(new URL('../../public/generation/index.html',import.meta.url),'utf8');
 assert(!html.includes('Service Worker管理下の実行を拒否します'));
 assert(html.includes('明示的なポリシーバージョン応答'));
 assert(html.includes('実SW管理下のブラウザ試験'));
});
