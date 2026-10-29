import {DRAFT_KEY,decodeDraft} from './studio-state.mjs';
const prefix='motion-studio:recovery:v2:';
export const draftKey=(id,tab)=>`${prefix}${id}:${tab}`;
export function findDraft(storage,documentId){
 const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k===DRAFT_KEY||k?.startsWith(prefix));
 return keys.map(key=>{const raw=storage.getItem(key),draft=decodeDraft(raw);return draft&&(!documentId||draft.document.id===documentId)?{...draft,storageKey:key,raw}:null;}).filter(Boolean).sort((a,b)=>b.savedAt-a.savedAt)[0]??null;
}
export function removeRecoveredDraft(storage,draft){if(draft?.storageKey&&storage.getItem(draft.storageKey)===draft.raw)storage.removeItem(draft.storageKey);}
