# Google AI Studio 汉化助手 · v1.0.0

首个正式版本（2026-10-20）。把 Google AI Studio 的英文界面完整汉化为简体中文。

## ✨ 核心能力

- **词典精确匹配汉化**：834 条去重内置词条，覆盖 Playground、运行设置、模型选择、Build、应用广场、资源库、文档、API 控制台、账号与设置等全部主要界面。
- **78 条动态文案正则**：处理 `1,024 个 Token`、`3 分钟前`、账号标签、模型定价行、删除确认等带变量的文案。
- **属性级汉化**：`placeholder` / `title` / `aria-label` / `alt` 一并翻译，不留英文死角。
- **三不触碰**：不翻译用户提示词、模型输出与代码块；对 `contenteditable`、`pre/code`、聊天容器做硬隔离。
- **SPA 自适应**：MutationObserver + 双集合幂等 + 时间片队列，适配 Angular 重渲染与动态插入，不闪屏、不死循环。
- **Shadow DOM 穿透**：递归处理开放 Shadow Root 中的文本。
- **一键还原英文**：所有译文记录原文，可随时完整回滚对照。
- **强制英文底本**：可选 DNR 规则把 `hl` 参数改写为 `en`，避免中英混排导致词典命中不稳定。
- **自定义词典 / 排除规则 / 正则规则**：设置页可视化增删改，支持导入导出 JSON。
- **未汉化收集箱**：自动收集漏译候选，可复制、下载、一键转为自定义词条。
- **译文高亮与悬停看原文**：校对模式，一眼分辨哪些内容已汉化。
- **快捷键**：`Alt+Shift+H` 一键开关汉化。

## 📦 安装

1. 下载本 Release 的 `google-ai-studio-zh-1.0.0.zip` 并解压（或直接使用源码目录）。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。
4. 访问 https://aistudio.google.com/ ，插件会自动生效。

## ✅ 质量验证

- 无头 Chrome 夹具测试：**30 / 30 通过**（含 Angular 重渲染、动态节点、Shadow DOM、图标/代码/聊天输出不误伤）。
- 真实扩展加载测试（Edge + CDP，临时用户目录）：**18 / 18 通过**（Service Worker、content script、popup、options 全部正常）。
- 真实登录态页面注入验证：Playground、运行设置、模型选择、工具、设置弹窗、账号、通知、应用广场、文档、API 控制台等 18 个区域截图留证。
- 词典覆盖率：真实勘察文本去重后 **87%+** 已覆盖，未覆盖部分主要为品牌名/模型名/代码/动态内容（按设计不翻译）。

## ⚠️ 已知限制

- 模型卡片的后台描述、示例提示词等 Google 动态内容不在词典内时保持英文（可在设置页自行补充词条）。
- Google 大幅改版后部分文案可能失效，可用「未汉化收集」快速补充，或参考 `docs/维护指南.md` 更新词库。
- 本扩展为第三方开源项目，与 Google 无关。

## 🔒 隐私

- 零网络请求；所有设置与词条仅保存在 `chrome.storage.local`。
- 仅申请 `storage` 与 `declarativeNetRequestWithHostAccess` 权限，作用域限定 `https://aistudio.google.com/*`。
