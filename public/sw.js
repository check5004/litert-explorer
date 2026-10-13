/* Explicit opt-in offline storage. No remote fetch and no user input storage. */
const CACHE='litert-lab-v2-'+encodeURIComponent(self.registration.scope);
self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
async function notify(text){for(const c of await self.clients.matchAll())c.postMessage({text})}
self.addEventListener('message',e=>{if(e.data?.type!=='cache-all')return;e.waitUntil((async()=>{try{const r=await fetch('./cache-manifest.json',{cache:'no-store'});if(!r.ok)throw Error('キャッシュ一覧を取得できません');const manifest=await r.json();const cache=await caches.open(CACHE+'-'+manifest.version);for(let i=0;i<manifest.files.length;i++){const url=new URL(manifest.files[i],self.registration.scope);if(url.pathname.startsWith(new URL('decision/',self.registration.scope).pathname)||url.pathname.startsWith(new URL('generation/',self.registration.scope).pathname))throw Error('追加実験はCoreの保存対象外です');if(url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))throw Error('別オリジンのファイルは禁止されています');if(!await cache.match(url)){const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url.pathname}`);await cache.put(url,response)}await notify(`保存中 ${i+1}/${manifest.files.length}ファイル。大きなモデルの保存には時間がかかります。`)}for(const key of await caches.keys())if(key.startsWith(CACHE+'-')&&key!==CACHE+'-'+manifest.version)await caches.delete(key);await notify('保存完了。ネットワークを切って再読み込みしても、このブラウザで実行できます。ブラウザの容量制限・削除でキャッシュは失われます。')}catch(error){await notify('保存は完了していません: '+error.message+'。空き容量を確認してください。')}})())});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;if(u.pathname.startsWith(new URL('decision/',self.registration.scope).pathname)||u.pathname.startsWith(new URL('generation/',self.registration.scope).pathname)){e.respondWith(fetch(new Request(e.request,{redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'})));return}e.respondWith((async()=>{const keys=(await caches.keys()).filter(k=>k.startsWith(CACHE+'-')).reverse();for(const k of keys){const r=await (await caches.open(k)).match(e.request);if(r)return r}return fetch(e.request)})())});

// Extension fetch-policy capability reply
// Append this to the trusted root public/sw.js ONLY alongside the matching fetch
// policy. This marker reports version/capabilities; it does not authenticate bytes.
// It neither registers a SW nor changes activation/caching/fetch behavior.
self.addEventListener('message', event => {
  if (event.data?.type !== 'litert-lab:describe-fetch-policy' ||
      event.data.protocolVersion !== 1 || event.ports?.length !== 1) return;
  const port = event.ports[0];
  port.postMessage({
    type: 'litert-lab:fetch-policy',
    protocolVersion: 1,
    policyVersion: 'litert-lab-core-pass-through-v1',
    capabilities: {
      decisionNetworkOnly: true,
      generationNetworkOnly: true,
      redirectError: true,
      credentialsOmit: true,
      noReferrer: true,
      crossOriginUnhandled: true,
    },
  });
  port.close();
});
