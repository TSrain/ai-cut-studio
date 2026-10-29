// Primary use, reviewed against all 26 presets plus the editor's chapter bar.
export const TEMPLATE_CATEGORIES = [
  {id: 'opening', label: '开场标题', description: '介绍主题、栏目或新章节'},
  {id: 'navigation', label: '章节导航', description: '告诉观众讲到哪里、还剩什么'},
  {id: 'emphasis', label: '重点强调', description: '突出关键词、引用和核心结论'},
  {id: 'list-flow', label: '清单流程', description: '逐项讲清要点、模块和步骤'},
  {id: 'compare', label: '对比变化', description: '比较方案、切换状态、回顾演进'},
  {id: 'data', label: '数据图表', description: '用数字、趋势和数量支撑结论'},
  {id: 'demo', label: '素材演示', description: '展示截图、录屏、文档和产品'},
];

export const TEMPLATE_USES = {
  'media-stage': {category:'demo',purpose:'背景墙承托素材与动态短标题',keywords:'标题 背景墙 姓名 图片 视频 素材 定妆 展示'},
  'media-stack': {category:'demo',purpose:'多张真实截图自然堆叠或展开',keywords:'截图 图片 视频 堆叠 证据 素材'},
  'media-split': {category:'demo',purpose:'1–4 段依次分屏与交替替换',keywords:'分屏 对照 视频 图片 素材 替换 连续 全屏'},
  'source-pip': {category:'demo',purpose:'主轨真人同步缩入圆角小窗',keywords:'真人 口播 小窗 画中画 主轨 同步 pip'},
  'brand-open': {category:'opening', purpose:'品牌或栏目名登场，建立开场识别', keywords:'片头 栏目 品牌 logo 开场'},
  'title-reveal': {category:'opening', purpose:'引出本期主题或下一段章节标题', keywords:'片头 标题 章节 转场 主题'},
  'text-mask': {category:'opening', purpose:'从大字中的画面过渡到完整场景', keywords:'片头 字幕遮罩 转场 产品 揭晓'},
  'chapter-progress': {category:'navigation', purpose:'随全片推进，显示当前章节进度', keywords:'导航 目录 进度条 章节 全片'},
  'chapter-navigation': {category:'navigation', purpose:'列出章节目录，高亮当前讲述位置', keywords:'导航 目录 章节 当前章节 实拍 叠加'},
  'key-concept': {category:'emphasis', purpose:'放大一个关键词，并补一句解释', keywords:'关键词 关键字 概念 定义 重点 强调'},
  'quote-card': {category:'emphasis', purpose:'让引用原话或金句单独上屏', keywords:'引用 金句 原话 观点 重点'},
  'recede': {category:'emphasis', purpose:'减少画面干扰，让一句判断停留', keywords:'停顿 留白 观点 判断 结论 重点'},
  'word-cascade': {category:'emphasis', purpose:'逐词呈现问题、答案或强调句', keywords:'动字 动态文字 提问 问答 金句 关键词 叠加'},
  'flying-words': {category:'emphasis', purpose:'一串关键词掠过，收束到核心结论', keywords:'关键词 关键字 隧道 大量 信息量 收束 结论'},
  'bullet-run': {category:'list-flow', purpose:'逐条讲清几个原因、特征或要点', keywords:'清单 列表 原因 特征 要点 列举'},
  'pill-stack': {category:'list-flow', purpose:'在实拍旁逐条叠加简短要点', keywords:'清单 标签 要点 口播 实拍 叠加 胶囊'},
  'card-showcase': {category:'list-flow', purpose:'用卡片逐个介绍一组并列选项', keywords:'清单 卡片 列举 选项 功能 集合 轮播'},
  'cube-nav': {category:'list-flow', purpose:'逐面介绍同一系统的几个模块', keywords:'结构 系统 模块 功能 导航 立方体'},
  'step-flow': {category:'list-flow', purpose:'讲清先后步骤，以及步骤间的承接', keywords:'流程 步骤 工作流 机制 先后 顺序'},
  'space-steps': {category:'list-flow', purpose:'逐站讲解几个步骤，最后回看全貌', keywords:'流程 步骤 空间 总览 路线 全貌'},
  'contrast-pair': {category:'compare', purpose:'并排比较新旧方案或两种观点', keywords:'对比 前后对比 比较 新旧 优劣 方案 VS'},
  'segmented-thumb': {category:'compare', purpose:'用开关动作表达二选一或模式切换', keywords:'对比 选择 二选一 切换 模式 状态 产品交互'},
  'timeline-travel': {category:'compare', purpose:'沿时间线回顾版本、历史或里程碑', keywords:'变化 演进 历史 版本 里程碑 时间线 时间轴'},
  'behind-title': {category:'emphasis',purpose:'自动抠出人物，巨型文字置于人物身后，快速进出场',keywords:'人物 身后 抠像 大字 震撼 强调'},
  'number-beat': {category:'data', purpose:'突出一个关键数字、比例或金额', keywords:'数字 数据 百分比 比例 金额 指标 重点 强调'},
  'trend-chart': {category:'data', purpose:'用折线、面积或柱形呈现数据变化', keywords:'数据 图表 趋势 增长 折线 面积 柱状图 柱形图'},
  'card-swarm': {category:'data', purpose:'用卡片数量表现去重、筛选和留存', keywords:'数量 数据 多到少 去重 筛选 过滤 留存 收束'},
  'aspect-embed': {category:'demo', purpose:'嵌入不同画幅的视频，并配旁白标题', keywords:'录屏 视频 素材 横屏 竖屏 嵌入 展示 演示'},
  'screen-push': {category:'demo', purpose:'推近截图，圈出需要观众看的证据', keywords:'截图 网页 证据 标注 划线 圈选 高亮 重点'},
  'phone-ripple': {category:'demo', purpose:'展示手机界面，并配两侧功能标签', keywords:'手机 界面 产品 App 功能 展示 演示'},
  'doc-typewriter': {category:'demo', purpose:'逐步写出文档内容，展示生成过程', keywords:'文档 写作 报告 生成 内容产出 演示'},
  'glass-pill': {category:'demo', purpose:'模拟搜索、语音或 AI 输入的开场', keywords:'输入 搜索 语音 AI 提示词 对话 产品交互 打字'},
};

export const templateUse = (id) => TEMPLATE_USES[id] ?? {
  category: '', purpose: '点击预览查看模板效果', keywords: '',
};
