/* ==========================================================================
   popup 逻辑
   - 所有 chrome.* 访问都经 AIZ 封装（ui/mock.js），file:// 预览时自动走 mock
   - 不内联事件、不拼接未转义的用户数据
   ========================================================================== */

(function () {
  'use strict';

  const AIZ = globalThis.AIZ;
  if (!AIZ) return;

  const { Store, esc, toast } = AIZ;

  const el = (id) => document.getElementById(id);

  const ui = {
    busy: false,
    settings: AIZ.normalizeSettings(null),
    meta: { version: AIZ.version, dictCount: null },
    tab: null,
    isAistudio: false,
    translated: 0,
    statsAt: 0,
    unmatched: {}
  };

  const QUICK_LABELS = {
    forceEnglish: '强制英文界面',
    highlight: '译文高亮',
    hoverOriginal: '悬停看原文'
  };

  /* ------------------------------------------------------------------------
     开关基础
     ---------------------------------------------------------------------- */

  function switchOn(button) {
    return button.getAttribute('aria-checked') === 'true';
  }

  function setSwitch(button, on) {
    if (!button) return;
    button.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  /**
   * 内置词条数：优先读取静态加载的词典分卷（window.__AIZ_DICT__）。
   * 不走内容脚本的 AIZ_GET_STATS，因为不在 AI Studio 页面时该值为 0。
   */
  function builtinDictCount() {
    const dict = globalThis.__AIZ_DICT__;
    if (dict && typeof dict === 'object') {
      const count = Object.keys(dict).filter((key) => {
        const value = dict[key];
        return typeof value === 'string' && value.trim().length > 0;
      }).length;
      if (count > 0) return count;
    }
    const metaCount =
      ui.meta && ui.meta.dictCount !== null && ui.meta.dictCount !== undefined
        ? Number(ui.meta.dictCount)
        : NaN;
    return Number.isFinite(metaCount) && metaCount > 0 ? metaCount : null;
  }

  /* ------------------------------------------------------------------------
     数据加载
     ---------------------------------------------------------------------- */

  async function loadPageState() {
    let tab = null;
    try {
      tab = await AIZ.getActiveTab();
    } catch (err) {
      tab = null;
    }
    ui.tab = tab;
    ui.isAistudio = Boolean(tab && tab.url && AIZ.isAistudioUrl(tab.url));

    let storedUnmatched = {};
    try {
      storedUnmatched = await Store.getUnmatched();
    } catch (err) {
      storedUnmatched = {};
    }

    ui.translated = 0;
    ui.statsAt = 0;
    ui.unmatched = Object.assign({}, storedUnmatched);

    if (!ui.isAistudio) return;

    try {
      const stats = await AIZ.withTimeout(
        AIZ.sendTab({ type: 'AIZ_GET_STATS' }, tab.id),
        2200
      );
      if (stats && stats.ok) {
        ui.translated = Math.max(0, Number(stats.translated) || 0);
        ui.statsAt = Date.now();
        const merged = Object.assign({}, ui.unmatched);
        (Array.isArray(stats.unmatched) ? stats.unmatched : []).forEach((en) => {
          if (typeof en === 'string' && en && !Object.prototype.hasOwnProperty.call(merged, en)) {
            merged[en] = 1;
          }
        });
        ui.unmatched = merged;
        return;
      }
    } catch (err) {
      /* 内容脚本尚未注入（刚安装 / 刷新中）：退回本地统计 */
    }

    try {
      const saved = await Store.getStats();
      if (saved.translated) ui.translated = saved.translated;
      ui.statsAt = saved.at;
    } catch (err) {
      /* ignore */
    }
  }

  async function refreshAll() {
    try {
      ui.settings = await Store.getSettings();
      await loadPageState();
      render();
    } catch (err) {
      toast('刷新状态失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  /* ------------------------------------------------------------------------
     渲染
     ---------------------------------------------------------------------- */

  function render() {
    const settings = ui.settings;
    setSwitch(el('masterSwitch'), Boolean(settings.enabled));
    document.querySelectorAll('[data-switch]').forEach((button) => {
      setSwitch(button, Boolean(settings[button.dataset.switch]));
    });

    const version = ui.meta && ui.meta.version ? ui.meta.version : AIZ.version;
    el('appVersion').textContent = 'v' + version;

    const host = ui.tab && ui.tab.url ? AIZ.hostOf(ui.tab.url) : '';
    el('hostName').textContent = host || '未检测到活动页面';
    el('hostName').title = (ui.tab && ui.tab.url) || '';
    el('hostDot').classList.toggle('is-off', !ui.isAistudio);

    const badge = el('engineBadge');
    if (!settings.enabled) {
      badge.textContent = '已关闭';
      badge.className = 'aiz-badge aiz-badge--danger';
    } else if (!ui.isAistudio) {
      badge.textContent = '未连接';
      badge.className = 'aiz-badge aiz-badge--muted';
    } else {
      badge.textContent = '已启用';
      badge.className = 'aiz-badge aiz-badge--ok';
    }

    el('metricTranslated').textContent = ui.isAistudio ? String(ui.translated) : '—';
    el('metricUnmatched').textContent = String(Object.keys(ui.unmatched).length);

    const rawDictCount = builtinDictCount();
    el('metricDict').textContent =
      rawDictCount === null ? '—' : String(rawDictCount);

    const note = el('pageNote');
    if (!ui.isAistudio) {
      note.hidden = false;
      note.textContent = '当前页面不是 AI Studio，请打开 aistudio.google.com 后使用。';
    } else if (!settings.enabled) {
      note.hidden = false;
      note.textContent = '汉化已关闭，页面保持英文原文。';
    } else {
      note.hidden = true;
      note.textContent = '';
    }

    const time = el('statusTime');
    if (ui.isAistudio && ui.statsAt) {
      time.hidden = false;
      time.textContent = '最近翻译：' + AIZ.formatRelative(ui.statsAt);
    } else {
      time.hidden = true;
      time.textContent = '';
    }

    const canAct = Boolean(ui.isAistudio && settings.enabled && !ui.busy);
    el('btnRetranslate').disabled = !canAct;
    el('btnClear').disabled = Boolean(!ui.isAistudio || ui.busy);

    renderUnmatched();
  }

  function renderUnmatched() {
    const entries = Object.entries(ui.unmatched || {}).sort(
      (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'en')
    );
    const total = entries.length;

    el('unmatchedBadge').textContent = String(total);
    el('btnCopyUnmatched').disabled = total === 0 || ui.busy;

    const list = el('unmatchedList');
    const empty = el('unmatchedEmpty');
    const hint = el('unmatchedHint');

    if (!total) {
      list.hidden = true;
      list.innerHTML = '';
      empty.hidden = false;
      hint.hidden = true;
      return;
    }

    list.hidden = false;
    empty.hidden = true;
    hint.hidden = false;

    const shown = entries.slice(0, 8);
    let html = shown
      .map(
        ([en, count]) =>
          '<li class="p-list__item">' +
          '<span class="p-list__dot" aria-hidden="true"></span>' +
          '<span class="p-list__text" title="' +
          esc(en) +
          '">' +
          esc(en) +
          '</span>' +
          '<span class="aiz-badge aiz-badge--muted">×' +
          esc(count) +
          '</span>' +
          '</li>'
      )
      .join('');

    if (total > shown.length) {
      html += '<li class="p-list__more">等 ' + total + ' 条 · 可在设置中查看全部</li>';
    }

    list.innerHTML = html;
  }

  function setBusy(on) {
    ui.busy = Boolean(on);
    el('btnRetranslate').setAttribute('aria-busy', ui.busy ? 'true' : 'false');
    render();
  }

  /* ------------------------------------------------------------------------
     交互
     ---------------------------------------------------------------------- */

  async function toggleSetting(button, key) {
    if (!button || !key) return;
    const next = !switchOn(button);
    const previous = Boolean(ui.settings[key]);
    setSwitch(button, next);
    ui.settings[key] = next;

    try {
      ui.settings = await Store.setSettings({ [key]: next });
      if (key === 'enabled') {
        render();
        AIZ.applySettings(ui.tab && ui.tab.id).catch(() => {});
        toast(next ? '汉化已开启' : '汉化已关闭', 'success');
        return;
      }
      if (key === 'forceEnglish') {
        toast(
          next ? '已开启强制英文界面，刷新 AI Studio 页面后生效' : '已关闭强制英文界面，刷新页面后恢复默认',
          'success'
        );
        AIZ.applySettings(ui.tab && ui.tab.id).catch(() => {});
        return;
      }
      toast((QUICK_LABELS[key] || '设置') + (next ? '已开启' : '已关闭'), 'success');
    } catch (err) {
      ui.settings[key] = previous;
      setSwitch(button, previous);
      toast('保存失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function retranslate() {
    if (ui.busy || !ui.isAistudio || !ui.tab) return;
    setBusy(true);
    try {
      const res = await AIZ.withTimeout(AIZ.retranslate(ui.tab.id), 5000);
      if (!res || !res.ok) {
        throw new Error((res && res.error) || '页面没有响应');
      }
      ui.translated = Math.max(0, Number(res.translated) || 0);
      ui.statsAt = Date.now();
      toast('已重新翻译 ' + ui.translated + ' 条文案', 'success');
      await loadPageState();
    } catch (err) {
      toast('重新翻译失败：' + (err && err.message ? err.message : err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function clearMarks() {
    if (ui.busy || !ui.isAistudio || !ui.tab) return;
    setBusy(true);
    try {
      const res = await AIZ.withTimeout(AIZ.clearMarks(ui.tab.id), 5000);
      if (!res || !res.ok) {
        throw new Error((res && res.error) || '页面没有响应');
      }
      toast('已还原为英文原文，刷新页面可重新翻译', 'success');
    } catch (err) {
      toast('还原失败：' + (err && err.message ? err.message : err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openOptions() {
    try {
      await AIZ.openOptions();
    } catch (err) {
      toast('无法打开设置页：' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function copyUnmatched() {
    const entries = Object.entries(ui.unmatched || {});
    if (!entries.length) {
      toast('暂无未汉化候选', 'warn');
      return;
    }
    const payload = {};
    entries.forEach(([en, count]) => {
      payload[en] = count;
    });
    try {
      await AIZ.copyText(JSON.stringify(payload, null, 2));
      toast('已复制 ' + entries.length + ' 条候选 JSON', 'success');
    } catch (err) {
      toast('复制失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  /* ------------------------------------------------------------------------
     绑定 + 启动
     ---------------------------------------------------------------------- */

  function bindEvents() {
    el('masterSwitch').addEventListener('click', () => toggleSetting(el('masterSwitch'), 'enabled'));

    document.querySelectorAll('[data-switch]').forEach((button) => {
      button.addEventListener('click', () => toggleSetting(button, button.dataset.switch));
    });

    el('btnRetranslate').addEventListener('click', retranslate);
    el('btnClear').addEventListener('click', clearMarks);
    el('btnOptions').addEventListener('click', openOptions);
    el('btnCopyUnmatched').addEventListener('click', copyUnmatched);

    if (AIZ.isMock) {
      window.addEventListener('aiz:mock-state', () => {
        refreshAll();
      });
    }
  }

  async function init() {
    bindEvents();
    try {
      ui.settings = await Store.getSettings();
    } catch (err) {
      ui.settings = AIZ.normalizeSettings(null);
    }
    try {
      ui.meta = await AIZ.getMeta();
    } catch (err) {
      ui.meta = { version: AIZ.version, dictCount: null };
    }
    await loadPageState();
    render();
  }

  init();
})();
