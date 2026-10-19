/* ==========================================================================
   options 设置页逻辑
   --------------------------------------------------------------------------
   - 七个分区：常规 / 词典管理 / 排除规则 / 动态规则 / 未汉化收集 / 数据与备份 / 关于
   - 数据入口统一走 AIZ.Store（默认值与 CONTRACT §4 一致）
   - 内置词典读 window.__AIZ_DICT__，内置动态规则读 window.__AIZ_PATTERNS__
     （两者由 options.html 中 defer 加载的 dict/*.js、core/patterns.js 提供）
   - 所有拼进 innerHTML 的用户数据都经过 AIZ.esc()
   ========================================================================== */

(function () {
  'use strict';

  const AIZ = globalThis.AIZ;
  if (!AIZ) return;

  const { Store, esc, toast, download, copyText, formatRelative, prettyBytes, byteLength } = AIZ;
  const confirmDialog = AIZ.confirm;
  const promptDialog = AIZ.prompt;
  const choiceDialog = AIZ.choice;

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  /* ------------------------------------------------------------------------
     常量
     ---------------------------------------------------------------------- */

  const SECTIONS = ['general', 'dict', 'exclude', 'patterns', 'unmatched', 'backup', 'about'];
  const SECTION_TITLES = {
    general: '常规',
    dict: '词典管理',
    exclude: '排除规则',
    patterns: '动态规则',
    unmatched: '未汉化收集',
    backup: '数据与备份',
    about: '关于'
  };
  const PER_PAGE = 30;
  const UNMATCHED_PER_PAGE = 40;

  const GENERAL_LABELS = {
    enabled: '汉化',
    forceEnglish: '强制英文界面',
    highlight: '译文高亮',
    hoverOriginal: '悬停看原文',
    translateAttrs: '属性文案翻译',
    collectUnmatched: '未汉化收集'
  };

  const BUILTIN_EXCLUDES = [
    { q: 'mat-icon', note: 'Material 图标连字' },
    { q: '.material-symbols-outlined', note: 'Material Symbols 图标' },
    { q: '.material-icons', note: '经典 Material 图标' },
    { q: '.notranslate', note: '显式标记不翻译' },
    { q: 'code', note: '行内代码' },
    { q: 'pre', note: '代码块' },
    { q: 'kbd', note: '键盘按键' },
    { q: 'samp', note: '示例输出' },
    { q: 'script', note: '脚本内容' },
    { q: 'style', note: '样式内容' },
    { q: '[contenteditable]', note: '可编辑区域' },
    { q: '.monaco-editor', note: 'Monaco 编辑器' },
    { q: '.markdown-body', note: 'Markdown 渲染区' },
    { q: 'ms-chat-turn', note: '聊天消息富文本' },
    { q: '[translate="no"]', note: 'HTML 翻译屏蔽标记' },
    { q: '.aiz-skip', note: '插件自身跳过标记' }
  ];

  const GLOSSARY = [
    ['Playground', '对话实验室', '侧边栏主入口'],
    ['prompt', '提示词', '不译作「提示」'],
    ['System instructions', '系统指令', '与 Google 官方一致'],
    ['Run settings', '运行设置', ''],
    ['Thinking level / budget', '思考等级 / 思考预算', ''],
    ['Structured outputs', '结构化输出', ''],
    ['Code execution', '代码执行', ''],
    ['Function calling', '函数调用', ''],
    ['Grounding / Grounded', '接地 / 已接地', 'Google 官方译法'],
    ['URL context', 'URL 上下文', ''],
    ['Token', 'Token', '不译'],
    ['New app / My apps', '新建应用 / 我的应用', ''],
    ['Gallery', '应用广场', '侧边栏 Gallery'],
    ['History', '历史记录', '路由 /library'],
    ['Dashboard', '控制台', '路由 /api-keys'],
    ['API key', 'API 密钥', ''],
    ['Advanced settings', '高级设置', ''],
    ['credits', '赠金 / 额度', 'API credits → API 赠金']
  ];

  /* ------------------------------------------------------------------------
     状态
     ---------------------------------------------------------------------- */

  const state = {
    settings: AIZ.normalizeSettings(null),
    customDict: {},
    unmatched: {},
    stats: { translated: 0, at: 0, url: '' },
    meta: { version: AIZ.version, dictCount: null },
    builtin: [],
    builtinPatterns: [],
    snapshotVolume: {},
    dict: { q: '', source: 'all', page: 1, editing: null },
    rules: { editing: null },
    patterns: { editing: null },
    unmatchedView: { q: '', page: 1, selected: new Set() }
  };

  let saveTimer = null;

  /* ------------------------------------------------------------------------
     通用 UI 小工具
     ---------------------------------------------------------------------- */

  function showFormError(selector, message) {
    const el = $(selector);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function setInvalid(input, invalid) {
    if (!input) return;
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function markSaving() {
    const wrap = $('#saveState');
    if (!wrap) return;
    wrap.classList.add('is-saving');
    wrap.classList.remove('is-error');
    const text = $('#saveStateText');
    if (text) text.textContent = '正在保存…';
  }

  function markSaved(failed) {
    const wrap = $('#saveState');
    if (!wrap) return;
    wrap.classList.remove('is-saving');
    wrap.classList.toggle('is-error', Boolean(failed));
    const text = $('#saveStateText');
    if (text) text.textContent = failed ? '保存失败' : '设置自动保存';
    clearTimeout(saveTimer);
    if (failed) {
      saveTimer = setTimeout(() => {
        wrap.classList.remove('is-error');
        if (text) text.textContent = '设置自动保存';
      }, 2400);
    }
  }

  async function persistSettings(patch, options) {
    const opts = options || {};
    markSaving();
    try {
      state.settings = await Store.setSettings(patch);
      markSaved(false);
      if (!opts.silent) toast(opts.message || '设置已保存', 'success');
      return true;
    } catch (err) {
      markSaved(true);
      toast('保存失败：' + (err && err.message ? err.message : err), 'error');
      return false;
    }
  }

  function normalizeEn(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function builtinCount() {
    if (state.builtin.length) return state.builtin.length;
    const metaCount = state.meta ? Number(state.meta.dictCount) : NaN;
    return Number.isFinite(metaCount) && metaCount > 0 ? metaCount : 0;
  }

  function volumeLabel(volume, source) {
    if (source === 'custom') return '自定义（本地）';
    if (volume && AIZ.VOLUME_LABELS && AIZ.VOLUME_LABELS[volume]) {
      return AIZ.VOLUME_LABELS[volume];
    }
    return '内置词典';
  }

  function selectorInfo(selector) {
    try {
      const nodes = document.querySelectorAll(selector);
      return { valid: true, count: nodes.length, error: '' };
    } catch (err) {
      return { valid: false, count: 0, error: (err && err.message) || '语法错误' };
    }
  }

  function compilePattern(re, flags) {
    const source = String(re || '');
    const flagText = String(flags || '').trim();
    if (!source) return { error: '请填写正则表达式' };
    if (!/^[gimsuy]*$/.test(flagText)) return { error: 'flags 只能包含 g i m s u y' };
    try {
      return { regex: new RegExp(source, flagText) };
    } catch (err) {
      return { error: (err && err.message) || '正则语法错误' };
    }
  }

  /* ------------------------------------------------------------------------
     内置词典 / 内置正则的读取
     ---------------------------------------------------------------------- */

  function readBuiltinDict() {
    const raw = globalThis.__AIZ_DICT__;
    if (!raw || typeof raw !== 'object') return [];
    const volumeMap = state.snapshotVolume || {};
    const entries = [];
    Object.keys(raw).forEach((key) => {
      const zh = raw[key];
      if (typeof key !== 'string' || typeof zh !== 'string') return;
      const en = key.trim();
      const value = zh.trim();
      if (!en || !value) return;
      entries.push({ en, zh: value, volume: volumeMap[en] || 'builtin' });
    });
    entries.sort((a, b) => a.en.localeCompare(b.en, 'en'));
    return entries;
  }

  function readBuiltinPatterns() {
    const raw = Array.isArray(globalThis.__AIZ_PATTERNS__) ? globalThis.__AIZ_PATTERNS__ : [];
    const out = [];
    raw.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      let regex = item.re;
      if (!(regex instanceof RegExp)) {
        if (typeof regex === 'string' && regex) {
          try {
            regex = new RegExp(regex, typeof item.flags === 'string' ? item.flags : 'g');
          } catch (err) {
            return;
          }
        } else {
          return;
        }
      }
      out.push({
        id: 'builtin-' + index,
        source: regex.source,
        flags: regex.flags,
        to: typeof item.to === 'function' ? '（动态函数）' : typeof item.to === 'string' ? item.to : '',
        isFn: typeof item.to === 'function',
        note: typeof item.note === 'string' ? item.note : '',
        sample: typeof item.sample === 'string' ? item.sample : ''
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------------
     加载 + 渲染总入口
     ---------------------------------------------------------------------- */

  async function reload() {
    const results = await Promise.allSettled([
      Store.getSettings(),
      Store.getCustomDict(),
      Store.getUnmatched(),
      Store.getStats(),
      AIZ.getMeta()
    ]);

    state.settings =
      results[0].status === 'fulfilled' ? results[0].value : AIZ.normalizeSettings(null);
    state.customDict = results[1].status === 'fulfilled' ? results[1].value : {};
    state.unmatched = results[2].status === 'fulfilled' ? results[2].value : {};
    state.stats =
      results[3].status === 'fulfilled' ? results[3].value : { translated: 0, at: 0, url: '' };
    state.meta =
      results[4].status === 'fulfilled'
        ? results[4].value
        : { version: AIZ.version, dictCount: null };

    // 可选：向后台请求只读快照，仅用于补齐内置词条的分卷信息
    try {
      const snapshot = await AIZ.getSnapshot();
      if (snapshot && Array.isArray(snapshot.dict)) {
        const map = {};
        snapshot.dict.forEach((entry) => {
          if (entry && typeof entry.en === 'string') {
            map[entry.en] = entry.volume || 'builtin';
          }
        });
        state.snapshotVolume = map;
      }
    } catch (err) {
      /* 后台未实现该消息时静默降级 */
    }

    state.builtin = readBuiltinDict();
    state.builtinPatterns = readBuiltinPatterns();
    renderAll();
  }

  function renderAll() {
    renderGeneral();
    renderDict();
    renderExclude();
    renderPatterns();
    renderUnmatched();
    renderBackup();
    renderAbout();
    renderNavCounts();
  }

  /* ------------------------------------------------------------------------
     常规
     ---------------------------------------------------------------------- */

  function setQuickToggle(enabled) {
    const button = $('#quickToggle');
    if (!button) return;
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('is-off', !enabled);
    const label = $('#quickToggleLabel');
    if (label) label.textContent = enabled ? '汉化已启用' : '汉化已暂停';
  }

  function syncSettingUi(key) {
    const value = Boolean(state.settings[key]);
    $$('#sec-general [data-key="' + key + '"]').forEach((button) => {
      button.setAttribute('aria-checked', value ? 'true' : 'false');
    });
    if (key === 'enabled') setQuickToggle(value);
  }

  function renderGeneral() {
    Object.keys(GENERAL_LABELS).forEach((key) => syncSettingUi(key));
  }

  async function toggleSettingKey(key, button) {
    if (!button) return;
    const next = !state.settings[key];
    state.settings[key] = next;
    syncSettingUi(key);

    const saved = await persistSettings({ [key]: next }, { silent: true });
    if (!saved) {
      state.settings[key] = !next;
      syncSettingUi(key);
      return;
    }

    if (key === 'forceEnglish') {
      toast(
        next ? '已开启强制英文界面，刷新 AI Studio 页面后生效' : '已关闭强制英文界面，刷新页面后恢复',
        'success'
      );
      return;
    }
    const label = GENERAL_LABELS[key] || '设置';
    toast(label + (next ? '已开启' : '已关闭'), 'success');
  }

  async function resetSettings() {
    const ok = await confirmDialog({
      title: '恢复默认设置？',
      message: '六个开关、排除规则与动态规则会恢复默认值；自定义词典与未汉化记录会保留。',
      okText: '恢复默认',
      danger: true
    });
    if (!ok) return;
    markSaving();
    try {
      state.settings = await Store.setSettings(AIZ.DEFAULT_SETTINGS);
      markSaved(false);
      renderAll();
      toast('已恢复默认设置', 'success');
    } catch (err) {
      markSaved(true);
      toast('恢复失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function bindGeneral() {
    $$('#sec-general [data-key]').forEach((button) => {
      button.addEventListener('click', () => toggleSettingKey(button.dataset.key, button));
    });
    const quick = $('#quickToggle');
    if (quick) {
      quick.addEventListener('click', () => toggleSettingKey('enabled', quick));
    }
    const reset = $('#btnResetSettings');
    if (reset) reset.addEventListener('click', resetSettings);
  }

  /* ------------------------------------------------------------------------
     词典管理
     ---------------------------------------------------------------------- */

  function buildDictRows() {
    const rows = [];
    const builtinMap = new Map();
    state.builtin.forEach((entry) => builtinMap.set(entry.en, entry));

    Object.keys(state.customDict).forEach((en) => {
      rows.push({
        en,
        zh: state.customDict[en],
        source: 'custom',
        volume: 'custom',
        override: builtinMap.has(en)
      });
    });

    state.builtin.forEach((entry) => {
      if (Object.prototype.hasOwnProperty.call(state.customDict, entry.en)) return;
      rows.push({
        en: entry.en,
        zh: entry.zh,
        source: 'builtin',
        volume: entry.volume || 'builtin',
        override: false
      });
    });

    rows.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'custom' ? -1 : 1;
      return a.en.localeCompare(b.en, 'en');
    });
    return rows;
  }

  function filteredDictRows() {
    const q = state.dict.q.trim().toLowerCase();
    return buildDictRows().filter((row) => {
      if (state.dict.source !== 'all' && row.source !== state.dict.source) return false;
      if (!q) return true;
      return row.en.toLowerCase().indexOf(q) !== -1 || row.zh.toLowerCase().indexOf(q) !== -1;
    });
  }

  function rowTemplate(row) {
    const isCustom = row.source === 'custom';
    const sourceBadge = isCustom
      ? '<span class="aiz-badge aiz-badge--primary">自定义</span>' +
        (row.override ? ' <span class="aiz-badge aiz-badge--warn">覆盖内置</span>' : '')
      : '<span class="aiz-badge aiz-badge--muted">内置</span>';
    return (
      '<tr data-en="' + esc(row.en) + '" data-source="' + row.source + '">' +
      '<td class="o-cell-en"><code class="o-en">' + esc(row.en) + '</code></td>' +
      '<td class="o-cell-zh">' + esc(row.zh) + '</td>' +
      '<td>' + sourceBadge + '</td>' +
      '<td class="o-cell-volume">' + esc(volumeLabel(row.volume, row.source)) + '</td>' +
      '<td class="aiz-table__actions o-cell-actions">' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--text" type="button" data-act="edit">编辑</button>' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--text" type="button" data-act="volume">分卷</button>' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--danger-text" type="button" data-act="delete"' +
      (isCustom ? '' : ' disabled title="内置词条不可删除"') +
      '>删除</button>' +
      '</td>' +
      '</tr>'
    );
  }

  function rowEditTemplate(row) {
    return (
      '<tr class="o-row-editing" data-en="' + esc(row.en) + '" data-source="' + row.source + '">' +
      '<td><input class="aiz-input aiz-input--cell aiz-input--mono" data-field="en" value="' +
      esc(row.en) + '" aria-label="英文原文" spellcheck="false" /></td>' +
      '<td><input class="aiz-input aiz-input--cell" data-field="zh" value="' +
      esc(row.zh) + '" aria-label="中文译文" /></td>' +
      '<td>' +
      (row.source === 'builtin'
        ? '<span class="aiz-badge aiz-badge--warn">保存为自定义</span>'
        : '<span class="aiz-badge aiz-badge--primary">自定义</span>') +
      '</td>' +
      '<td class="o-cell-volume">' + esc(volumeLabel(row.volume, row.source)) + '</td>' +
      '<td class="aiz-table__actions o-cell-actions">' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--primary" type="button" data-act="save">保存</button>' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--ghost" type="button" data-act="cancel">取消</button>' +
      '</td>' +
      '</tr>'
    );
  }

  function renderDict() {
    const rows = filteredDictRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (state.dict.page > totalPages) state.dict.page = totalPages;
    if (state.dict.page < 1) state.dict.page = 1;
    const start = (state.dict.page - 1) * PER_PAGE;
    const pageRows = rows.slice(start, start + PER_PAGE);

    const body = $('#dictBody');
    const wrap = $('#dictTableWrap');
    const empty = $('#dictEmpty');
    if (!body || !wrap || !empty) return;

    const editing = state.dict.editing;
    body.innerHTML = pageRows
      .map((row) => {
        if (editing && editing.en === row.en && editing.source === row.source) {
          return rowEditTemplate(row);
        }
        return rowTemplate(row);
      })
      .join('');

    const hasRows = rows.length > 0;
    wrap.hidden = !hasRows;
    empty.hidden = hasRows;

    const pageInfo = $('#dictPageInfo');
    if (pageInfo) {
      pageInfo.textContent = hasRows
        ? '第 ' + state.dict.page + ' / ' + totalPages + ' 页 · 共 ' + rows.length + ' 条'
        : '共 0 条';
    }
    const prev = $('#dictPrev');
    const next = $('#dictNext');
    if (prev) prev.disabled = state.dict.page <= 1;
    if (next) next.disabled = state.dict.page >= totalPages;

    const statBuiltin = $('#statBuiltin');
    if (statBuiltin) statBuiltin.textContent = builtinCount() ? String(builtinCount()) : '—';
    const statBuiltinHint = $('#statBuiltinHint');
    if (statBuiltinHint) {
      statBuiltinHint.textContent = state.builtin.length
        ? '已从词典分卷读取'
        : '后台未提供词条快照';
    }
    const statCustom = $('#statCustom');
    if (statCustom) statCustom.textContent = String(Object.keys(state.customDict).length);
    const statFiltered = $('#statFiltered');
    if (statFiltered) statFiltered.textContent = String(rows.length);
    const statFilteredHint = $('#statFilteredHint');
    if (statFilteredHint) {
      statFilteredHint.textContent =
        state.dict.source === 'all'
          ? '全部来源'
          : state.dict.source === 'custom'
            ? '仅自定义'
            : '仅内置';
    }
    const dictState = $('#statDictState');
    if (dictState) dictState.textContent = state.builtin.length ? '已加载' : '仅自定义';
    const dictStateHint = $('#statDictStateHint');
    if (dictStateHint) {
      dictStateHint.textContent = state.builtin.length
        ? state.builtin.length + ' 条内置词条可搜索'
        : '词典脚本未就绪，不影响自定义词条';
    }

    const note = $('#dictSnapshotNote');
    if (note) {
      if (state.builtin.length) {
        note.hidden = true;
        note.textContent = '';
      } else {
        note.hidden = false;
        note.textContent =
          '未读取到内置词典（window.__AIZ_DICT__ 为空）：内置词条暂不可搜索，自定义词条功能不受影响。';
      }
    }
  }

  function findDictRow(en, source) {
    return buildDictRows().find((row) => row.en === en && row.source === source) || null;
  }

  function validateEntry(en, zh, context) {
    if (!en) return '请填写英文原文';
    if (!zh) return '请填写中文译文';
    if (en.length > 120) return '英文原文过长（最多 120 个字符）';
    if (zh.length > 200) return '中文译文过长（最多 200 个字符）';
    if (/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(en)) {
      return '英文原文不能包含中文或全角标点';
    }
    const duplicate = Object.prototype.hasOwnProperty.call(state.customDict, en);
    const isSelf =
      context && context.source === 'custom' && context.originalEn === en;
    if (duplicate && !isSelf) {
      return '自定义词典中已存在「' + en + '」，请直接编辑该词条';
    }
    return '';
  }

  function toggleDictForm(show) {
    const form = $('#dictForm');
    if (!form) return;
    form.hidden = !show;
    if (show) {
      const en = $('#dictEn');
      if (en) en.focus();
      return;
    }
    showFormError('#dictFormError', '');
    const en = $('#dictEn');
    const zh = $('#dictZh');
    if (en) {
      en.value = '';
      setInvalid(en, false);
    }
    if (zh) {
      zh.value = '';
      setInvalid(zh, false);
    }
  }

  async function addDictEntry(event) {
    event.preventDefault();
    const enInput = $('#dictEn');
    const zhInput = $('#dictZh');
    const en = normalizeEn(enInput.value);
    const zh = zhInput.value.trim();
    showFormError('#dictFormError', '');
    setInvalid(enInput, false);
    setInvalid(zhInput, false);

    const error = validateEntry(en, zh, null);
    if (error) {
      showFormError('#dictFormError', error);
      setInvalid(enInput, !en || /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(en));
      setInvalid(zhInput, !zh);
      return;
    }

    const next = Object.assign({}, state.customDict);
    next[en] = zh;
    try {
      state.customDict = await Store.setCustomDict(next);
      const isOverride = state.builtin.some((entry) => entry.en === en);
      state.dict.page = 1;
      state.dict.q = '';
      const search = $('#dictSearch');
      if (search) search.value = '';
      toggleDictForm(false);
      renderAll();
      toast(isOverride ? '已新增自定义词条，覆盖内置译法' : '已新增词条：' + en + ' → ' + zh, 'success');
    } catch (err) {
      showFormError('#dictFormError', '保存失败：' + (err && err.message ? err.message : err));
    }
  }

  async function saveDictEdit(tr) {
    if (!tr) return;
    const original = { en: tr.dataset.en, source: tr.dataset.source };
    const enInput = tr.querySelector('[data-field="en"]');
    const zhInput = tr.querySelector('[data-field="zh"]');
    if (!enInput || !zhInput) return;
    const en = normalizeEn(enInput.value);
    const zh = zhInput.value.trim();

    const error = validateEntry(en, zh, { source: original.source, originalEn: original.en });
    if (error) {
      toast(error, 'error');
      setInvalid(enInput, true);
      return;
    }

    const next = Object.assign({}, state.customDict);
    if (original.source === 'custom' && original.en !== en) {
      delete next[original.en];
    }
    next[en] = zh;
    try {
      state.customDict = await Store.setCustomDict(next);
      state.dict.editing = null;
      renderAll();
      toast(
        original.source === 'builtin'
          ? '已新增自定义词条覆盖内置词条'
          : '词条已保存',
        'success'
      );
    } catch (err) {
      toast('保存失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function deleteDictEntry(en, source) {
    if (source !== 'custom') {
      toast('内置词条不可删除，可新增同名自定义词条覆盖', 'warn');
      return;
    }
    const ok = await confirmDialog({
      title: '删除自定义词条？',
      message: '「' + en + '」将从 aiz.customDict 中移除，页面刷新后恢复内置译法。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const next = Object.assign({}, state.customDict);
    delete next[en];
    try {
      state.customDict = await Store.setCustomDict(next);
      state.dict.editing = null;
      renderAll();
      toast('已删除词条', 'success');
    } catch (err) {
      toast('删除失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function buildVolumeBody(row) {
    const wrap = document.createElement('div');
    wrap.className = 'o-modal-kv';
    const pairs = [
      ['英文原文', row.en],
      ['中文译文', row.zh],
      ['来源', row.source === 'custom' ? '自定义（本地）' : '内置词典'],
      ['分卷', volumeLabel(row.volume, row.source)],
      ['存储位置', row.source === 'custom' ? 'aiz.customDict' : 'window.__AIZ_DICT__']
    ];
    pairs.forEach(([key, value]) => {
      const line = document.createElement('div');
      line.className = 'o-modal-kv__row';
      const label = document.createElement('span');
      label.textContent = key;
      const content = document.createElement('code');
      content.textContent = value;
      line.appendChild(label);
      line.appendChild(content);
      wrap.appendChild(line);
    });
    if (row.source === 'builtin' && !state.snapshotVolume[row.en]) {
      const note = document.createElement('p');
      note.className = 'aiz-modal__note';
      note.textContent =
        '内置词典由 _common.js / playground.js / build.js / manage.js 四个分卷在加载时合并到同一个对象，运行时只能读到合并结果，因此无法精确回指分卷文件。';
      wrap.appendChild(note);
    }
    return wrap;
  }

  function showVolume(row) {
    if (!row) return;
    AIZ.openModal({
      title: '词条分卷',
      message:
        row.source === 'custom'
          ? '自定义词条保存在本地 aiz.customDict 中，优先级高于内置词典。'
          : '内置词条在运行时由各分卷脚本合并到 window.__AIZ_DICT__。',
      body: buildVolumeBody(row),
      cancelValue: null,
      actions: [{ label: '关闭', className: 'aiz-btn--primary', value: null, autofocus: true }]
    });
  }

  async function onDictAction(event) {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const tr = button.closest('tr');
    if (!tr) return;
    const en = tr.dataset.en;
    const source = tr.dataset.source;
    const act = button.dataset.act;

    if (act === 'edit') {
      state.dict.editing = { en, source };
      renderDict();
      const input = $('#dictBody tr.o-row-editing [data-field="en"]');
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    if (act === 'cancel') {
      state.dict.editing = null;
      renderDict();
      return;
    }
    if (act === 'save') {
      await saveDictEdit(tr);
      return;
    }
    if (act === 'volume') {
      showVolume(findDictRow(en, source));
      return;
    }
    if (act === 'delete') {
      await deleteDictEntry(en, source);
    }
  }

  function onDictKeydown(event) {
    if (!event.target.matches('[data-field]')) return;
    const tr = event.target.closest('tr.o-row-editing');
    if (!tr) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      saveDictEdit(tr);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      state.dict.editing = null;
      renderDict();
    }
  }

  function extractDict(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('文件内容不是 JSON 对象');
    }
    const source =
      parsed.dict && typeof parsed.dict === 'object' && !Array.isArray(parsed.dict)
        ? parsed.dict
        : parsed;
    const out = {};
    let skipped = 0;
    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (typeof key !== 'string' || typeof value !== 'string') {
        skipped += 1;
        return;
      }
      const en = normalizeEn(key);
      const zh = value.trim();
      if (!en || !zh) {
        skipped += 1;
        return;
      }
      out[en] = zh;
    });
    return { dict: out, skipped };
  }

  function exportDict() {
    const count = Object.keys(state.customDict).length;
    if (!count) {
      toast('还没有自定义词条可导出', 'warn');
      return;
    }
    const payload = {
      name: 'google-ai-studio-zh',
      kind: 'dict',
      schema: AIZ.schema,
      version: state.meta.version || AIZ.version,
      exportedAt: new Date().toISOString(),
      count,
      dict: state.customDict
    };
    download('aiz-dict-' + AIZ.stamp() + '.json', JSON.stringify(payload, null, 2));
    toast('已导出 ' + count + ' 条自定义词条', 'success');
  }

  async function importDictFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await AIZ.readFileText(file);
      const parsed = JSON.parse(text);
      const extracted = extractDict(parsed);
      const keys = Object.keys(extracted.dict);
      if (!keys.length) throw new Error('文件中没有可导入的字符串词条');

      const conflicts = keys.filter(
        (en) =>
          Object.prototype.hasOwnProperty.call(state.customDict, en) &&
          state.customDict[en] !== extracted.dict[en]
      );

      let strategy = 'merge';
      if (conflicts.length) {
        const picked = await choiceDialog({
          title: '发现 ' + conflicts.length + ' 条冲突词条',
          message: '这些英文原文已存在于自定义词典中，但译文不同。请选择处理方式：',
          choices: [
            { label: '以导入为准', description: '用文件中的译文覆盖现有自定义词条', value: 'import', primary: true },
            { label: '保留现有', description: '仅导入新增词条，跳过冲突项', value: 'keep' }
          ],
          cancelText: '取消导入'
        });
        if (!picked) return;
        strategy = String(picked);
      }

      const next = Object.assign({}, state.customDict);
      let added = 0;
      let updated = 0;
      let skipped = 0;
      keys.forEach((en) => {
        const zh = extracted.dict[en];
        const exists = Object.prototype.hasOwnProperty.call(next, en);
        if (exists && next[en] !== zh) {
          if (strategy === 'keep') {
            skipped += 1;
            return;
          }
          updated += 1;
        } else if (!exists) {
          added += 1;
        }
        next[en] = zh;
      });

      state.customDict = await Store.setCustomDict(next);
      state.dict.page = 1;
      state.dict.q = '';
      const search = $('#dictSearch');
      if (search) search.value = '';
      renderAll();
      toast(
        '导入完成：新增 ' + added + ' 条，更新 ' + updated + ' 条' + (skipped ? '，跳过 ' + skipped + ' 条' : ''),
        'success'
      );
    } catch (err) {
      toast('导入失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function bindDict() {
    const search = $('#dictSearch');
    if (search) {
      search.addEventListener(
        'input',
        AIZ.debounce((event) => {
          state.dict.q = event.target.value;
          state.dict.page = 1;
          state.dict.editing = null;
          renderDict();
        }, 120)
      );
    }

    $$('#sec-dict .o-seg__item').forEach((button) => {
      button.addEventListener('click', () => {
        state.dict.source = button.dataset.source;
        state.dict.page = 1;
        state.dict.editing = null;
        $$('#sec-dict .o-seg__item').forEach((item) => {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        renderDict();
      });
    });

    const add = $('#btnAddDict');
    if (add) add.addEventListener('click', () => toggleDictForm(true));
    const cancel = $('#dictFormCancel');
    if (cancel) cancel.addEventListener('click', () => toggleDictForm(false));
    const form = $('#dictForm');
    if (form) form.addEventListener('submit', addDictEntry);

    const body = $('#dictBody');
    if (body) {
      body.addEventListener('click', onDictAction);
      body.addEventListener('keydown', onDictKeydown);
    }

    const prev = $('#dictPrev');
    if (prev) {
      prev.addEventListener('click', () => {
        state.dict.page -= 1;
        renderDict();
      });
    }
    const next = $('#dictNext');
    if (next) {
      next.addEventListener('click', () => {
        state.dict.page += 1;
        renderDict();
      });
    }

    const exportBtn = $('#btnExportDict');
    if (exportBtn) exportBtn.addEventListener('click', exportDict);
    const importBtn = $('#btnImportDict');
    if (importBtn) importBtn.addEventListener('click', () => $('#dictFile').click());
    const file = $('#dictFile');
    if (file) file.addEventListener('change', importDictFile);
  }

  /* ------------------------------------------------------------------------
     排除规则
     ---------------------------------------------------------------------- */

  function renderBuiltinRules() {
    const container = $('#builtinRules');
    if (!container) return;
    container.innerHTML = BUILTIN_EXCLUDES.map(
      (item) =>
        '<span class="aiz-chip" title="' + esc(item.note) + '">' +
        '<code>' + esc(item.q) + '</code>' +
        '<span class="aiz-badge aiz-badge--muted">内置</span>' +
        '</span>'
    ).join('');
    const count = $('#builtinRuleCount');
    if (count) count.textContent = String(BUILTIN_EXCLUDES.length);
  }

  function previewSelector(value) {
    const preview = $('#rulePreview');
    if (!preview) return;
    const raw = String(value || '').trim();
    if (!raw) {
      preview.textContent = '输入选择器可实时预览它在本设置页命中的元素数量。';
      return;
    }
    const info = selectorInfo(raw);
    if (!info.valid) {
      preview.innerHTML =
        '<span class="o-danger-text">语法错误：' + esc(info.error) + '</span>';
      return;
    }
    preview.innerHTML =
      '本页预览：匹配 <b>' + info.count + '</b> 个元素' +
      (info.count === 0 ? '（AI Studio 页面上的结果可能不同）' : '');
  }

  function renderExclude() {
    const rules = state.settings.extraSkipSelectors || [];
    const count = $('#customRuleCount');
    if (count) count.textContent = String(rules.length);

    const list = $('#customRules');
    const empty = $('#rulesEmpty');
    if (!list || !empty) return;

    if (!rules.length) {
      list.innerHTML = '';
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    list.hidden = false;
    empty.hidden = true;

    list.innerHTML = rules
      .map((rule, index) => {
        if (state.rules.editing === index) {
          return (
            '<li class="o-rule" data-index="' + index + '">' +
            '<input class="aiz-input aiz-input--mono o-rule__input" data-field="rule" value="' +
            esc(rule) + '" aria-label="编辑选择器" />' +
            '<button class="aiz-btn aiz-btn--sm aiz-btn--primary" type="button" data-rule-act="save">保存</button>' +
            '<button class="aiz-btn aiz-btn--sm aiz-btn--ghost" type="button" data-rule-act="cancel">取消</button>' +
            '</li>'
          );
        }
        const info = selectorInfo(rule);
        return (
          '<li class="o-rule" data-index="' + index + '">' +
          '<code class="o-rule__selector">' + esc(rule) + '</code>' +
          '<span class="aiz-badge ' + (info.valid ? 'aiz-badge--ok' : 'aiz-badge--danger') + '">' +
          (info.valid ? '本页 ' + info.count + ' 项' : '语法错误') +
          '</span>' +
          '<div class="o-rule__actions">' +
          '<button class="aiz-btn aiz-btn--sm aiz-btn--text" type="button" data-rule-act="edit">编辑</button>' +
          '<button class="aiz-btn aiz-btn--sm aiz-btn--danger-text" type="button" data-rule-act="delete">删除</button>' +
          '</div>' +
          '</li>'
        );
      })
      .join('');
  }

  async function saveRule(index, value) {
    const rules = (state.settings.extraSkipSelectors || []).slice();
    const selector = String(value || '').trim();
    if (!selector) {
      toast('选择器不能为空', 'error');
      return;
    }
    const info = selectorInfo(selector);
    if (!info.valid) {
      toast('选择器语法错误：' + info.error, 'error');
      return;
    }
    if (rules.some((item, i) => i !== index && item === selector)) {
      toast('该选择器已存在', 'error');
      return;
    }
    rules[index] = selector;
    const saved = await persistSettings({ extraSkipSelectors: rules }, { silent: true });
    if (!saved) return;
    state.rules.editing = null;
    renderExclude();
    toast('选择器已保存', 'success');
  }

  async function addRule(event) {
    event.preventDefault();
    const input = $('#ruleInput');
    const value = String(input.value || '').trim();
    showFormError('#ruleError', '');
    if (!value) {
      showFormError('#ruleError', '请输入 CSS 选择器');
      input.focus();
      return;
    }
    const info = selectorInfo(value);
    if (!info.valid) {
      showFormError('#ruleError', '选择器语法错误：' + info.error);
      return;
    }
    const rules = state.settings.extraSkipSelectors || [];
    if (rules.indexOf(value) !== -1) {
      showFormError('#ruleError', '该选择器已存在');
      return;
    }
    if (rules.length >= 200) {
      showFormError('#ruleError', '自定义选择器最多 200 条');
      return;
    }
    const saved = await persistSettings(
      { extraSkipSelectors: rules.concat(value) },
      { silent: true }
    );
    if (!saved) {
      showFormError('#ruleError', '保存失败，请重试');
      return;
    }
    input.value = '';
    previewSelector('');
    renderExclude();
    toast('已添加选择器：' + value, 'success');
  }

  async function onRuleAction(event) {
    const button = event.target.closest('button[data-rule-act]');
    if (!button) return;
    const item = button.closest('li[data-index]');
    if (!item) return;
    const index = Number(item.dataset.index);
    const rules = (state.settings.extraSkipSelectors || []).slice();
    const act = button.dataset.ruleAct;

    if (act === 'edit') {
      state.rules.editing = index;
      renderExclude();
      const input = $('#customRules li[data-index="' + index + '"] [data-field="rule"]');
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    if (act === 'cancel') {
      state.rules.editing = null;
      renderExclude();
      return;
    }
    if (act === 'save') {
      const input = item.querySelector('[data-field="rule"]');
      await saveRule(index, input ? input.value : '');
      return;
    }
    if (act === 'delete') {
      const removed = rules[index];
      const next = rules.slice();
      next.splice(index, 1);
      const saved = await persistSettings({ extraSkipSelectors: next }, { silent: true });
      if (!saved) return;
      state.rules.editing = null;
      renderExclude();
      toast('已删除选择器：' + removed, 'success');
    }
  }

  function onRuleKeydown(event) {
    if (!event.target.matches('[data-field="rule"]')) return;
    const item = event.target.closest('li[data-index]');
    if (!item) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const input = item.querySelector('[data-field="rule"]');
      saveRule(Number(item.dataset.index), input ? input.value : '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      state.rules.editing = null;
      renderExclude();
    }
  }

  function bindExclude() {
    const input = $('#ruleInput');
    if (input) {
      input.addEventListener(
        'input',
        AIZ.debounce(() => previewSelector(input.value), 120)
      );
    }
    const form = $('#ruleForm');
    if (form) form.addEventListener('submit', addRule);
    const list = $('#customRules');
    if (list) {
      list.addEventListener('click', onRuleAction);
      list.addEventListener('keydown', onRuleKeydown);
    }
    renderBuiltinRules();
  }

  /* ------------------------------------------------------------------------
     动态规则
     ---------------------------------------------------------------------- */

  function patternRowTemplate(pattern, index, builtin) {
    const badges = builtin
      ? '<span class="aiz-badge aiz-badge--muted">内置</span>' +
        (pattern.isFn ? '<span class="aiz-badge aiz-badge--blue">动态函数</span>' : '')
      : '<span class="aiz-badge aiz-badge--primary">自定义</span>';
    const actions = builtin
      ? '<span class="o-hint">只读</span>'
      : '<button class="aiz-btn aiz-btn--sm aiz-btn--text" type="button" data-pattern-act="edit" data-index="' +
        index + '">编辑</button>' +
        '<button class="aiz-btn aiz-btn--sm aiz-btn--danger-text" type="button" data-pattern-act="delete" data-index="' +
        index + '">删除</button>';
    const toText = pattern.to ? pattern.to : '（删除匹配）';
    return (
      '<div class="o-pattern" data-index="' + index + '">' +
      '<div class="o-pattern__head">' +
      '<code class="o-pattern__re">/' + esc(pattern.source) + '/' + esc(pattern.flags) + '</code>' +
      badges +
      '</div>' +
      '<div class="o-pattern__meta">' +
      '<span><em>替换为</em> <code>' + esc(toText) + '</code></span>' +
      (pattern.note ? '<span><em>说明</em> ' + esc(pattern.note) + '</span>' : '') +
      (pattern.sample ? '<span><em>示例</em> <code>' + esc(pattern.sample) + '</code></span>' : '') +
      '</div>' +
      '<div class="o-pattern__actions">' + actions + '</div>' +
      '</div>'
    );
  }

  function patternEditTemplate(pattern, index) {
    return (
      '<div class="o-pattern o-pattern--editing" data-index="' + index + '">' +
      '<div class="o-inline-grid o-inline-grid--pattern">' +
      '<label class="aiz-field"><span>正则</span>' +
      '<input class="aiz-input aiz-input--mono" data-pfield="re" aria-label="正则表达式" value="' +
      esc(pattern.re) + '" /></label>' +
      '<label class="aiz-field o-field--flags"><span>flags</span>' +
      '<input class="aiz-input aiz-input--mono" data-pfield="flags" aria-label="flags" value="' +
      esc(pattern.flags) + '" /></label>' +
      '<label class="aiz-field"><span>替换为</span>' +
      '<input class="aiz-input aiz-input--mono" data-pfield="to" aria-label="替换模板" value="' +
      esc(pattern.to) + '" /></label>' +
      '</div>' +
      '<label class="aiz-field"><span>说明</span>' +
      '<input class="aiz-input" data-pfield="note" aria-label="规则说明" value="' +
      esc(pattern.note) + '" /></label>' +
      '<div class="o-pattern__actions">' +
      '<span class="o-hint">Enter 保存 · Esc 取消</span>' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--ghost" type="button" data-pattern-act="cancel">取消</button>' +
      '<button class="aiz-btn aiz-btn--sm aiz-btn--primary" type="button" data-pattern-act="save">保存</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderPatterns() {
    const builtinBox = $('#builtinPatterns');
    const builtinEmpty = $('#builtinPatternsEmpty');
    const builtinCountEl = $('#builtinPatternCount');
    if (builtinCountEl) {
      builtinCountEl.textContent = state.builtinPatterns.length
        ? '只读 · ' + state.builtinPatterns.length + ' 条'
        : '只读';
    }
    if (builtinBox && builtinEmpty) {
      if (!state.builtinPatterns.length) {
        builtinBox.innerHTML = '';
        builtinBox.hidden = true;
        builtinEmpty.hidden = false;
      } else {
        builtinBox.hidden = false;
        builtinEmpty.hidden = true;
        builtinBox.innerHTML = state.builtinPatterns
          .map((pattern, index) => patternRowTemplate(pattern, index, true))
          .join('');
      }
    }

    const custom = state.settings.extraPatterns || [];
    const count = $('#customPatternCount');
    if (count) count.textContent = String(custom.length);

    const customBox = $('#customPatterns');
    const empty = $('#patternsEmpty');
    if (!customBox || !empty) return;

    if (!custom.length && state.patterns.editing === null) {
      customBox.innerHTML = '';
      customBox.hidden = true;
      empty.hidden = false;
    } else {
      customBox.hidden = false;
      empty.hidden = true;
      customBox.innerHTML = custom
        .map((pattern, index) =>
          state.patterns.editing === index
            ? patternEditTemplate(pattern, index)
            : patternRowTemplate(pattern, index, false)
        )
        .join('');
    }

    renderPatternTest();
  }

  function togglePatternForm(show) {
    const form = $('#patternForm');
    if (!form) return;
    form.hidden = !show;
    if (show) {
      const re = $('#patRe');
      if (re) re.focus();
      return;
    }
    showFormError('#patternError', '');
    ['#patRe', '#patTo', '#patNote'].forEach((selector) => {
      const input = $(selector);
      if (input) {
        input.value = '';
        setInvalid(input, false);
      }
    });
  }

  function validatePattern(re, flags, exceptIndex) {
    if (!re) return '请填写正则表达式';
    if (re.length > 300) return '正则过长（最多 300 个字符）';
    const compiled = compilePattern(re, flags);
    if (compiled.error) return '正则无效：' + compiled.error;
    const list = state.settings.extraPatterns || [];
    const duplicate = list.some(
      (pattern, index) => index !== exceptIndex && pattern.re === re && pattern.flags === flags
    );
    if (duplicate) return '已存在相同的正则与 flags';
    return '';
  }

  async function addPattern(event) {
    event.preventDefault();
    const re = String($('#patRe').value || '').trim();
    const flags = String($('#patFlags').value || '').trim();
    const to = $('#patTo').value;
    const note = String($('#patNote').value || '').trim();
    showFormError('#patternError', '');

    const error = validatePattern(re, flags, -1);
    if (error) {
      showFormError('#patternError', error);
      return;
    }
    const list = state.settings.extraPatterns || [];
    const saved = await persistSettings(
      { extraPatterns: list.concat({ re, flags, to, note }) },
      { silent: true }
    );
    if (!saved) {
      showFormError('#patternError', '保存失败，请重试');
      return;
    }
    togglePatternForm(false);
    renderPatterns();
    toast('已添加正则规则', 'success');
  }

  async function onPatternAction(event) {
    const button = event.target.closest('button[data-pattern-act]');
    if (!button) return;
    const block = button.closest('.o-pattern');
    if (!block) return;
    const index = Number(block.dataset.index);
    const list = (state.settings.extraPatterns || []).slice();
    const act = button.dataset.patternAct;

    if (act === 'edit') {
      state.patterns.editing = index;
      renderPatterns();
      const input = $('#customPatterns .o-pattern--editing [data-pfield="re"]');
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    if (act === 'cancel') {
      state.patterns.editing = null;
      renderPatterns();
      return;
    }
    if (act === 'save') {
      const fields = {};
      block.querySelectorAll('[data-pfield]').forEach((input) => {
        fields[input.dataset.pfield] = input.value;
      });
      const re = String(fields.re || '').trim();
      const flags = String(fields.flags || '').trim();
      const to = fields.to || '';
      const note = String(fields.note || '').trim();
      const error = validatePattern(re, flags, index);
      if (error) {
        toast(error, 'error');
        return;
      }
      list[index] = { re, flags, to, note };
      const saved = await persistSettings({ extraPatterns: list }, { silent: true });
      if (!saved) {
        toast('保存失败，请重试', 'error');
        return;
      }
      state.patterns.editing = null;
      renderPatterns();
      toast('规则已保存', 'success');
      return;
    }
    if (act === 'delete') {
      const ok = await confirmDialog({
        title: '删除这条正则规则？',
        message: '删除后该规则立即停止生效。',
        okText: '删除',
        danger: true
      });
      if (!ok) return;
      const next = list.slice();
      next.splice(index, 1);
      const saved = await persistSettings({ extraPatterns: next }, { silent: true });
      if (!saved) return;
      state.patterns.editing = null;
      renderPatterns();
      toast('已删除规则', 'success');
    }
  }

  function onPatternKeydown(event) {
    if (!event.target.matches('[data-pfield]')) return;
    const block = event.target.closest('.o-pattern--editing');
    if (!block) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const saveButton = block.querySelector('[data-pattern-act="save"]');
      if (saveButton) saveButton.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      state.patterns.editing = null;
      renderPatterns();
    }
  }

  function renderPatternTest() {
    const box = $('#patternResults');
    const sampleEl = $('#patternSample');
    if (!box || !sampleEl) return;
    const sample = sampleEl.value;
    const list = state.settings.extraPatterns || [];

    if (!list.length) {
      box.innerHTML = '<p class="o-hint">还没有自定义规则；添加后这里会显示逐条与组合测试结果。</p>';
      return;
    }

    let html = '';
    list.forEach((pattern, index) => {
      const compiled = compilePattern(pattern.re, pattern.flags);
      if (compiled.error) {
        html +=
          '<div class="o-test o-test--error">' +
          '<div class="o-test__head"><span class="o-test__index">#' + (index + 1) + '</span>' +
          '<code>' + esc(pattern.re) + '</code>' +
          '<span class="aiz-badge aiz-badge--danger">无效</span></div>' +
          '<p class="o-hint">' + esc(compiled.error) + '</p>' +
          '</div>';
        return;
      }
      let count = 0;
      let output = sample;
      try {
        const flags = String(pattern.flags || '');
        const testRegex = new RegExp(pattern.re, flags.indexOf('g') !== -1 ? flags : flags + 'g');
        const matches = sample.match(testRegex);
        count = matches ? matches.length : 0;
        output = sample.replace(compiled.regex, pattern.to);
      } catch (err) {
        html +=
          '<div class="o-test o-test--error">' +
          '<div class="o-test__head"><span class="o-test__index">#' + (index + 1) + '</span>' +
          '<code>' + esc(pattern.re) + '</code>' +
          '<span class="aiz-badge aiz-badge--danger">执行失败</span></div>' +
          '<p class="o-hint">' + esc((err && err.message) || err) + '</p>' +
          '</div>';
        return;
      }
      html +=
        '<div class="o-test">' +
        '<div class="o-test__head"><span class="o-test__index">#' + (index + 1) + '</span>' +
        '<code>' + esc(pattern.re) + '</code>' +
        '<span class="aiz-badge ' + (count ? 'aiz-badge--ok' : 'aiz-badge--muted') + '">' +
        (count ? '命中 ' + count + ' 处' : '未命中') +
        '</span></div>' +
        '<p class="o-test__line"><span>输入</span><code>' + esc(sample) + '</code></p>' +
        '<p class="o-test__line"><span>输出</span><code class="' +
        (output === sample ? '' : 'o-test__changed') + '">' + esc(output) + '</code></p>' +
        '</div>';
    });

    let combined = sample;
    let failed = false;
    list.forEach((pattern) => {
      const compiled = compilePattern(pattern.re, pattern.flags);
      if (compiled.error) {
        failed = true;
        return;
      }
      try {
        combined = combined.replace(compiled.regex, pattern.to);
      } catch (err) {
        failed = true;
      }
    });
    html +=
      '<div class="o-test o-test--combined">' +
      '<div class="o-test__head"><strong>组合结果</strong>' +
      '<span class="aiz-badge aiz-badge--blue">按顺序应用</span></div>' +
      '<code class="o-test__combined">' + esc(combined) + '</code>' +
      (failed ? '<p class="o-hint">部分规则无效，已跳过。</p>' : '') +
      '</div>';

    box.innerHTML = html;
  }

  function bindPatterns() {
    const add = $('#btnAddPattern');
    if (add) add.addEventListener('click', () => togglePatternForm(true));
    const cancel = $('#patternCancel');
    if (cancel) cancel.addEventListener('click', () => togglePatternForm(false));
    const form = $('#patternForm');
    if (form) form.addEventListener('submit', addPattern);

    const custom = $('#customPatterns');
    if (custom) {
      custom.addEventListener('click', onPatternAction);
      custom.addEventListener('keydown', onPatternKeydown);
    }
    const sample = $('#patternSample');
    if (sample) {
      sample.addEventListener('input', AIZ.debounce(renderPatternTest, 150));
    }
  }

  /* ------------------------------------------------------------------------
     未汉化收集
     ---------------------------------------------------------------------- */

  function unmatchedRows() {
    const q = state.unmatchedView.q.trim().toLowerCase();
    return Object.keys(state.unmatched)
      .map((en) => ({ en, count: state.unmatched[en] }))
      .filter((row) => !q || row.en.toLowerCase().indexOf(q) !== -1)
      .sort((a, b) => b.count - a.count || a.en.localeCompare(b.en, 'en'));
  }

  function selectedUnmatchedPayload() {
    const out = {};
    state.unmatchedView.selected.forEach((en) => {
      if (Object.prototype.hasOwnProperty.call(state.unmatched, en)) {
        out[en] = state.unmatched[en];
      }
    });
    return out;
  }

  function updateUnmatchedSelectionUi() {
    const selected = state.unmatchedView.selected.size;
    const label = $('#unmatchedSelected');
    if (label) label.textContent = '已选 ' + selected + ' 条';
    const copy = $('#btnCopyUnmatched');
    const down = $('#btnDownloadUnmatched');
    const toDict = $('#btnToDict');
    if (copy) copy.disabled = selected === 0;
    if (down) down.disabled = selected === 0;
    if (toDict) toDict.disabled = selected === 0;

    const boxes = $$('#unmatchedBody input[data-unmatched-check]');
    const all = $('#unmatchedSelectAll');
    if (all) {
      all.checked = boxes.length > 0 && boxes.every((box) => box.checked);
      all.indeterminate = !all.checked && boxes.some((box) => box.checked);
    }
  }

  function renderUnmatched() {
    const rows = unmatchedRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / UNMATCHED_PER_PAGE));
    if (state.unmatchedView.page > totalPages) state.unmatchedView.page = totalPages;
    if (state.unmatchedView.page < 1) state.unmatchedView.page = 1;
    const start = (state.unmatchedView.page - 1) * UNMATCHED_PER_PAGE;
    const pageRows = rows.slice(start, start + UNMATCHED_PER_PAGE);

    const allKeys = new Set(Object.keys(state.unmatched));
    Array.from(state.unmatchedView.selected).forEach((en) => {
      if (!allKeys.has(en)) state.unmatchedView.selected.delete(en);
    });

    const wrap = $('#unmatchedTableWrap');
    const empty = $('#unmatchedEmpty');
    const body = $('#unmatchedBody');
    if (!wrap || !empty || !body) return;

    const hasRows = rows.length > 0;
    wrap.hidden = !hasRows;
    empty.hidden = hasRows;

    const url = state.stats.url || '';
    const pageLabel = url ? AIZ.hostOf(url) + AIZ.pathOf(url) : '';
    body.innerHTML = pageRows
      .map((row) => {
        const checked = state.unmatchedView.selected.has(row.en);
        return (
          '<tr data-en="' + esc(row.en) + '" class="' + (checked ? 'is-selected' : '') + '">' +
          '<td class="o-col-check"><input type="checkbox" data-unmatched-check ' +
          (checked ? 'checked ' : '') +
          'aria-label="选择 ' + esc(row.en) + '" /></td>' +
          '<td class="o-cell-en"><code class="o-en">' + esc(row.en) + '</code></td>' +
          '<td class="o-col-count"><span class="aiz-badge">' + esc(row.count) + '</span></td>' +
          '<td class="o-cell-url">' +
          (pageLabel
            ? '<span class="o-url" title="' + esc(url) + '">' + esc(pageLabel) + '</span>'
            : '<span class="o-hint">—</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    const total = Object.keys(state.unmatched).length;
    const summary = $('#unmatchedSummary');
    if (summary) {
      summary.textContent =
        '共 ' + total + ' 条 · 筛选后 ' + rows.length + ' 条' +
        (state.stats.at ? ' · 最近统计 ' + formatRelative(state.stats.at) : '');
    }
    const info = $('#unmatchedPageInfo');
    if (info) {
      info.textContent = hasRows
        ? '第 ' + state.unmatchedView.page + ' / ' + totalPages + ' 页 · 共 ' + rows.length + ' 条'
        : '共 0 条';
    }
    const prev = $('#unmatchedPrev');
    const next = $('#unmatchedNext');
    if (prev) prev.disabled = state.unmatchedView.page <= 1;
    if (next) next.disabled = state.unmatchedView.page >= totalPages;

    updateUnmatchedSelectionUi();
  }

  async function copySelectedUnmatched() {
    const payload = selectedUnmatchedPayload();
    const count = Object.keys(payload).length;
    if (!count) {
      toast('请先勾选要复制的条目', 'warn');
      return;
    }
    try {
      await copyText(JSON.stringify(payload, null, 2));
      toast('已复制 ' + count + ' 条 JSON', 'success');
    } catch (err) {
      toast('复制失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function downloadSelectedUnmatched() {
    const payload = selectedUnmatchedPayload();
    const count = Object.keys(payload).length;
    if (!count) {
      toast('请先勾选要下载的条目', 'warn');
      return;
    }
    const lines = [
      '# AI Studio 未汉化候选',
      '# 导出时间：' + new Date().toISOString(),
      '# 数量：' + count,
      ''
    ];
    Object.keys(payload)
      .sort()
      .forEach((en) => lines.push(en + '\t' + payload[en]));
    download(
      'aiz-unmatched-' + AIZ.stamp() + '.txt',
      lines.join('\r\n') + '\r\n',
      'text/plain;charset=utf-8'
    );
    toast('已下载 ' + count + ' 条候选', 'success');
  }

  async function clearUnmatched() {
    const total = Object.keys(state.unmatched).length;
    if (!total) {
      toast('没有可清空的记录', 'warn');
      return;
    }
    const ok = await confirmDialog({
      title: '清空未汉化记录？',
      message: '将清空 aiz.unmatched 中的 ' + total + ' 条候选，此操作不可撤销。',
      okText: '清空',
      danger: true
    });
    if (!ok) return;
    try {
      state.unmatched = await Store.setUnmatched({});
      state.unmatchedView.selected.clear();
      state.unmatchedView.page = 1;
      renderAll();
      toast('已清空未汉化记录', 'success');
    } catch (err) {
      toast('清空失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function convertUnmatchedToDict() {
    const selected = Object.keys(selectedUnmatchedPayload()).sort(
      (a, b) => state.unmatched[b] - state.unmatched[a] || a.localeCompare(b, 'en')
    );
    if (!selected.length) {
      toast('请先勾选要转换的候选', 'warn');
      return;
    }

    const body = document.createElement('div');
    body.className = 'o-convert';

    const batch = document.createElement('div');
    batch.className = 'o-convert__batch';
    batch.innerHTML =
      '<label class="aiz-field"><span>批量填入（可选）</span>' +
      '<span class="o-convert__batch-row">' +
      '<input class="aiz-input" id="convertBatchInput" type="text" placeholder="先给所有空项填入同一条译文" autocomplete="off" />' +
      '<button class="aiz-btn aiz-btn--ghost aiz-btn--sm" type="button" id="convertBatchBtn">批量填入</button>' +
      '</span></label>';
    body.appendChild(batch);

    const list = document.createElement('div');
    list.className = 'o-convert__list aiz-scroll';
    selected.forEach((en) => {
      const row = document.createElement('div');
      row.className = 'o-convert__row';
      row.dataset.en = en;

      const label = document.createElement('label');
      label.className = 'aiz-field';
      const head = document.createElement('span');
      head.className = 'o-convert__en';
      head.innerHTML =
        '<code>' + esc(en) + '</code>' +
        '<span class="aiz-badge aiz-badge--muted">×' + esc(state.unmatched[en]) + '</span>';
      label.appendChild(head);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'aiz-input';
      input.placeholder = '中文译文';
      input.value = state.customDict[en] || '';
      input.setAttribute('data-convert-input', '');
      input.setAttribute('aria-label', '「' + en + '」的中文译文');
      label.appendChild(input);
      row.appendChild(label);
      list.appendChild(row);
    });
    body.appendChild(list);

    const note = document.createElement('p');
    note.className = 'aiz-modal__note';
    note.textContent =
      '留空的条目会被跳过；已存在的同名自定义词条会被新译文覆盖。写入后这些条目会从 aiz.unmatched 中移除。';
    body.appendChild(note);

    const batchInput = $('#convertBatchInput', body);
    const batchButton = $('#convertBatchBtn', body);
    if (batchButton) {
      batchButton.addEventListener('click', () => {
        const value = batchInput.value.trim();
        if (!value) {
          toast('请先输入批量译文', 'warn');
          return;
        }
        let filled = 0;
        $$('[data-convert-input]', body).forEach((input) => {
          if (!input.value.trim()) {
            input.value = value;
            filled += 1;
          }
        });
        toast(
          filled ? '已填入 ' + filled + ' 条空项' : '没有空项可填入',
          filled ? 'success' : 'warn'
        );
      });
    }

    const collect = () => {
      const entries = [];
      $$('[data-convert-input]', body).forEach((input) => {
        const row = input.closest('.o-convert__row');
        const zh = input.value.trim();
        if (row && zh) entries.push({ en: row.dataset.en, zh });
      });
      return entries;
    };

    const payload = await AIZ.openModal({
      title: '转为自定义词条',
      message:
        '为勾选的 ' + selected.length + ' 条候选填写中文译文，确认后写入 aiz.customDict。',
      body,
      cancelValue: null,
      actions: [
        { label: '取消', className: 'aiz-btn--ghost', value: null },
        {
          label: '写入词典',
          className: 'aiz-btn--primary',
          autofocus: true,
          value: () => collect(),
          onClick: () => {
            if (!collect().length) {
              toast('请至少填写一条中文译文', 'error');
              return false;
            }
            return true;
          }
        }
      ]
    });

    if (!payload || !Array.isArray(payload) || !payload.length) return;

    const nextDict = Object.assign({}, state.customDict);
    const nextUnmatched = Object.assign({}, state.unmatched);
    let added = 0;
    let updated = 0;
    payload.forEach(({ en, zh }) => {
      if (Object.prototype.hasOwnProperty.call(nextDict, en)) updated += 1;
      else added += 1;
      nextDict[en] = zh;
      delete nextUnmatched[en];
    });

    try {
      state.customDict = await Store.setCustomDict(nextDict);
      state.unmatched = await Store.setUnmatched(nextUnmatched);
      payload.forEach(({ en }) => state.unmatchedView.selected.delete(en));
      state.dict.page = 1;
      renderAll();
      toast(
        '已写入词典：新增 ' + added + ' 条' +
          (updated ? '，更新 ' + updated + ' 条' : '') +
          '，并从未汉化列表移除',
        'success'
      );
    } catch (err) {
      toast('写入失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function bindUnmatched() {
    const search = $('#unmatchedSearch');
    if (search) {
      search.addEventListener(
        'input',
        AIZ.debounce((event) => {
          state.unmatchedView.q = event.target.value;
          state.unmatchedView.page = 1;
          renderUnmatched();
        }, 120)
      );
    }

    const body = $('#unmatchedBody');
    if (body) {
      body.addEventListener('change', (event) => {
        const checkbox = event.target.closest('input[data-unmatched-check]');
        if (!checkbox) return;
        const tr = checkbox.closest('tr');
        if (!tr) return;
        const en = tr.dataset.en;
        if (checkbox.checked) state.unmatchedView.selected.add(en);
        else state.unmatchedView.selected.delete(en);
        tr.classList.toggle('is-selected', checkbox.checked);
        updateUnmatchedSelectionUi();
      });
    }

    const selectAll = $('#unmatchedSelectAll');
    if (selectAll) {
      selectAll.addEventListener('change', (event) => {
        const checked = event.target.checked;
        $$('#unmatchedBody tr[data-en]').forEach((tr) => {
          const en = tr.dataset.en;
          if (checked) state.unmatchedView.selected.add(en);
          else state.unmatchedView.selected.delete(en);
          const box = tr.querySelector('input[data-unmatched-check]');
          if (box) box.checked = checked;
          tr.classList.toggle('is-selected', checked);
        });
        updateUnmatchedSelectionUi();
      });
    }

    const prev = $('#unmatchedPrev');
    if (prev) {
      prev.addEventListener('click', () => {
        state.unmatchedView.page -= 1;
        renderUnmatched();
      });
    }
    const next = $('#unmatchedNext');
    if (next) {
      next.addEventListener('click', () => {
        state.unmatchedView.page += 1;
        renderUnmatched();
      });
    }

    const copy = $('#btnCopyUnmatched');
    if (copy) copy.addEventListener('click', copySelectedUnmatched);
    const downloadBtn = $('#btnDownloadUnmatched');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadSelectedUnmatched);
    const toDict = $('#btnToDict');
    if (toDict) toDict.addEventListener('click', convertUnmatchedToDict);
    const clear = $('#btnClearUnmatched');
    if (clear) clear.addEventListener('click', clearUnmatched);
  }

  /* ------------------------------------------------------------------------
     数据与备份
     ---------------------------------------------------------------------- */

  function renderBackup() {
    const meta = $('#dataMeta');
    if (!meta) return;
    const size = byteLength(
      JSON.stringify({
        settings: state.settings,
        customDict: state.customDict,
        unmatched: state.unmatched,
        stats: state.stats
      })
    );
    meta.textContent =
      '本地占用约 ' + prettyBytes(size) +
      ' · 自定义词条 ' + Object.keys(state.customDict).length + ' 条' +
      ' · 未汉化 ' + Object.keys(state.unmatched).length + ' 条' +
      ' · 最近翻译 ' + (state.stats.at ? formatRelative(state.stats.at) : '暂无记录');
  }

  function exportAll() {
    const payload = {
      app: 'google-ai-studio-zh',
      schema: AIZ.schema,
      version: state.meta.version || AIZ.version,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      customDict: state.customDict,
      unmatched: state.unmatched,
      stats: state.stats
    };
    download('aiz-backup-' + AIZ.stamp() + '.json', JSON.stringify(payload, null, 2));
    toast('已导出全部配置', 'success');
  }

  async function importAllFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    try {
      const text = await AIZ.readFileText(file);
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('文件内容不是 JSON 对象');
      }
      const schemaRaw =
        data.schema !== undefined && data.schema !== null
          ? data.schema
          : data.aiz && data.aiz.schema;
      if (schemaRaw === undefined || schemaRaw === null) {
        throw new Error('缺少 schema 版本号，无法确认数据格式');
      }
      const schema = Number(schemaRaw);
      if (!Number.isFinite(schema)) throw new Error('schema 不是合法数字');
      if (schema > AIZ.schema) {
        throw new Error('数据版本 schema ' + schema + ' 高于当前支持的版本 ' + AIZ.schema);
      }

      const settings = AIZ.normalizeSettings(data.settings);
      const dict = AIZ.sanitizeDict(data.customDict);
      const unmatched = AIZ.sanitizeUnmatched(data.unmatched);

      const ok = await confirmDialog({
        title: '导入配置并覆盖？',
        message:
          'settings：' + Object.keys(settings).length + ' 个字段\n' +
          '自定义词条：' + Object.keys(dict).length + ' 条\n' +
          '未汉化候选：' + Object.keys(unmatched).length + ' 条\n\n' +
          '当前数据将被覆盖，建议先导出备份。',
        okText: '覆盖导入'
      });
      if (!ok) return;

      await Store.setSettings(settings);
      await Store.setCustomDict(dict);
      await Store.setUnmatched(unmatched);
      if (data.stats) {
        try {
          await Store.setStats(data.stats);
        } catch (err) {
          /* 统计信息可选 */
        }
      }

      state.dict.page = 1;
      state.dict.editing = null;
      state.patterns.editing = null;
      state.rules.editing = null;
      state.unmatchedView.page = 1;
      state.unmatchedView.selected.clear();
      await reload();
      toast('配置已导入', 'success');
    } catch (err) {
      toast('导入失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function resetAll() {
    const typed = await promptDialog({
      title: '重置全部本地数据',
      message:
        '将清空 settings / customDict / unmatched / stats，并恢复默认设置。此操作不可撤销。',
      label: '输入 RESET 确认',
      placeholder: 'RESET',
      requiredValue: 'RESET',
      confirmText: '重置全部数据',
      danger: true
    });
    if (typed === null) return;
    try {
      await Store.clearAll();
      await Store.setSettings(AIZ.DEFAULT_SETTINGS);
      state.dict.page = 1;
      state.dict.editing = null;
      state.patterns.editing = null;
      state.rules.editing = null;
      state.unmatchedView.page = 1;
      state.unmatchedView.selected.clear();
      await reload();
      toast('已重置全部本地数据', 'success');
    } catch (err) {
      toast('重置失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  function bindBackup() {
    const exportBtn = $('#btnExportAll');
    if (exportBtn) exportBtn.addEventListener('click', exportAll);
    const importBtn = $('#btnImportAll');
    if (importBtn) importBtn.addEventListener('click', () => $('#configFile').click());
    const file = $('#configFile');
    if (file) file.addEventListener('change', importAllFile);
    const reset = $('#btnResetAll');
    if (reset) reset.addEventListener('click', resetAll);
  }

  /* ------------------------------------------------------------------------
     关于
     ---------------------------------------------------------------------- */

  function renderGlossary() {
    const list = $('#glossaryList');
    if (!list) return;
    list.innerHTML = GLOSSARY.map(([en, zh, note]) => {
      return (
        '<div class="o-glossary__row">' +
        '<dt><code>' + esc(en) + '</code></dt>' +
        '<dd>' + esc(zh) + (note ? '<span>' + esc(note) + '</span>' : '') + '</dd>' +
        '</div>'
      );
    }).join('');
  }

  function renderAbout() {
    const version = state.meta.version || AIZ.version;
    const top = $('#topVersion');
    if (top) top.textContent = 'v' + version;
    const aboutVersion = $('#aboutVersion');
    if (aboutVersion) aboutVersion.textContent = 'v' + version;
    const dict = $('#aboutDictCount');
    if (dict) dict.textContent = builtinCount() ? String(builtinCount()) : '—';
    const custom = $('#aboutCustomCount');
    if (custom) custom.textContent = String(Object.keys(state.customDict).length);
  }

  function renderNavCounts() {
    const dictCount = Object.keys(state.customDict).length;
    const navDict = $('#navDictCount');
    if (navDict) {
      navDict.hidden = false;
      navDict.textContent = String(dictCount);
      navDict.title = '自定义词条 ' + dictCount + ' 条';
    }
    const total = Object.keys(state.unmatched).length;
    const navUnmatched = $('#navUnmatchedCount');
    if (navUnmatched) {
      navUnmatched.hidden = total === 0;
      navUnmatched.textContent = String(total);
      navUnmatched.title = '未汉化候选 ' + total + ' 条';
    }
  }

  /* ------------------------------------------------------------------------
     路由
     ---------------------------------------------------------------------- */

  function route() {
    const raw = String(window.location.hash || '').replace(/^#/, '');
    const id = SECTIONS.indexOf(raw) === -1 ? 'general' : raw;

    $$('.o-section').forEach((section) => {
      section.hidden = section.dataset.section !== id;
    });

    $$('.o-nav__item').forEach((link) => {
      if (link.dataset.route === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    document.title = SECTION_TITLES[id] + ' · AI Studio 汉化设置';

    const heading = $('#sec-' + id + ' .o-head__title');
    if (heading) {
      try {
        heading.focus({ preventScroll: true });
      } catch (err) {
        /* ignore */
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (id === 'unmatched') renderUnmatched();
    if (id === 'patterns') renderPatternTest();
  }

  /* ------------------------------------------------------------------------
     启动
     ---------------------------------------------------------------------- */

  function initChrome() {
    renderGlossary();
    bindGeneral();
    bindDict();
    bindExclude();
    bindPatterns();
    bindUnmatched();
    bindBackup();

    const footer = $('#footerMode');
    if (footer) {
      footer.textContent = AIZ.isMock
        ? '预览模式（mock）· 数据不写入扩展'
        : '扩展模式 · chrome.storage.local';
    }

    window.addEventListener('hashchange', route);

    reload()
      .then(() => route())
      .catch((err) => {
        toast('初始化失败：' + (err && err.message ? err.message : err), 'error');
        route();
      });
  }

  initChrome();
})();
