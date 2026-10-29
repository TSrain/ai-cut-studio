export const SCENE_BACKGROUND_DEFAULTS={
 solid:{type:'solid',color:'#161616'},
 'video-blur':{type:'video-blur',color:'#111318',blur:20},
 gradient:{type:'gradient',color:'#10151C',color2:'#334E70',gradientType:'linear',angle:135},
 'wall-a':{type:'wall-a',color:'#10151C',ink:'#8995A5',name:'大瑞 Keaton',strength:.55,blur:0,speed:.6,centerStrength:1/3,contentWidth:65,contentHeight:60,feather:12,signatureVisible:false,signatureScale:1,signatureX:4.5,signatureY:4.5,signatureInk:'#F0F2F5',signatureMuted:'#8B939E',accent:'#E8B45B'},
 'wall-b':{type:'wall-b',color:'#080d14',ink:'#93a2b7',name:'大瑞 Keaton',strength:.6,blur:1.8,speed:.65},
};
export function resolveSceneBackground(props){
 const bg=props.sceneBackground;
 return props.editorBackground!=='transparent'&&bg&&Object.hasOwn(SCENE_BACKGROUND_DEFAULTS,bg.type)?{...SCENE_BACKGROUND_DEFAULTS[bg.type],...bg}:null;
}
export function validateSceneBackground(bg){
 if(bg===undefined||bg===null)return;
 const fail=()=>{throw Error('背景设置无效');};
 if(typeof bg!=='object'||Array.isArray(bg)||!Object.hasOwn(SCENE_BACKGROUND_DEFAULTS,bg.type))fail();
 for(const k of ['color','color2','ink','signatureInk','signatureMuted','accent'])if(bg[k]!==undefined&&!/^#[0-9a-f]{6}$/i.test(bg[k]))fail();
 if(bg.gradientType!==undefined&&!['linear','radial'].includes(bg.gradientType))fail();
 if(bg.signatureVisible!==undefined&&typeof bg.signatureVisible!=='boolean')fail();
 if(bg.name!==undefined&&(typeof bg.name!=='string'||!bg.name.trim()||bg.name.length>60))fail();
 for(const [k,min,max] of [['angle',0,360],['strength',0,1],['blur',0,bg.type==='video-blur'?80:20],['speed',0,2],['centerStrength',0,1],['contentWidth',10,100],['contentHeight',10,100],['feather',1,30],['signatureScale',.5,1.5],['signatureX',0,30],['signatureY',0,30]])if(bg[k]!==undefined&&(!Number.isFinite(bg[k])||bg[k]<min||bg[k]>max))fail();
}
