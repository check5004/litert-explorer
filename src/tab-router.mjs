export const TAB_IDS=Object.freeze(['search','detect','decision','generation']);
export function tabFromHash(hash){const value=String(hash||'').replace(/^#/,'');return TAB_IDS.includes(value)?value:'detect';}
/** Latest navigation wins. Deactivate is synchronous; no second heavy worker can
 * begin before the previous controller has released its execution ownership. */
export function createTabCoordinator({load,onSelect,onError}){
 let current=null,controller=null,revision=0,disposed=false;const pending=new Map();
 async function select(id){
  if(disposed||!TAB_IDS.includes(id))return;
  if(id===current&&controller)return;
  const token=++revision;controller?.deactivate('タブ切り替え');controller=null;current=id;onSelect(id);
  try{
   if(!pending.has(id))pending.set(id,Promise.resolve().then(()=>load(id)).catch(error=>{pending.delete(id);throw error;}));
   const next=await pending.get(id);
   if(disposed||token!==revision)return;
   controller=next;next.activate();
  }catch(error){if(!disposed&&token===revision){controller?.deactivate('初期化失敗');controller=null;onError(id,error);}}
 }
 function dispose(){if(disposed)return;disposed=true;revision++;controller?.deactivate('ページ離脱');controller=null;for(const task of pending.values())task.then(c=>c.dispose?.()).catch(()=>{});}
 return {select,dispose,get current(){return current;}};
}
