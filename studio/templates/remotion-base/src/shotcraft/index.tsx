// video-shotcraft 15 效果复刻区注册表。验证期用:每个条目 1920×1080@30,
// 时长与参考 demo 逐帧一致(有导出常量的用常量,没有的取参考 mp4 帧数)。
// preset 化完成后此目录只留作对照,不进出片流程。
// 注:useT 系 demo 的参考 mp4 把 15 帧尾部静置计入了 useT 分母,注册时长 +15 才逐帧对齐。
import React from 'react';
import {BlurSlide, BLUR_SLIDE_DURATION} from './BlurSlide';
import {BraceExpand, BRACE_EXPAND_DURATION} from './BraceExpand';
import {BrandInkOpen} from './BrandInkOpen';
import {CardStack, CARD_STACK_DURATION} from './CardStack';
import {Carousel3D, CAROUSEL_3D_DURATION} from './Carousel3D';
import {CounterConfetti, COUNTER_CONFETTI_DURATION} from './CounterConfetti';
import {CubeNavigation, CUBE_NAVIGATION_DURATION} from './CubeNavigation';
import {DocumentTypewriterReveal} from './DocumentTypewriterReveal';
import {FlyingWords, FLYING_WORDS_DURATION} from './FlyingWords';
import {GlassPillDictationTyping, GLASS_PILL_DICTATION_TYPING_DURATION} from './GlassPillDictationTyping';
import {GrazeFaceTour} from './GrazeFaceTour';
import {LetterspaceMaterialize} from './LetterspaceMaterialize';
import {MarkerUnderlineTitle} from './MarkerUnderlineTitle';
import {RadialRipplePhoneChips, RADIAL_RIPPLE_PHONE_CHIPS_DURATION} from './RadialRipplePhoneChips';
import {SegmentedThumbHero} from './SegmentedThumbHero';
// —— 2026-08-26 第二批(basic-3d-scene / timeline-travel / text-as-mask)
import {Basic3DScene, BASIC_3D_SCENE_DURATION} from './Basic3DScene';
import {TimelineTravel} from './TimelineTravel';
import {TextAsMask} from './TextAsMask';

export const SHOTCRAFT_REPLICAS: {id: string; component: React.FC; duration: number}[] = [
  {id: 'ScBlurSlide', component: BlurSlide, duration: BLUR_SLIDE_DURATION + 15},
  {id: 'ScBraceExpand', component: BraceExpand, duration: BRACE_EXPAND_DURATION + 15},
  {id: 'ScBrandInkOpen', component: BrandInkOpen, duration: 83},
  {id: 'ScCardStack', component: CardStack, duration: CARD_STACK_DURATION + 15},
  {id: 'ScCarousel3D', component: Carousel3D, duration: CAROUSEL_3D_DURATION + 15},
  {id: 'ScCounterConfetti', component: CounterConfetti, duration: COUNTER_CONFETTI_DURATION + 15},
  {id: 'ScCubeNavigation', component: CubeNavigation, duration: CUBE_NAVIGATION_DURATION + 15},
  {id: 'ScDocumentTypewriterReveal', component: DocumentTypewriterReveal, duration: 110},
  {id: 'ScFlyingWords', component: FlyingWords, duration: FLYING_WORDS_DURATION + 15},
  {id: 'ScGlassPillDictationTyping', component: GlassPillDictationTyping, duration: GLASS_PILL_DICTATION_TYPING_DURATION + 15},
  {id: 'ScGrazeFaceTour', component: GrazeFaceTour, duration: 150},
  {id: 'ScLetterspaceMaterialize', component: LetterspaceMaterialize, duration: 130},
  {id: 'ScMarkerUnderlineTitle', component: MarkerUnderlineTitle, duration: 100},
  {id: 'ScRadialRipplePhoneChips', component: RadialRipplePhoneChips, duration: RADIAL_RIPPLE_PHONE_CHIPS_DURATION + 15},
  {id: 'ScSegmentedThumbHero', component: SegmentedThumbHero, duration: 110},
  {id: 'ScBasic3DScene', component: Basic3DScene, duration: BASIC_3D_SCENE_DURATION + 15},
  {id: 'ScTimelineTravel', component: TimelineTravel, duration: 160},
  {id: 'ScTextAsMask', component: TextAsMask, duration: 150},
];
