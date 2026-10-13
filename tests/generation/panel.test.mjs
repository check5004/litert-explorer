import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=path=>fs.readFile(new URL('../../'+path,import.meta.url),'utf8');
const [panel,css,source]=await Promise.all([read('public/generation/panel.html'),read('public/generation/style.css'),read('src/generation/main.mjs')]);
test('generation fragment belongs to the shared shell and preserves substantive cautions',()=>{
 assert.doesNotMatch(panel,/<(?:html|head|body|header|footer|main|iframe|script)\b/i);
 assert.doesNotMatch(panel,/<h1\b|href=["']\.\.\//i);
 for(const disclosure of ['実験版・PC向け','約374 MB','数GB','Web対応モデル一覧には含まれません','英語・ASCIIのみ','チャンク ≠ トークン','Streaming API','再初期化','中止できない','永続保存しません']){
  assert((panel+source).includes(disclosure),disclosure);
 }
 assert.match(panel,/id="generation-heading"/);assert.match(panel,/aria-labelledby="generation-heading"/);
});
test('every statically referenced panel ID is scoped and present exactly once',()=>{
 const ids=[...panel.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(new Set(ids).size,ids.length);
 for(const [,id] of source.matchAll(/\$\('([^']+)'\)/g))assert(ids.includes(id),'missing '+id);
 assert.doesNotMatch(source,/document\.getElementById|document\.querySelector/);
 assert.match(source,/root\.querySelector\('#'\+id\)/);
});
test('component stylesheet uses the shadow host and container-based responsive layout',()=>{
 assert.match(css,/:host\{/);assert.doesNotMatch(css,/:root\{|\bbody\{|\bheader\{|\bfooter\{/);
 assert.match(css,/@container\(max-width:850px\)/);assert.match(css,/\[hidden\]\{display:none!important\}/);
});
test('window transport policy is owned by the shell while private model verification remains',()=>{
 assert.doesNotMatch(source,/fixedProperty\(window|blockOtherChannels\(window|window\.fetch\s*=/);
 assert.match(source,/async function fetchModel/);assert.match(source,/exactGet\(input,init,app.href,\[MODEL.url\]\)/);assert.match(source,/validateFinalModelUrl\(response.url\)/);
 assert.doesNotMatch(source,/(?:import\s+.*from\s+['"]@litert|import\(['"]@litert)/);
});
