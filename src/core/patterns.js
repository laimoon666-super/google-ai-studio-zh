/* ============================================================
 * Google AI Studio 汉化助手 · 内置动态文案规则
 * ------------------------------------------------------------
 * 用途：处理「带变量」的 UI 文案，例如
 *   "Google Account: moon999 (a@b.com)"  -> "Google 账号：moon999 (a@b.com)"
 *   "1,024 tokens"                       -> "1,024 个 Token"
 *   3 minutes ago                        -> "3 分钟前"
 * 规则全部锚定 ^...$，只做整串替换，绝不触碰半句话，避免误伤正文。
 *
 * 数据结构（供设置页读取展示）：
 *   { re: RegExp, to: string | (match, ...groups) => string, note: string, sample: string }
 * 注意：re / to 只在内存中使用，不会被写入 storage 或执行外部代码。
 * ============================================================ */
(function () {
  'use strict';

  const P = (window.__AIZ_PATTERNS__ = window.__AIZ_PATTERNS__ || []);
  const add = (re, to, note, sample) => {
    P.push({ re, to, note, sample });
  };

  /* ---------- 账号 / 身份 ---------- */
  add(/^Google Account:\s*(.+)$/i, 'Google 账号：$1', '账号按钮的无障碍标签', 'Google Account: moon999 (a@b.com)');
  add(/^Account:\s*(.+)$/i, '账号：$1', '账号说明', 'Account: personal');
  add(/^Switch account$/i, '切换账号', '账号切换器', 'Switch account');
  add(/^Signed in as\s+(.+)$/i, '已登录为 $1', '账号状态', 'Signed in as moon999');
  add(/^(.+?)'s (?:Google )?Account$/i, '$1 的 Google 账号', '账号面板标题', "moon999's Account");

  /* ---------- 品牌 / 模型动态标题 ---------- */
  add(/^Unlock\s+(.+)$/, '解锁 $1', '侧边栏升级提示标题', 'Unlock Gemini 4 Argon');
  add(/^Chat with\s+(.+)$/, '与 $1 对话', 'Playground 空态主标题', 'Chat with Gemini 4 Argon');
  add(/^Try\s+(.+)$/, '试试 $1', '推荐位标题', 'Try Gemini 4 Argon');
  add(/^About\s+(.+)$/, '关于 $1', '说明入口', 'About Gemini');

  /* ---------- 计数 / 长度 ---------- */
  add(/^(\d[\d,]*)\s+tokens?$/i, '$1 个 Token', '输入区 Token 计数', '1,024 tokens');
  add(/^(\d[\d,]*)\s+characters?$/i, '$1 个字符', '字符计数', '512 characters');
  add(/^(\d[\d,]*)\s+results?$/i, '$1 个结果', '搜索结果计数', '12 results');
  add(/^(\d[\d,]*)\s+items?$/i, '$1 项', '列表计数', '8 items');
  add(/^Showing\s+(\d[\d,]*)\s+of\s+(\d[\d,]*)$/i, '显示第 $1 项，共 $2 项', '分页信息', 'Showing 20 of 134');
  add(/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+selected$/i, '已选 $1 / $2', '批量选择', '3 / 10 selected');

  /* ---------- 相对时间 ---------- */
  add(/^Just now$/i, '刚刚', '相对时间', 'Just now');
  add(/^(\d+)\s+seconds?\s+ago$/i, '$1 秒前', '相对时间', '30 seconds ago');
  add(/^(\d+)\s+minutes?\s+ago$/i, '$1 分钟前', '相对时间', '5 minutes ago');
  add(/^(\d+)\s+hours?\s+ago$/i, '$1 小时前', '相对时间', '3 hours ago');
  add(/^(\d+)\s+days?\s+ago$/i, '$1 天前', '相对时间', '2 days ago');
  add(/^(\d+)\s+weeks?\s+ago$/i, '$1 周前', '相对时间', '2 weeks ago');
  add(/^(\d+)\s+months?\s+ago$/i, '$1 个月前', '相对时间', '4 months ago');
  add(/^(\d+)\s+years?\s+ago$/i, '$1 年前', '相对时间', '1 year ago');
  add(/^an?\s+second\s+ago$/i, '1 秒前', '相对时间', 'a second ago');
  add(/^an?\s+minute\s+ago$/i, '1 分钟前', '相对时间', 'a minute ago');
  add(/^an?\s+hour\s+ago$/i, '1 小时前', '相对时间', 'an hour ago');
  add(/^an?\s+day\s+ago$/i, '1 天前', '相对时间', 'a day ago');
  add(/^an?\s+week\s+ago$/i, '1 周前', '相对时间', 'a week ago');
  add(/^an?\s+month\s+ago$/i, '1 个月前', '相对时间', 'a month ago');
  add(/^an?\s+year\s+ago$/i, '1 年前', '相对时间', 'a year ago');
  add(/^Edited\s+(.+)$/i, '已编辑 $1', '条目编辑时间', 'Edited 2 days ago');
  add(/^Created\s+(.+)$/i, '创建于 $1', '条目创建时间', 'Created 2 days ago');
  add(/^Updated\s+(.+)$/i, '更新于 $1', '条目更新时间', 'Updated just now');
  add(/^Last used\s+(.+)$/i, '最近使用：$1', '密钥使用时间', 'Last used 3 hours ago');
  add(/^Created at\s+(.+)$/i, '创建于 $1', '表格时间列', 'Created at 2026-10-01');

  /* ---------- 运行状态 ---------- */
  add(/^Loading(\.\.\.|…)?$/i, '加载中…', '加载态', 'Loading...');
  add(/^Thinking(\.\.\.|…)?$/i, '思考中…', '模型思考态', 'Thinking...');
  add(/^Generating(\.\.\.|…)?$/i, '生成中…', '模型生成态', 'Generating...');
  add(/^Running(\.\.\.|…)?$/i, '运行中…', '运行态', 'Running...');
  add(/^Saving(\.\.\.|…)?$/i, '保存中…', '保存态', 'Saving...');
  add(/^Uploading(\.\.\.|…)?$/i, '上传中…', '上传态', 'Uploading...');
  add(/^Processing(\.\.\.|…)?$/i, '处理中…', '处理态', 'Processing...');
  add(/^Please wait(\.\.\.|…)?$/i, '请稍候…', '等待提示', 'Please wait...');
  add(/^Something went wrong\.?$/i, '出错了。', '通用错误', 'Something went wrong.');
  add(/^Failed to load\.?$/i, '加载失败。', '加载失败', 'Failed to load.');
  add(/^No results? found\.?$/i, '未找到结果。', '空态', 'No results found.');
  add(/^No results?\.?$/i, '没有结果。', '空态', 'No results.');

  /* ---------- 搜索 / 快捷键 ---------- */
  add(/^Search\s*\((Ctrl|\u2318)\s*(\/|K)\)$/i, '搜索（$1 $2）', '搜索按钮无障碍标签', 'Search (Ctrl /)');
  add(/^Press\s+(.+)\s+to\s+search$/i, '按 $1 搜索', '搜索快捷键提示', 'Press Ctrl / to search');
  add(/^Search (models|apps|prompts|history|chats|API keys)$/i, '搜索 $1', '搜索框占位符（保留对象）', 'Search models');
  add(/^Filter by\s+(.+)$/i, '按 $1 筛选', '筛选器', 'Filter by model');

  /* ---------- 数量表达 ---------- */
  add(/^(\d[\d,]*)\s+days? left$/i, '剩余 $1 天', '配额到期', '5 days left');
  add(/^(\d[\d,]*)\s+of\s+(\d[\d,]*)$/i, '$1 / $2', '分页', '1 of 12');
  add(/^Page\s+(\d+)$/i, '第 $1 页', '分页', 'Page 2');

  /* ---------- 带引号的确认文案 ---------- */
  add(/^Delete\s+["“](.+)["”]\?$/i, '确定删除“$1”吗？', '删除确认', 'Delete "my app"?');
  add(/^Are you sure you want to delete\s+(.+)\?$/i, '确定要删除$1吗？', '删除确认', 'Are you sure you want to delete this app?');
  add(/^Rename\s+["“](.+)["”]$/i, '重命名“$1”', '重命名', 'Rename "my app"');
  add(/^Share\s+["“](.+)["”]$/i, '分享“$1”', '分享', 'Share "my app"');

  /* ---------- 模型卡片 / 定价 ---------- */
  add(/^Release date:\s*(.+)$/i, '发布日期：$1', '模型卡发布日期', 'Release date: Oct 14, 2026');
  add(/^Knowledge cutoff:\s*(.+)$/i, '知识截止日期：$1', '模型卡知识截止日期', 'Knowledge cutoff: Jul 2026');
  add(/^All context lengths$/i, '全部上下文长度', '模型卡上下文标注', 'All context lengths');
  add(
    /^All context lengths\s*[•·]\s*Input:\s*(.+?)\s*\/\s*Output:\s*(.+?)(?:\s+through\s+(.+))?$/i,
    function (match, input, output, through) {
      return '全部上下文长度 · 输入：' + input.trim() + ' / 输出：' + output.trim() +
        (through ? '（优惠至 ' + through.trim() + '）' : '');
    },
    '模型卡定价行（带优惠期）',
    'All context lengths • Input: $2.00 / Output: $10.00 through November 30, 2026'
  );
  add(
    /^(Text|Image|Video|Audio)\s+in\s*\/\s*(Text|Image|Video|Audio)\s+out\s*[•·]?\s*Input:\s*(.+?)\s*\/\s*Output:\s*(.+)$/i,
    function (match, mi, mo, input, output) {
      var map = { text: '文本', image: '图片', video: '视频', audio: '音频' };
      var a = map[String(mi).toLowerCase()] || mi;
      var b = map[String(mo).toLowerCase()] || mo;
      return a + '输入 / ' + b + '输出 · 输入：' + input.trim() + ' / 输出：' + output.trim();
    },
    '模型卡多模态定价行',
    'Text in / Audio out • Input: $0.50 / Output: $9.00'
  );

  /* ---------- 页面标题 ---------- */
  add(/^(.+?)\s*[-–—|]\s*Google AI Studio$/i, '$1 - Google AI Studio', '浏览器标签标题（翻译前缀）', 'Playground - Google AI Studio');

  /* ---------- API 密钥 / 配额 ---------- */
  add(/^Ending in\s+(\w+)$/i, '末尾为 $1', '密钥标识', 'Ending in a1b2');
  add(/^(\d[\d,]*)\s+requests? per (minute|day)$/i, '每分钟 $1 次请求', '速率限制', '60 requests per minute');
  add(/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+used$/i, '已用 $1 / $2', '配额用量', '120 / 1000 used');

  /* ---------- 通用动态短语 ---------- */
  add(/^Show\s+(\d+)\s+more$/i, '再显示 $1 条', '展开更多', 'Show 10 more');
  add(/^See\s+all\s+(\d+)$/i, '查看全部 $1 条', '查看全部', 'See all 24');
  add(/^View\s+all\s+(\d+)$/i, '查看全部 $1 条', '查看全部', 'View all 12');
  add(/^Add\s+(.+)\s+to\s+(?:the\s+)?prompt$/i, '将$1添加到提示词', '添加附件', 'Add image to prompt');
  add(/^Remove\s+(.+)$/i, '移除$1', '移除标签', 'Remove Grounding with Google Search');
  add(/^Open\s+(.+)$/i, '打开$1', '打开入口', 'Open settings');
  add(/^Copy\s+(.+)$/i, '复制$1', '复制动作', 'Copy code');
  add(/^Download\s+(.+)$/i, '下载$1', '下载动作', 'Download CSV');
  add(/^Go to\s+(.+)$/i, '前往$1', '跳转', 'Go to Dashboard');
  add(/^Back to\s+(.+)$/i, '返回$1', '返回', 'Back to Playground');
  add(/^Manage\s+(.+)$/i, '管理$1', '管理入口', 'Manage API keys');
})();
