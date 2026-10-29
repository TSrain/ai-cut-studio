export const STACK_PRESETS=[['stack','桌面散放'],['fan','扇形展开'],['staircase','阶梯叠放'],['alternating','左右交错'],['deck','中心叠牌'],['spread','平铺网格']].map(([id,label])=>({id,label,props:{layout:id}}));
export const SPLIT_PRESETS=[
 {id:'diagonal',label:'斜切分屏',props:{layout:'diagonal',separatorAngle:20,separatorPosition:50}},
 {id:'diagonal-reverse',label:'反向斜切',props:{layout:'diagonal',separatorAngle:-20,separatorPosition:50}},
 {id:'horizontal',label:'左右分屏',props:{layout:'horizontal',separatorPosition:50}},
 {id:'vertical',label:'上下分屏',props:{layout:'vertical',separatorPosition:50}},
 {id:'left-wide',label:'左宽右窄',props:{layout:'horizontal',separatorPosition:65}},
 {id:'right-wide',label:'左窄右宽',props:{layout:'horizontal',separatorPosition:35}},
];
export function applyMediaPreset(props,id){const preset=[...STACK_PRESETS,...SPLIT_PRESETS].find(p=>p.id===id);if(!preset)throw Error('未知排列样式');return {...props,...preset.props};}
export function selectedMediaPreset(props){if(props.layout==='diagonal')return props.separatorAngle<0?'diagonal-reverse':'diagonal';if(props.layout==='horizontal')return props.separatorPosition>55?'left-wide':props.separatorPosition<45?'right-wide':'horizontal';return props.layout;}
export function resolveMediaTarget(props,selectedId){return props.items?.find(i=>i.id===selectedId)??props.items?.find(i=>!i.media)??props.items?.[0]??null;}
