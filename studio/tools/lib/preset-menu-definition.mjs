import {validatePresetDef} from './preset.mjs';

// Editor-native templates do not use legacy render routing/fit metadata.
export function validateMenuDefinition(def) {
  if (!def?.componentSource || def.baselineVersion !== undefined) return validatePresetDef(def);
  const errors=[];
  const req=(ok,message)=>{if(!ok)errors.push(message);};
  req(typeof def.id==='string' && /^[a-z0-9-]+$/.test(def.id),'invalid id');
  req(typeof def.name==='string' && !!def.name.trim(),'missing name');
  req(def.engine==='remotion','unsupported native engine');
  req(Number.isInteger(def.version) && def.version>0,'invalid version');
  req(typeof def.compositionId==='string' && !!def.compositionId,'missing compositionId');
  req(typeof def.componentSource==='string' && !!def.componentSource && !def.componentSource.startsWith('/') && !def.componentSource.split('/').includes('..'),'invalid componentSource');
  req(['draft','verified'].includes(def.status),'invalid status');
  req(Array.isArray(def.canvas) && def.canvas.length>0 && def.canvas.every(v=>/^\d+x\d+$/.test(v)),'invalid canvas');
  const d=def.duration;
  req(d && ['min','max','default'].every(k=>Number.isFinite(d[k]) && d[k]>0) && d.min<=d.default && d.default<=d.max,'invalid duration');
  req(def.slots && typeof def.slots==='object' && !Array.isArray(def.slots),'invalid slots');
  for(const [key,slot] of Object.entries(def.slots??{})) {
    req(['text','number','enum','list','image','video'].includes(slot?.type),`invalid slot ${key}`);
    if(slot?.type==='enum')req(Array.isArray(slot.values) && slot.values.length>0,`invalid enum ${key}`);
    if(slot?.min!==undefined || slot?.max!==undefined)req(Number.isFinite(slot.min) && Number.isFinite(slot.max) && slot.min<=slot.max,`invalid range ${key}`);
  }
  for(const [key,v] of Object.entries(def.variants??{}))req(Array.isArray(v.values) && v.values.includes(v.default),`invalid variant ${key}`);
  return {ok:errors.length===0,errors};
}
