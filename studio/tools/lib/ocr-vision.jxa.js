// macOS Vision 离线 OCR(JXA 桥)。由 tools/lib/ocr.mjs 经 osascript 调用,不要直接 node 跑。
//   osascript -l JavaScript tools/lib/ocr-vision.jxa.js <图片路径> [要找的文字]
// 输出 JSON:{items:[{text,box}], matches:[{text,box}]}
//   box = [x, y, w, h],**归一化、左上原点**(Vision 原生是左下原点,这里已翻转)。
// 传了第二个参数时,matches 里是每一处命中的**精确子串框**
// (VNRecognizedText.boundingBoxForRange,不是整行框)。
ObjC.import('Foundation');
ObjC.import('Vision');

function run(argv) {
  const path = argv[0];
  const query = String(argv[1] || '');
  if (!path) return JSON.stringify({error: '用法: <图片路径> [要找的文字]'});

  const url = $.NSURL.fileURLWithPath(path);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  // 语言纠错关掉:截图里多是代码/产品名,"纠错"会把 deepseek-v4-flash 改成英文单词
  req.usesLanguageCorrection = false;
  req.recognitionLanguages = $(['zh-Hans', 'en-US']);

  const err = Ref();
  const ok = handler.performRequestsError($.NSArray.arrayWithObject(req), err);
  if (!ok) return JSON.stringify({error: 'Vision 识别失败(图片路径对吗?)'});

  const flip = (r) => [r.origin.x, 1 - r.origin.y - r.size.height, r.size.width, r.size.height];

  // 匹配前归一化:丢掉全部空白、常见全角标点转半角、统一小写。
  // OCR 对空格和全半角的判断很抖("2.1: 82.7"常被认成"2.1:82.7"、中文冒号),
  // 精确匹配会大量漏;归一化串上找,再用 map 映射回原始索引拿子串框。
  const FW = {'：': ':', '，': ',', '（': '(', '）': ')', '。': '.', '；': ';', '！': '!', '？': '?', '“': '"', '”': '"', '‘': "'", '’': "'", '－': '-', '　': ' '};
  const norm = (s) => {
    let out = '';
    const map = [];
    for (let i = 0; i < s.length; i++) {
      let c = s[i].toLowerCase();
      if (FW[c]) c = FW[c];
      if (/\s/.test(c)) continue;
      out += c;
      map.push(i);
    }
    return {out, map};
  };
  const out = {items: [], matches: []};
  const results = req.results;
  for (let i = 0; i < results.count; i++) {
    const obs = results.objectAtIndex(i);
    const cands = obs.topCandidates(1);
    if (!cands.count) continue;
    const cand = cands.objectAtIndex(0);
    const str = cand.string.js;
    out.items.push({text: str, box: flip(obs.boundingBox)});
    if (!query) continue;

    // 在这一行里逐处找子串(可能出现多次),每处要精确子串框。
    // 子串定位在 JS 里做(UTF-16 索引和 NSString 一致),不走 rangeOfString 桥接——
    // JXA 把 {location,length} 传给 rangeOfString:options:range: 会桥出垃圾值(实测崩)。
    const line = norm(str);
    const q = norm(query).out;
    if (!q) continue;
    let from = 0;
    while (true) {
      const idx = line.out.indexOf(q, from);
      if (idx < 0) break;
      // 归一化索引 → 原始字符串的 NSRange
      const loc = line.map[idx];
      const end = line.map[idx + q.length - 1] + 1;
      let box = flip(obs.boundingBox); // 兜底:子串框拿不到就给整行框
      try {
        const e2 = Ref();
        const rect = cand.boundingBoxForRangeError({location: loc, length: end - loc}, e2);
        if (rect && !rect.isNil()) box = flip(rect.boundingBox);
      } catch (e) {
        /* 少数字体/旋转文本拿不到子串框,用整行框 */
      }
      out.matches.push({text: str, box});
      from = idx + q.length;
    }
  }
  return JSON.stringify(out);
}
