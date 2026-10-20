/* ============================================================
 * 词典分卷：Playground / 对话 / 运行设置 (Playground / Chat / Run Settings)
 * 覆盖路由：
 *  - /prompts/new_chat (Playground 对话实验室主界面)
 *  - /prompts/* (已有对话详情、运行设置、更多操作)
 * 包含模块：
 *  1. 左侧导航栏与账号区 (Explore/Build/Manage 分组、PRO 徽标、升级提示卡)
 *  2. 顶部工具条 (Share prompt / New chat / Compare mode / View more actions / 菜单项)
 *  3. Playground 空态与推荐卡片 (Prompts to try、应用画廊卡片)
 *  4. 提示词输入区域 (输入框 placeholder、拖拽提示、API 密钥弹窗、快捷键提示、语音输入)
 *  5. 媒体插入菜单 (Drive / Upload files / Record Audio / Camera / YouTube Video / Sample Media)
 *  6. 运行设置右栏 (Run settings、模型卡说明、系统指令卡片)
 *  7. 思考等级设置 (Thinking level 选项与说明 tooltip)
 *  8. 工具选项与开关 (Structured outputs / Code execution / Function calling / Grounding / URL context)
 *  9. 高级设置 (Media resolution / Safety settings / Add stop sequence / Output length)
 *  10. 运行安全设置弹窗 (Run safety settings 类别、滑块档位、免责声明)
 *  11. 系统指令面板与删除确认 (System instructions / Create / Delete dialog)
 *  12. 模型选择侧滑面板 (Model selection / 搜索框 / 分类标签 / 卡片属性 / 空搜索态)
 *  13. 获取代码面板 (Get code / Open in Colab / Download / API Docs)
 *  14. Token 计数与计费说明 (Pricing tooltips / Token counting)
 * ============================================================ */
(function () {
  'use strict';
  const D = (window.__AIZ_DICT__ = window.__AIZ_DICT__ || {});

  const S = (window.__AIZ_DICT_SOURCE__ = window.__AIZ_DICT_SOURCE__ || {});

  const PART = {
    /* ============================================================
     * 1. 左侧导航与账号升级区 (Navbar & Account & Promo)
     * ============================================================ */
    "Explore": "探索",
    "Playground": "对话实验室",
    "History": "历史记录",
    "Build": "构建",
    "New app": "新建应用",
    "My apps": "我的应用",
    "Gallery": "应用广场",
    "Manage": "管理",
    "Dashboard": "控制台",
    "Documentation": "文档",
    "Unlock Gemini 4 Argon": "解锁 Gemini 4 Argon",
    "Access to higher quota, API credits and more": "获取更高配额、API 赠金等更多权益",
    "Collapse navigation menu": "收起导航菜单",
    "Expand navigation menu": "展开导航菜单",
    "What's new": "最近更新",
    "Settings": "设置",
    "Search (Ctrl /)": "搜索（Ctrl /）",
    "Get API key": "获取 API 密钥",

    /* ============================================================
     * 2. 顶部工具条与更多操作菜单 (Toolbar & More Actions)
     * ============================================================ */
    "Share prompt": "分享提示词",
    "New chat": "新建对话",
    "View more actions": "更多操作",
    "Compare mode": "对比模式",
    "Temporary chat": "临时对话",
    "Toggle temporary chat": "切换临时对话",
    "No changes to save": "没有需要保存的更改",
    "Save prompt": "保存提示词",
    "Make a copy": "创建副本",
    "Delete prompt": "删除提示词",
    "Raw Mode": "原始模式",
    "Toggle viewing raw output": "切换查看原始输出",
    "Already in a new chat": "已在新建对话中",
    "You need to create and run a prompt in order to share it": "您需要创建并运行提示词后才能进行分享",
    "Moves to Google Drive Trash (Permanently deleted after 30 days)": "移至 Google 云端硬盘回收站（30 天后永久删除）",
    "Show conversation without markdown formatting": "显示未经过 Markdown 格式化的对话内容",

    /* ============================================================
     * 3. Playground 空态与示例卡片 (Zero State & Prompts to Try)
     * ============================================================ */
    "Chat with Gemini 4 Argon": "与 Gemini 4 Argon 对话",
    "Ask, reason, and build. Start with a prompt or remix an app from the gallery.": "提问、推理、构建。输入提示词，或从应用广场中选择应用进行改写。",
    "Prompts to try": "可试用的提示词",
    "Estimate Jet Stream Speed": "估算急流风速",
    "Compare National Park Seasons and Permits": "对比国家公园的季节与许可证",
    "Understand why GPS needs relativity": "了解为什么 GPS 需要相对论",
    "Learn more": "了解更多",
    "Chess 3D": "3D 国际象棋",
    "Open in app gallery": "在应用广场中打开",
    "Pocket World Terrarium": "口袋微观生态瓶",
    "Desk Racer": "桌面赛车",

    /* ============================================================
     * 4. 提示词输入区域 (Prompt Box & Controls)
     * ============================================================ */
    "Enter a prompt": "输入提示词",
    "Start typing a prompt to see what our models can do": "开始输入提示词，看看我们的模型能做什么",
    "Drop files here": "将文件拖放到此处",
    "Insert images, videos, audio, or files": "插入图片、视频、音频或文件",
    "No API key selected": "未选择 API 密钥",
    "API key information": "API 密钥信息",
    "Link a paid API key here.": "在此处关联付费 API 密钥。",
    "Choose project and API key": "选择项目和 API 密钥",
    "No project and API key detected. Create or import a Paid Tier Project.": "未检测到项目和 API 密钥。请创建或导入付费层级项目。",
    "Import project": "导入项目",
    "Create a project and key": "创建项目与密钥",
    "Set up billing": "设置结算",
    "Link API key": "关联 API 密钥",
    "Tools menu": "工具菜单",
    "Open tools menu": "打开工具菜单",
    "Scroll left": "向左滚动",
    "Scroll right": "向右滚动",
    "Speech to text": "语音转文字",
    "Run": "运行",
    "This model requires a paid API key to use. Please select an API key.": "该模型需要付费 API 密钥才能使用。请选择一个 API 密钥。",
    "Submit: Ctrl + Enter\nNewline: Enter": "提交：Ctrl + Enter\n换行：Enter",
    "Submit: Enter\nNewline: Shift + Enter": "提交：Enter\n换行：Shift + Enter",
    "Press space for more information.": "按空格键了解更多信息。",
    "Enable autocomplete suggestions while typing": "键入时启用自动补全建议",
    "Disable autocomplete suggestions": "禁用自动补全建议",
    "Enable applet notifications": "启用应用通知",
    "Disable applet notifications": "禁用应用通知",

    /* ============================================================
     * 5. 媒体插入菜单 (Add Media Dropdown)
     * ============================================================ */
    "Drive": "云端硬盘",
    "Upload files": "上传文件",
    "Record Audio": "录制音频",
    "Camera": "相机",
    "YouTube Video": "YouTube 视频",
    "Sample Media": "示例媒体",

    /* ============================================================
     * 6. 运行设置面板 (Run Settings Right Panel)
     * ============================================================ */
    "Run settings": "运行设置",
    "Get code": "获取代码",
    "Get SDK code to chat with Gemini": "获取与 Gemini 对话的 SDK 代码",
    "Reset default settings": "恢复默认设置",
    "Close run settings panel": "关闭运行设置面板",
    "Our most capable model, built to solve the hardest problems with depth and precision across real-world software engineering and knowledge work.": "我们能力最强的模型，专为深入、精准地解决现实软件工程与知识工作中的难题而构建。",
    "System instructions": "系统指令",
    "Optional tone and style instructions for the model": "可选的语气与风格指令，用于引导模型",

    /* ============================================================
     * 7. 思考等级设置 (Thinking Level)
     * ============================================================ */
    "Thinking level": "思考等级",
    "Thinking Level": "思考等级",
    "Set the thinking level": "设置思考等级",
    "Low": "低",
    "Medium": "中",
    "High": "高",
    "Optimizes for latency": "针对延迟进行优化",
    "A balanced choice for general purpose use and solid quality": "兼顾通用用途与可靠质量的均衡之选",
    "(Recommended) Maximizes reasoning depth": "（推荐）最大化推理深度",

    /* ============================================================
     * 8. 工具选项与开关 (Tools Section)
     * ============================================================ */
    "Tools": "工具",
    "Expand or collapse tools": "展开或收起工具",
    "Structured outputs": "结构化输出",
    "Generate structured outputs": "生成结构化输出",
    "Edit JSON schema": "编辑 JSON Schema",
    "Code execution": "代码执行",
    "Lets Gemini use code to solve complex tasks": "允许 Gemini 使用代码解决复杂任务",
    "Function calling": "函数调用",
    "Edit function declarations": "编辑函数声明",
    "Lets you define functions that Gemini can call\n\n This tool is not compatible with the current active tools.": "允许您定义 Gemini 可调用的函数\n\n该工具与当前已启用的工具不兼容。",
    "Grounding with Google Search": "Google 搜索接地",
    "Remove Grounding with Google Search": "移除 Google 搜索接地",
    "Use Google Search": "使用 Google 搜索",
    "Source:": "来源：",
    "Google Search": "Google 搜索",
    "URL context": "URL 上下文",
    "Browse the url context": "浏览 URL 上下文",
    "Grounding with Google Maps": "Google 地图接地",
    "Image search": "图片搜索",

    /* ============================================================
     * 9. 高级设置 (Advanced Settings)
     * ============================================================ */
    "Advanced settings": "高级设置",
    "Expand or collapse advanced settings": "展开或收起高级设置",
    "Media resolution": "媒体分辨率",
    "Higher resolutions may provide better understanding but use more tokens.": "更高的分辨率可能会提供更好的理解能力，但会消耗更多的 Token。",
    "Default": "默认",
    "Safety settings": "安全设置",
    "Edit safety settings": "编辑安全设置",
    "Adjust harmful response settings": "调整有害回复设置",
    "Add stop sequence": "添加停止序列",
    "Add stop...": "添加停止标记…",
    "End Tokens": "结束 Token",
    "Truncate response including and after string" : "在出现该字符串及其之后截断回复",
    "Output length": "输出长度",
    "Maximum output tokens": "最大输出 Token 数",
    "Maximum number of tokens in response": "回复中的最大 Token 数量",
    "Up to 1,048,576. Responses beyond 32,768 tokens continue automatically in multiple parts, so they take longer.": "最高支持 1,048,576。超过 32,768 个 Token 的回复会自动分段继续输出，因此耗时更长。",

    /* ============================================================
     * 10. 运行安全设置弹窗 (Safety Settings Modal)
     * ============================================================ */
    "Run safety settings": "运行安全设置",
    "Close Run Safety Settings": "关闭运行安全设置",
    "Adjust how likely you are to see responses that could be harmful. Content is blocked based on the probability that it is harmful. This only applies to text outputs.": "调整看到潜在有害回复的概率。系统将根据内容有害的概率进行拦截。这仅适用于文本输出。",
    "You are responsible for ensuring that safety settings for your intended use case comply with the": "您有责任确保适用于您目标用例的安全设置符合",
    "Terms": "条款",
    "and": "和",
    "Use Policy": "使用政策",
    "Harassment": "骚扰内容",
    "Off": "关",
    "Hate": "仇恨内容",
    "Sexually Explicit": "露骨性爱内容",
    "Dangerous Content": "危险内容",
    "Reset defaults": "恢复默认",
    "Restore Default Settings": "恢复默认设置",
    "Block none": "都不拦截",
    "Block few": "较少拦截",
    "Block some": "部分拦截",
    "Block most": "大部分拦截",

    /* ============================================================
     * 11. 系统指令面板与删除确认 (System Instructions)
     * ============================================================ */
    "Create new instruction": "新建指令",
    "Untitled instruction": "未命名指令",
    "Title": "标题",
    "Delete system instruction": "删除系统指令",
    "Delete system instruction?": "删除系统指令？",
    "This action cannot be undone.": "此操作无法撤消。",
    "System instruction deleted": "系统指令已删除",
    "System instructions cannot be updated while a stream is active": "流式传输活动时无法更新系统指令",

    /* ============================================================
     * 12. 模型选择侧滑面板 (Model Selection Panel)
     * ============================================================ */
    "Model selection": "模型选择",
    "Select primary model": "选择主模型",
    "Select Antigravity agent harness model": "选择 Antigravity Agent 测试架构模型",
    "Model carousel": "模型轮播",
    "Search for a model or agent": "搜索模型或智能体",
    "Clear search query": "清除搜索词",
    "Clear search": "清除搜索",
    "View \"All\" category": "查看“全部”分类",
    "No model matches your search in this category.": "此分类下没有与您的搜索匹配的模型。",
    "No model matches your search.": "没有与您的搜索匹配的模型。",
    "Selected model": "已选模型",
    "Star model": "收藏模型",
    "Unstar model": "取消收藏模型",
    "Starred": "已收藏",
    "Unstarred": "已取消收藏",
    "Featured": "精选",
    "Images": "图片",
    "Video": "视频",
    "Live": "实时流式",
    "Audio": "音频",
    "Music": "音乐",
    "Confidential": "机密计算",
    "Agents": "智能体",
    "All": "全部",
    "Model cannot be configured while session is in progress": "会话进行期间无法配置模型",
    "Knowledge cutoff: ": "知识截止日期：",
    "Knowledge cutoff": "知识截止日期",
    "Release date: ": "发布日期：",
    "Release date": "发布日期",
    "See model card": "查看模型卡",
    "Base: ": "基座：",
    "Model: ": "模型：",
    "Environment: ": "运行环境：",

    /* ============================================================
     * 13. 获取代码面板 (Get Code Dialog)
     * ============================================================ */
    "Open in Colab": "在 Colab 中打开",
    "Download": "下载",
    "API Docs": "API 文档",
    "Developer docs": "开发者文档",
    "Code": "代码",
    "Close": "关闭",
    "Copy": "复制",
    "Cancel": "取消",
    "Delete": "删除",

    /* ============================================================
     * 14. Token 计数与计费说明 (Token & Pricing Tooltips)
     * ============================================================ */
    "Token count": "Token 计数",
    "Token counting": "Token 计数",
    "API pricing per 1M tokens.": "每 100 万 Token 的 API 定价。",
    "API pricing per 1M tokens.\nUsage in AI Studio UI is free of charge when no API key is selected": "每 100 万 Token 的 API 定价。\n未选择 API 密钥时，在 AI Studio 界面中使用完全免费",
    "API pricing per 1M tokens. Audio tokens correspond to 25 tokens per second of audio.\nUsage in AI Studio UI is free of charge when no API key is selected": "每 100 万 Token 的 API 定价。音频 Token 相当于每秒音频消耗 25 个 Token。\n未选择 API 密钥时，在 AI Studio 界面中使用完全免费",
    "API pricing per 1M tokens. Audio tokens correspond to 25 tokens per second of audio. Equivalent to $0.0368 per minute.\nUsage in AI Studio UI is free of charge when no API key is selected": "每 100 万 Token 的 API 定价。音频 Token 相当于每秒音频消耗 25 个 Token，约合每分钟 0.0368 美元。\n未选择 API 密钥时，在 AI Studio 界面中使用完全免费",
    "Video output price is equivalent to $0.10 per second of video (720p)": "视频输出价格相当于每秒视频 0.10 美元（720p）"
  };
  Object.assign(D, PART);
  Object.keys(PART).forEach(function (key) {
    if (!(key in S)) S[key] = 'playground';
  });
})();