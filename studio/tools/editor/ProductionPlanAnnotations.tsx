import React from 'react';
import {Icon} from './Icon';
import {PlanVisualBadge} from './PlanVisualBadges';
import type {PlanShotView,PlanSection} from './production-plan-view-model.mjs';
export function PlanAnnotationRail({sections,side}:{sections:PlanSection[];side:'left'|'right'}){
 return <div className={'plan-annotation-rail '+side} aria-label={side==='left'?'画面安排标注':'真实素材意向标注'}>
  {sections.map(section=><section key={section.kind} className={'plan-annotation-group kind-'+section.kind} aria-label={section.title}>
   <h3><PlanVisualBadge kind={section.kind}/>{section.title}</h3>
   {section.items.map((item,index)=><div key={index} className="plan-annotation-item">
    {item.time&&<small className="plan-annotation-time">{item.time}</small>}
    <p>{item.text}</p>{item.detail&&<small>{item.detail}</small>}
    {item.status&&<span className="plan-item-status">{item.status}</span>}
   </div>)}
  </section>)}
 </div>;
}
export function PlanAnnotationHeading({onClose}:{view:PlanShotView;onClose():void}){
 return <button type="button" className="plan-annotation-close dialog-close" aria-label="关闭当前段标注" title="关闭" onClick={onClose}><Icon name="close"/></button>;
}
