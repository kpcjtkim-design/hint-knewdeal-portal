// In-memory only. Never persist students, contact details or tokens in browser storage.
// A database and the exact signed-in User object own each short-lived read cache.
const sessions=new WeakMap();
const object=value=>value!==null&&(typeof value==='object'||typeof value==='function');
function entriesFor(db,user){
 if(!object(db)||!object(user))return null;
 let users=sessions.get(db);if(!users){users=new WeakMap();sessions.set(db,users);}
 let entries=users.get(user);if(!entries){entries=new Map();users.set(user,entries);}return entries;
}
// Cache plain data, not Firestore snapshots. Clone each result so editing one view
// cannot mutate data subsequently opened by another view.
const copy=value=>structuredClone(value);
export async function cachedRead(db,user,key,loader,{fresh=false,ttl=60000}={}){
 const entries=entriesFor(db,user);if(!entries)return loader();
 const previous=entries.get(key);
 if(previous?.pending)return copy(await previous.pending);
 if(!fresh&&previous&&Date.now()-previous.at<ttl)return copy(previous.value);
 const entry={pending:null,at:0};
 entry.pending=Promise.resolve().then(loader).then(value=>{
  if(entries.get(key)===entry){entry.value=copy(value);entry.at=Date.now();entry.pending=null;}
  return value;
 }).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
 entries.set(key,entry);
 // Bound retention. Eviction never cancels or duplicates an active request.
 if(entries.size>120)for(const [oldKey,old]of entries){if(entries.size<=120)break;if(!old.pending)entries.delete(oldKey);}
 return copy(await entry.pending);
}
export function invalidateRead(db,user,key){entriesFor(db,user)?.delete(key);}
export function invalidateReadPrefix(db,user,prefix){const entries=entriesFor(db,user);if(entries)for(const key of entries.keys())if(key.startsWith(prefix))entries.delete(key);}
export function clearReadSession(db){if(object(db))sessions.delete(db);}
