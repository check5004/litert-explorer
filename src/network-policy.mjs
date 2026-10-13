import {MODEL,exactGet,validateFinalModelUrl,blockOtherChannels,fixedProperty} from './generation/policy.mjs';
/** App-authored requests only. The two public model hosts are allowed by the
 * document CSP solely for the explicitly chosen generation-model download.
 * Worker policies remain independent and are installed before their SDKs. */
export function installShellNetworkPolicy(scope,{appBase,isGenerationActive}){
 const base=new URL(appBase),nativeFetch=scope.fetch.bind(scope);
 fixedProperty(scope,'fetch',async(input,init={})=>{
  const req=typeof input==='object'&&input!==null&&'url' in input?input:null;
  const url=new URL(req?req.url:String(input),base),method=String(init.method??req?.method??'GET').toUpperCase();
  if(url.origin!==base.origin){
   if(!isGenerationActive())throw Error('LLMタブが選択されていないためモデル取得を拒否しました。');
   exactGet(input,init,base.href,[MODEL.url]);
   const response=await nativeFetch(url.href,{method:'GET',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',cache:'no-store',signal:init.signal,mode:'cors'});
   validateFinalModelUrl(response.url);return response;
  }
  if(!url.pathname.startsWith(base.pathname)||url.username||url.password||url.search||url.hash||!['GET','HEAD'].includes(method)||init.body!=null||req?.body!=null)throw Error('許可されていない通信を拒否しました。');
  if((init.headers&&[...new Headers(init.headers)].length)||(req?.headers&&[...req.headers].length))throw Error('追加ヘッダーは許可されていません。');
  return nativeFetch(url.href,{method,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:init.signal});
 });
 blockOtherChannels(scope);
}
