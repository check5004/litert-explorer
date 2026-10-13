import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
// Preserve licenses in the published artifact, not only in the source repo.
await fs.cp('licenses','dist/licenses',{recursive:true});
await fs.copyFile('LICENSE','dist/licenses/APP-LICENSE.txt');
await fs.writeFile('dist/.nojekyll','');
async function walk(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error(`Unexpected symbolic link: ${p}`);if(e.isDirectory())out.push(...await walk(p));else if(p.endsWith('.map'))await fs.rm(p);else if(!p.endsWith('.map')&&!p.endsWith('/sw.js')&&!p.endsWith('/cache-manifest.json')&&!p.endsWith('/.nojekyll'))out.push(p.slice(5))}return out}
const files=await walk('dist');
const digest=crypto.createHash('sha256');
for(const file of [...files].sort()){digest.update(file);digest.update(await fs.readFile(path.join('dist',file)))}
const version=digest.digest('hex').slice(0,16);
await fs.writeFile('dist/cache-manifest.json',JSON.stringify({version,files:['./',...files.map(x=>'./'+x)]},null,2));
