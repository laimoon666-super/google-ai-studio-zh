# Google AI Studio 汉化插件 · 团队协作契约

> 所有 teammate 必读。本文件是唯一的接口约定，改动请先通知 Lead。

## 1. 项目目标

做一个 Chrome MV3 扩展，把 `https://aistudio.google.com/*` 的英文界面**确定性**地汉化为简体中文。
不是"AI 实时翻译"：采用**词典精确匹配 + 正则动态规则**，只翻译 UI 文案，绝不翻译用户提示词、模型输出、代码。

## 2. 目录与归属（写范围，禁止越界）

```
google-ai-studio-zh/
├── manifest.json               [Lead]
├── CONTRACT.md                 [Lead]
├── README.md                   [docs-pack]
├── docs/                       [docs-pack]
├── icons/                      [docs-pack]
├── scripts/                    [docs-pack]
├── recon/                      [各 recon 同学] 原始勘察数据（JSON）
├── fixtures/                   [Lead]
└── src/
    ├── background.js           [Lead]  Service Worker
    ├── content.css             [Lead]  译文高亮样式
    ├── core/
    │   ├── engine.js           [Lead]  翻译引擎（核心，勿动）
    │   ├── patterns.js         [Lead]  正则动态规则
    │   └── boot.js             [Lead]  启动/设置同步
    ├── dict/
    │   ├── _common.js          [Lead]  通用高频词条
    │   ├── playground.js       [dict-playground]
    │   ├── build.js            [dict-build]
    │   └── manage.js           [dict-manage]
    ├── popup/                  [ui]  popup.html / popup.js / popup.css
    ├── options/                [ui]  options.html / options.js / options.css
    └── ui/theme.css            [ui]  两个页面共用的设计系统
```

## 3. 词典格式（dict-*.js）

文件必须是**可直接被 content script 顺序加载的同步脚本**，不允许 import/export、不允许顶层 await：

```js
/* 分卷：Playground（对话实验室 / 运行设置） */
(function () {
  const D = (window.__AIZ_DICT__ = window.__AIZ_DICT__ || {});
  const S = (window.__AIZ_DICT_SOURCE__ = window.__AIZ_DICT_SOURCE__ || {});

  const PART = {
    "Playground": "对话实验室",
    "Run settings": "运行设置"
  };
  Object.assign(D, PART);
  Object.keys(PART).forEach(function (key) {
    if (!(key in S)) S[key] = 'playground'; // 分卷名：common/playground/build/manage
  });
})();
```

硬性规则：

1. **key = 页面上英文原文**，按"去首尾空白 + 连续空白折叠为单个空格"归一化后书写，大小写与页面一致（引擎有大小写兜底，但请你写准确）。
2. **value = 简体中文译文**，按钮/标签类要短（≤8 个汉字优先），提示类可以长。
3. **不要收录**：模型名（Gemini 4 Argon、gemini-4-argon）、品牌名（Google、Gemini、AI Studio、Imagen、Veo）、纯数字/纯符号、Material 图标连字名（`menu_open`、`chat_spark`、`share`…）。
4. **一 key 一译文**，同一英文在不同语境下优先给最通用的译法；确实冲突时用 Lead 指定的术语表（见 §6）。
5. 词典里**不要**出现中文 key。
6. 只写自己在 §2 分到的文件；不要修改别人的分卷。
7. 每条词条必须**来自真实页面勘察**（可在浏览器里确认），不要凭空编造。

## 4. 存储与消息契约（UI 页面必读）

`chrome.storage.local` 的 key 全部以 `aiz.` 前缀：

| key | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `aiz.settings` | object | 见下 | 全局设置，content script 监听 `chrome.storage.onChanged` 实时生效 |
| `aiz.customDict` | `{[en]: zh}` | `{}` | 用户自定义词条，优先级最高 |
| `aiz.unmatched` | `{[en]: 次数}` | `{}` | 页面上发现但词典未命中的英文 UI 文案候选 |
| `aiz.stats` | `{translated, at, url}` | `{}` | 最近一次翻译统计 |
| `aiz.schema` | number | `1` | 数据版本，升级时用于迁移 |

```js
默认 settings = {
  enabled: true,          // 总开关
  forceEnglish: true,     // 用 DNR 强制 AI Studio 以英文渲染（保证词典命中一致性）
  highlight: false,       // 译文加浅色底纹，便于校对
  hoverOriginal: false,   // 悬停译文显示英文原文（tooltip）
  translateAttrs: true,   // 翻译 placeholder / aria-label / title / alt
  collectUnmatched: true, // 收集未命中英文文案
  extraSkipSelectors: [], // 用户追加的"不翻译" CSS 选择器
  extraPatterns: []       // 用户自定义动态规则 {re, flags, to, note}
};
```

**消息 API（content script 侧实现，UI 直接调用 `chrome.tabs.sendMessage`）**

```js
{ type: 'AIZ_GET_STATS' }  -> { ok:true, enabled, translated, unmatched:[en...], version:'1.0.0' }
{ type: 'AIZ_RETRANSLATE' }-> { ok:true, translated }
{ type: 'AIZ_CLEAR_MARKS' }-> { ok:true }   // 还原为英文，便于对比
{ type: 'AIZ_APPLY_SETTINGS' } -> { ok:true }
{ type: 'AIZ_GET_SNAPSHOT' } -> { ok:true, source:'content', version,
  volumes:{common,playground,build,manage,custom,builtin}（显示名）,
  dict:[{en, zh, volume}], patterns:[{src, to, note, sample}], generatedAt }
```

**UI 页面可用 `chrome.runtime.sendMessage`**

```js
{ type: 'AIZ_OPEN_OPTIONS' } -> background 打开设置页
{ type: 'AIZ_GET_META' }     -> { ok:true, version, dictCount, builtinDictSize }
```

UI 页面**不要**自己写 `chrome.declarativeNetRequest` 规则；`forceEnglish` 开关只写 storage，background 负责落地动态规则。

## 5. 浏览器勘察纪律（recon 同学）

- 只使用 `https://aistudio.google.com/...` 页面，**只读**：允许点击菜单/展开折叠/打开弹窗后关闭；**禁止**新建应用、删除、发送提示词给模型（会消耗额度）、修改账号设置、点"Save/Run"提交。
- 只用 `browser_open_tab` 打开**自己的**标签页，别动别人的 tabId；结束用 `browser_close_tab` 关闭。
- 右上角 HUD 用来给用户展示进度：`browser_set_hud`。
- 勘察产出写两份：
  1. `recon/<你的名字>.dump.json`：`{route, texts:[...], attrs:[{a,v,tag}], notes}` 原始数据（证据，供 Lead 复核）。
  2. `src/dict/<你的分卷>.js`：正式词条。

### 推荐的勘察脚本（在 `browser_evaluate` 里跑，返回精简 JSON）

```js
(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const texts = new Set(), attrs = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (t.length > 1 && n.parentElement && vis(n.parentElement)) texts.add(t);
  }
  document.querySelectorAll('[aria-label],[placeholder],[title],[alt]').forEach(el => {
    for (const a of ['aria-label','placeholder','title','alt']) {
      const v = el.getAttribute(a);
      if (v && v.trim().length > 1) attrs.push({ a, v: v.trim(), tag: el.tagName.toLowerCase() });
    }
  });
  return JSON.stringify({ url: location.href, texts: [...texts], attrs });
})()
```

图标连字（`menu_open`、`chat_spark` 这类）会混在 texts 里，**请忽略**。

## 6. 术语表（统一口径，必须遵守）

| English | 中文 | 备注 |
|---|---|---|
| Playground | 对话实验室 | 侧边栏主入口 |
| prompt | 提示词 | 不译作"提示" |
| Run / Run settings | 运行 / 运行设置 | |
| System instructions | 系统指令 | 与 Google 官方一致 |
| Thinking level / budget | 思考等级 / 思考预算 | |
| Structured outputs | 结构化输出 | |
| Code execution | 代码执行 | |
| Function calling | 函数调用 | |
| Grounding / Grounded | 接地 / 已接地 | Google 官方译法；"Grounding with Google Search"→"Google 搜索接地" |
| URL context | URL 上下文 | |
| Token | Token | 不译 |
| Model | 模型 | |
| Build | 构建 | 侧边栏分组 |
| New app / My apps | 新建应用 / 我的应用 | |
| Gallery | 应用广场 | 侧边栏 Gallery |
| History | 历史记录 | 路由 /library |
| Dashboard | 控制台 | 路由 /api-keys |
| Documentation | 文档 | 路由 /docs |
| API key | API 密钥 | |
| Share | 分享 | |
| Settings | 设置 | |
| Advanced settings | 高级设置 | |
| Learn more | 了解更多 | |
| Copy | 复制 | |
| Delete | 删除 | |
| Save | 保存 | |
| Cancel | 取消 | |
| Close | 关闭 | |
| Done | 完成 | |
| Retry | 重试 | |
| Download | 下载 | |
| Upload | 上传 | |
| Search | 搜索 | |
| Account | 账号 | "Google Account:" → "Google 账号：" |
| quota | 配额 | |
| credits | 赠金/额度 | API credits → API 赠金 |

## 7. 质量红线

- 任何文件都不允许出现 `undefined`、`TODO` 残留、语法错误；JS 必须能被 `node --check` 通过（Lead 会跑）。
- 词典 JSON/JS 对象里不允许重复 key 导致互相覆盖（如果你需要覆盖，请注释说明）。
- 不要引入任何外部依赖、CDN、网络请求。扩展必须完全离线可用。
- UI 页面必须是纯原生 HTML/CSS/JS，无框架、无构建步骤。

## 8. 交付自检

完成后各自回报：

1. 改了哪些文件（绝对路径）。
2. 词条数量 / 覆盖的页面路由。
3. 自检方式与结果（页面截图或 DOM 抽查）。
4. 已知缺口（哪些文案没覆盖，为什么）。
