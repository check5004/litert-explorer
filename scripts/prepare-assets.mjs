import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const revision='e8f8c211226b894fcb81acc59f3b34ba3efd5f42';
const assets=[
['models/efficientdet.tflite','https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite','40338edf5ec70d43e318b0a716a84d4564cd1802759a7a07170c7e43796dbf58'],
['tokenizer/tokenizer.json',`https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/${revision}/tokenizer.json`,'2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8'],
['tokenizer/tokenizer_config.json',`https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/${revision}/tokenizer_config.json`,'5036ea374ffedd706e3bef33e2e0d6953cb868ef8a490e76e32ba0faa37a6b9b'],
['tokenizer/special_tokens_map.json',`https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/${revision}/special_tokens_map.json`,'378eb3bf733eb16e65792d7e3fda5b8a4631387ca04d2015199c4d4f22ae554d'],
['tokenizer/config.json',`https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/${revision}/config.json`,'6300193cb75e01cf80c96decef7187dfb33094d97cc1490b7ead6ff134476e4e']
];
async function valid(file,expected){try{return hash(await fs.readFile(file))===expected}catch{return false}}
async function obtain(file,url,sha){if(await valid(file,sha)){console.log('Verified',file);return}await fs.mkdir(path.dirname(file),{recursive:true});console.log('Downloading',url);const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);const bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes)!==sha)throw Error(`SHA-256 mismatch; not writing ${file}`);await fs.writeFile(file,bytes);console.log('Saved',file,bytes.length)}
for(const [file,url,sha]of assets)await obtain('public/'+file,url,sha);
const manifest=JSON.parse(await fs.readFile('public/models/minilm-int32.adaptation.json','utf8'));
if(!await valid('public/models/minilm-int32.tflite',manifest.adaptedSha256)){
const original='.asset-cache/minilm.tflite';await obtain(original,'https://huggingface.co/Bombek1/paraphrase-multilingual-MiniLM-L12-v2-litert/resolve/b1552e06378f402cc061a6e0c1162f651a727778/sentence-transformers_paraphrase-multilingual-MiniLM-L12-v2.tflite',manifest.sourceSha256);const bytes=await fs.readFile(original);for(const p of manifest.patches){if(bytes[p.byteOffset]!==p.fromByte)throw Error('Unexpected source byte');bytes[p.byteOffset]=p.toByte}if(hash(bytes)!==manifest.adaptedSha256)throw Error('Adaptation checksum mismatch');await fs.writeFile('public/models/minilm-int32.tflite',bytes);console.log('Adapted exactly four input-boundary dtype bytes, preserved all weights.');
}else console.log('Verified adapted MiniLM');
await fs.cp('node_modules/@litertjs/core/wasm','public/wasm',{recursive:true});
const checks=[];for(const dir of ['public/models','public/tokenizer','public/wasm','public/samples'])for(const filename of await fs.readdir(dir)){const p=path.join(dir,filename);if(filename.startsWith('inference-worker'))continue;if((await fs.stat(p)).isFile())checks.push({path:p.slice(7),bytes:(await fs.stat(p)).size,sha256:hash(await fs.readFile(p))})}await fs.writeFile('public/asset-checksums.json',JSON.stringify({runtime:'@litertjs/core@2.5.3',assets:checks},null,2));console.log('All runtime assets prepared and checksummed.');
