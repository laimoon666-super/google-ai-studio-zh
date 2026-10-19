/* ============================================================
 * Google AI Studio 汉化助手 · 翻译引擎
 * ------------------------------------------------------------
 * 设计原则（很重要，改代码前先读）：
 * 1. 只用「词典精确匹配 + 锚定正则」翻译，绝不做自由翻译，因此模型输出、
 *    用户提示词、代码即使出现在页面上也不会被改写（内容不命中词典）。
 * 2. 只处理 DOM 文本节点与被观察的属性（placeholder/aria-label/title/alt），
 *    不碰 input 的 value，不重建 DOM，避免打断 Angular 渲染。
 * 3. 用 MutationObserver 应对 Angular 的反复重渲染；自身写入 DOM 会造成
 *    回调，因此所有写入都做幂等判断（译文再匹配不到词典，天然收敛）。
 * 4. 所有原文都记录在 WeakMap / data-aiz-orig 中，可一键完整还原英文。
 * ============================================================ */
(function () {
  'use strict';

  if (window.__AIZ_ENGINE__) return;

  var ENGINE_VERSION = '1.0.0';

  var DEFAULT_SETTINGS = {
    enabled: true,
    forceEnglish: true,
    highlight: false,
    hoverOriginal: false,
    translateAttrs: true,
    collectUnmatched: true,
    extraSkipSelectors: [],
    extraPatterns: []
  };

  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'data-tooltip'];

  /* 基础不翻译区域：图标连字、代码、可编辑区、聊天内容、第三方编辑器 */
  var BASE_SKIP = [
    'script', 'style', 'noscript', 'template',
    'code', 'pre', 'kbd', 'samp', 'svg', 'math', 'canvas',
    '.notranslate', '[translate="no"]',
    '.material-symbols-outlined', '.material-symbols-rounded', '.material-symbols-sharp',
    '.material-icons', '.material-icons-outlined', '.material-icons-round',
    '.google-symbols', 'ms-icon', '.ms-icon', '.aiz-orig-tip',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]', '[role="code"]',
    'ms-chat-turn', 'ms-user-query', 'ms-model-response', 'ms-code-block',
    'ms-prompt-chunk', '.chunk-editor-content', '.markdown-body', '.markdown',
    '.monaco-editor', '.code-editor', '.cm-editor', '.ace_editor', '.hljs'
  ];

  /* 属性翻译时额外跳过的区域（注意：不能跳过 textarea，否则 placeholder 翻译不到） */
  var ATTR_SKIP = ['script', 'style', 'noscript', '.notranslate', '.aiz-orig-tip'];

  /* 未汉化候选：只收集"看起来像 UI 控件"的元素里的英文 */
  var UI_HINT_SELECTOR = [
    'button', 'a', 'label', 'th', 'legend', 'summary',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '[role="menuitem"]', '[role="button"]', '[role="tab"]', '[role="option"]',
    '[role="heading"]', '[role="switch"]', '[role="checkbox"]',
    'mat-option', 'mat-select', 'mat-checkbox', 'mat-slide-toggle',
    'mat-tab', 'mat-tooltip', '.mat-mdc-select-value-text', '.mat-mdc-tooltip',
    '[class*="label"]', '[class*="Label"]', '[class*="title"]', '[class*="Title"]',
    '[class*="heading"]', '[class*="Heading"]', '[class*="caption"]', '[class*="Caption"]'
  ].join(',');

  var state = {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    builtin: {},
    custom: {},
    exact: new Map(),
    lower: new Map(),
    patterns: [],
    skipSelector: BASE_SKIP.join(','),
    attrSkipSelector: ATTR_SKIP.join(','),

    processed: new Set(),
    seen: new WeakSet(),
    originals: new WeakMap(),
    applied: new WeakMap(),
    counted: new WeakSet(),
    elemCounts: new WeakMap(),
    attrOriginals: new WeakMap(),
    attrElems: new Set(),
    observedRoots: new WeakSet(),

    observers: [],
    queue: [],
    scheduled: false,
    translated: 0,
    unique: new Set(),
    unmatched: {},
    persistTimer: 0,

    enabled: true,
    running: false,
    url: location.href,
    urlTimer: 0,

    onPersist: null,
    hoverBound: false
  };

  /* ---------------- 工具 ---------------- */

  function normalize(str) {
    return String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
  }

  function safeQuerySelector(sel) {
    try {
      document.querySelector(sel);
      return true;
    } catch (e) {
      return false;
    }
  }

  function buildSkipSelectors() {
    var extra = (state.settings.extraSkipSelectors || []).filter(function (s) {
      return typeof s === 'string' && s.trim() && safeQuerySelector(s.trim());
    }).map(function (s) { return s.trim(); });

    state.skipSelector = BASE_SKIP.concat(extra).join(',');
    state.attrSkipSelector = ATTR_SKIP.concat(extra).join(',');
  }

  function buildIndex() {
    state.exact = new Map();
    state.lower = new Map();

    Object.keys(state.builtin).forEach(putEntry);
    Object.keys(state.custom).forEach(putEntry);

    function putEntry(key) {
      var val = state.custom.hasOwnProperty(key) && typeof state.custom[key] === 'string'
        ? state.custom[key]
        : state.builtin[key];
      if (typeof val !== 'string' || !val) return;
      state.exact.set(key, val);
      var low = key.toLowerCase();
      state.lower.set(low, val);
    }

    // 用户自定义优先：再跑一遍，确保 custom 覆盖内置的同 key（大小写不同也算）
    Object.keys(state.custom).forEach(function (key) {
      var val = state.custom[key];
      if (typeof val !== 'string' || !val) return;
      state.exact.set(key, val);
      state.lower.set(key.toLowerCase(), val);
    });

    state.patterns = (window.__AIZ_PATTERNS__ || []).slice();

    (state.settings.extraPatterns || []).forEach(function (p) {
      if (!p || typeof p.re !== 'string') return;
      try {
        var re = new RegExp(p.re, p.flags || '');
        state.patterns.push({
          re: re,
          to: String(p.to == null ? '' : p.to),
          note: p.note || '用户自定义规则',
          sample: p.sample || '',
          custom: true
        });
      } catch (e) {
        /* 非法正则直接忽略，避免整页翻译挂掉 */
      }
    });
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return true;
    try {
      return !!el.closest(state.skipSelector);
    } catch (e) {
      return false;
    }
  }

  function hasLetter(str) {
    return /[A-Za-z]/.test(str);
  }

  /**
   * Material 图标连字（menu_open / chat_spark / settings）在某些版本里没有
   * notranslate 类，只靠字体渲染。这里对"单个小写单词"做一次字体判断，
   * 避免把图标名当成 UI 文案翻译掉。
   */
  function looksLikeIconGlyph(el, text) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(text)) return false;
    try {
      var ff = window.getComputedStyle(el).fontFamily || '';
      return /Google Symbols|Material Icons|Material Symbols/i.test(ff);
    } catch (e) {
      return false;
    }
  }

  /** 浏览器标签标题：Playground - Google AI Studio → 对话实验室 - Google AI Studio */
  function translateTitle() {
    if (!state.enabled || !state.running) return;
    var raw = document.title;
    if (!raw) return;
    var hit = lookup(raw);
    if (hit && hit.zh !== raw) {
      document.title = hit.zh;
      return;
    }
    var m = raw.match(/^(.+?)\s*[-–—|]\s*Google AI Studio$/);
    if (!m) return;
    var inner = lookup(m[1]);
    if (inner && inner.zh !== m[1]) {
      document.title = inner.zh + ' - Google AI Studio';
    }
  }

  /* ---------------- 核心匹配 ---------------- */

  function lookup(raw) {
    var key = normalize(raw);
    if (!key || key.length < 2) return null;
    if (!hasLetter(key)) return null;

    var hit = state.exact.get(key);
    if (hit == null) hit = state.lower.get(key.toLowerCase());
    if (hit != null) return { zh: hit, kind: 'dict' };

    if (key.length <= 160) {
      for (var i = 0; i < state.patterns.length; i++) {
        var p = state.patterns[i];
        try {
          p.re.lastIndex = 0;
          if (!p.re.test(key)) continue;
          var out;
          if (typeof p.to === 'function') out = key.replace(p.re, p.to);
          else out = key.replace(p.re, p.to);
          if (out && out !== key) return { zh: out, kind: 'pattern' };
        } catch (e) {
          /* 单条规则异常不影响整体 */
        }
      }
    }
    return null;
  }

  /* ---------------- 写入 / 还原 ---------------- */

  function markElement(el, originalRaw) {
    var count = state.elemCounts.get(el) || 0;
    state.elemCounts.set(el, count + 1);
    if (count === 0) {
      el.setAttribute('data-aiz-zh', '');
      el.setAttribute('data-aiz-orig', normalize(originalRaw).slice(0, 240));
    }
  }

  function restoreAll() {
    stopObserving();

    state.processed.forEach(function (node) {
      var orig = state.originals.get(node);
      if (orig != null && node.isConnected) {
        try { node.nodeValue = orig; } catch (e) { /* ignore */ }
      }
    });

    state.processed = new Set();
    state.seen = new WeakSet();
    state.originals = new WeakMap();
    state.applied = new WeakMap();
    state.counted = new WeakSet();
    state.elemCounts = new WeakMap();

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-aiz-zh]'),
      function (el) {
        el.removeAttribute('data-aiz-zh');
        el.removeAttribute('data-aiz-orig');
      }
    );

    state.attrElems.forEach(function (el) {
      var map = state.attrOriginals.get(el);
      if (!map) return;
      Object.keys(map).forEach(function (attr) {
        try { el.setAttribute(attr, map[attr]); } catch (e) { /* ignore */ }
      });
    });
    state.attrElems = new Set();
    state.attrOriginals = new WeakMap();

    state.translated = 0;
    state.unique = new Set();

    if (state.running) setTimeout(startObserving, 120);
  }

  /* ---------------- 文本节点翻译 ---------------- */

  function translateNode(node) {
    if (!state.enabled || !state.running) return;
    if (!node || node.nodeType !== 3) return;
    if (state.processed.has(node) || state.seen.has(node)) return;

    var raw = node.nodeValue;
    if (!raw || !raw.trim()) return;

    var parent = node.parentElement;
    if (!parent || isSkipped(parent)) return;

    if (state.applied.get(node) === raw) return;

    state.seen.add(node);

    if (looksLikeIconGlyph(parent, normalize(raw))) return;

    var hit = lookup(raw);
    if (!hit) {
      collectCandidate(raw, parent);
      return;
    }

    var lead = (raw.match(/^\s*/) || [''])[0];
    var trail = (raw.match(/\s*$/) || [''])[0];
    var next = lead + hit.zh + trail;
    if (next === raw) return;

    // 记录原文（若该节点曾被 Angular 改回英文，以最新英文为准）
    state.originals.set(node, raw);
    state.applied.set(node, next);
    state.processed.add(node);

    node.nodeValue = next;
    markElement(parent, raw);

    if (!state.counted.has(node)) {
      state.counted.add(node);
      state.translated += 1;
      state.unique.add(normalize(raw));
    }
    schedulePersist();
  }

  function enqueue(node) {
    if (!node || state.processed.has(node)) return;
    if (state.queue.length > 4000) return;
    state.queue.push(node);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (state.scheduled) return;
    state.scheduled = true;
    setTimeout(flush, 24);
  }

  function flush() {
    state.scheduled = false;
    if (!state.enabled || !state.running) {
      state.queue.length = 0;
      return;
    }
    var started = performance.now();
    var count = 0;
    while (state.queue.length && count < 400 && performance.now() - started < 10) {
      var node = state.queue.shift();
      count += 1;
      try {
        translateNode(node);
      } catch (e) {
        /* 单个节点失败不影响整体 */
      }
    }
    if (state.queue.length) scheduleFlush();
    else translateTitle();
  }

  /* ---------------- 属性翻译 ---------------- */

  function translateAttribute(el, attr) {
    if (!state.enabled || !state.running || !state.settings.translateAttrs) return;
    if (!el || el.nodeType !== 1) return;
    if (!el.hasAttribute(attr)) return;

    try {
      if (el.closest(state.attrSkipSelector)) return;
    } catch (e) { /* ignore */ }

    var raw = el.getAttribute(attr);
    if (!raw || !raw.trim() || !hasLetter(raw)) return;

    var hit = lookup(raw);
    if (!hit || hit.zh === raw) return;

    var map = state.attrOriginals.get(el);
    if (!map) {
      map = {};
      state.attrOriginals.set(el, map);
    }
    if (!(attr in map)) map[attr] = raw;
    state.attrElems.add(el);

    try {
      el.setAttribute(attr, hit.zh);
      state.unique.add(normalize(raw));
      state.translated += 1;
    } catch (e) { /* ignore */ }
  }

  function scanAttributes(root) {
    var scope = root && root.nodeType === 1 ? root : document;
    var selector = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
    var nodes;
    try {
      nodes = scope.querySelectorAll(selector);
    } catch (e) {
      return;
    }
    var list = Array.prototype.slice.call(nodes, 0, 3000);
    if (scope.nodeType === 1 && scope.matches && scope.matches(selector)) list.unshift(scope);
    list.forEach(function (el) {
      ATTRS.forEach(function (attr) {
        if (el.hasAttribute(attr)) translateAttribute(el, attr);
      });
    });
  }

  /* ---------------- 未汉化候选收集 ---------------- */

  function collectCandidate(raw, parent) {
    if (!state.enabled || !state.settings.collectUnmatched) return;
    var text = normalize(raw);
    if (text.length < 2 || text.length > 100) return;
    if (/[\u4e00-\u9fff\u3000-\u303f]/.test(text)) return;
    if (!/[A-Za-z]{2,}/.test(text)) return;
    if (/^(https?:|www\.|mailto:)/i.test(text)) return;
    if (text.indexOf('@') >= 0) return;
    if (/^[A-Z0-9_\-{}./\\]+$/.test(text)) return;

    var ui;
    try {
      ui = parent.closest(UI_HINT_SELECTOR);
    } catch (e) {
      return;
    }
    if (!ui) return;

    // 排除明显是代码/路径/版本号的内容
    if (/^[\w.-]+\.(js|ts|json|py|html|css|md|txt|png|jpg|svg)$/i.test(text)) return;
    if (/^\d+(\.\d+)+$/.test(text)) return;

    state.unmatched[text] = (state.unmatched[text] || 0) + 1;
    schedulePersist();
  }

  /* ---------------- 扫描 ---------------- */

  function scan(root) {
    if (!root || !state.enabled) return;

    if (root.nodeType === 3) {
      enqueue(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;

    var scope = root.nodeType === 9 ? root.body || root.documentElement : root;
    if (!scope) return;

    if (scope.nodeType === 1 && isSkipped(scope)) {
      // 被跳过的子树里也可能有 open shadow root，但极罕见，直接放弃以省性能
      return;
    }

    var walker;
    try {
      walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (isSkipped(p)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
    } catch (e) {
      return;
    }

    var node;
    var guard = 0;
    while ((node = walker.nextNode())) {
      enqueue(node);
      if (++guard > 6000) break;
    }

    scanShadowRoots(scope);
  }

  function scanShadowRoots(scope) {
    var hosts;
    try {
      hosts = scope.querySelectorAll('*');
    } catch (e) {
      return;
    }
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (!host.shadowRoot) continue;
      if (!state.observedRoots.has(host.shadowRoot)) observeRoot(host.shadowRoot);
      scan(host.shadowRoot);
    }
  }

  /* ---------------- MutationObserver ---------------- */

  function handleMutations(records) {
    if (!state.enabled || !state.running) return;

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];

      if (rec.type === 'childList') {
        for (var j = 0; j < rec.addedNodes.length; j++) {
          var added = rec.addedNodes[j];
          if (added.nodeType === 3) {
            enqueue(added);
          } else if (added.nodeType === 1) {
            scan(added);
            if (added.shadowRoot) {
              if (!state.observedRoots.has(added.shadowRoot)) observeRoot(added.shadowRoot);
              scan(added.shadowRoot);
            }
            if (state.settings.translateAttrs) scanAttributes(added);
          }
        }
        continue;
      }

      if (rec.type === 'characterData') {
        var target = rec.target;
        if (!target || target.nodeType !== 3) continue;
        // 自己写入造成的回调：忽略（幂等收敛）
        if (state.applied.get(target) === target.nodeValue) continue;
        // Angular 把文本改回英文了：允许重新翻译
        if (state.processed.has(target)) state.processed.delete(target);
        if (state.seen.has(target)) state.seen.delete(target);
        enqueue(target);
        continue;
      }

      if (rec.type === 'attributes' && rec.attributeName) {
        translateAttribute(rec.target, rec.attributeName);
      }
    }
  }

  function attachObserver(root) {
    if (!root) return;
    try {
      var obs = new MutationObserver(handleMutations);
      obs.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS
      });
      state.observers.push(obs);
    } catch (e) { /* ignore */ }
  }

  function observeRoot(root) {
    if (!root || state.observedRoots.has(root)) return;
    state.observedRoots.add(root);
    attachObserver(root);
  }

  function startObserving() {
    if (!state.running) return;
    if (state.observers.length === 0) attachObserver(document.documentElement);
    if (document.body) scanShadowRoots(document.body);
  }

  function stopObserving() {
    state.observers.forEach(function (o) {
      try { o.disconnect(); } catch (e) { /* ignore */ }
    });
    state.observers = [];
  }

  /* ---------------- 悬停看原文 ---------------- */

  function ensureTip() {
    var tip = document.getElementById('aiz-orig-tip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'aiz-orig-tip';
    tip.className = 'aiz-orig-tip';
    tip.setAttribute('role', 'tooltip');
    (document.body || document.documentElement).appendChild(tip);
    return tip;
  }

  function onHover(e) {
    if (!state.settings.hoverOriginal || !state.settings.enabled) return;
    var target = e.target;
    if (!target || target.nodeType !== 1) return;
    var el = target.closest ? target.closest('[data-aiz-orig]') : null;
    var tip = document.getElementById('aiz-orig-tip');
    if (!el) {
      if (tip) tip.classList.remove('aiz-visible');
      return;
    }
    var orig = el.getAttribute('data-aiz-orig');
    if (!orig) return;
    tip = ensureTip();
    tip.textContent = orig;
    tip.classList.add('aiz-visible');

    var rect = el.getBoundingClientRect();
    var top = rect.top - 34;
    if (top < 8) top = rect.bottom + 8;
    tip.style.top = Math.max(8, top) + 'px';
    tip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 320)) + 'px';
  }

  function onHoverOut(e) {
    if (!state.settings.hoverOriginal) return;
    var tip = document.getElementById('aiz-orig-tip');
    if (!tip) return;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-aiz-orig]')) return;
    tip.classList.remove('aiz-visible');
  }

  function bindHover() {
    if (state.hoverBound) return;
    state.hoverBound = true;
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('mouseout', onHoverOut, true);
  }

  /* ---------------- 持久化 ---------------- */

  function schedulePersist() {
    if (state.persistTimer) return;
    state.persistTimer = setTimeout(function () {
      state.persistTimer = 0;
      persist();
    }, 2500);
  }

  function persist() {
    if (typeof state.onPersist !== 'function') return;
    try {
      state.onPersist({
        unmatched: state.unmatched,
        translated: state.translated,
        unique: state.unique.size,
        url: location.href
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 生命周期 ---------------- */

  function translateAll() {
    state.queue.length = 0;
    state.translated = 0;
    state.unique = new Set();
    scan(document.documentElement);
    if (state.settings.translateAttrs) scanAttributes(document);
    translateTitle();
    schedulePersist();
  }

  function applyHighlight() {
    document.documentElement.classList.toggle('aiz-hl', !!state.settings.highlight);
  }

  function start() {
    if (state.running && state.enabled) return;
    state.enabled = true;
    state.running = true;
    document.documentElement.setAttribute('data-aiz-active', '1');
    state.observedRoots = new WeakSet();
    state.observers = [];
    attachObserver(document.documentElement);
    bindHover();
    applyHighlight();
    translateAll();
  }

  function stop() {
    state.enabled = false;
    state.running = false;
    document.documentElement.removeAttribute('data-aiz-active');
    stopObserving();
    restoreAll();
  }

  function retranslate() {
    restoreAll();
    if (!state.running) start();
    else translateAll();
  }

  function setSettings(next) {
    var prev = state.settings;
    state.settings = Object.assign({}, DEFAULT_SETTINGS, next || {});
    buildSkipSelectors();
    buildIndex();

    if (state.settings.hoverOriginal) bindHover();

    var enabledChanged = !!prev.enabled !== !!state.settings.enabled;
    var patternsChanged = JSON.stringify(prev.extraPatterns || []) !== JSON.stringify(state.settings.extraPatterns || []);
    var skipChanged = JSON.stringify(prev.extraSkipSelectors || []) !== JSON.stringify(state.settings.extraSkipSelectors || []);
    var attrsChanged = !!prev.translateAttrs !== !!state.settings.translateAttrs;

    if (!state.settings.enabled) {
      if (state.running) stop();
      applyHighlight();
      return;
    }

    if (!state.running) {
      start();
      return;
    }

    applyHighlight();

    if (enabledChanged || patternsChanged || skipChanged) {
      retranslate();
    } else if (attrsChanged && state.settings.translateAttrs) {
      scanAttributes(document);
    }
  }

  function setCustomDict(dict) {
    state.custom = dict && typeof dict === 'object' ? dict : {};
    buildIndex();
    if (state.running && state.enabled) retranslate();
  }

  function init(options) {
    options = options || {};
    state.builtin = window.__AIZ_DICT__ && typeof window.__AIZ_DICT__ === 'object'
      ? Object.assign({}, window.__AIZ_DICT__)
      : {};
    state.custom = options.customDict || {};
    state.settings = Object.assign({}, DEFAULT_SETTINGS, options.settings || {});
    state.unmatched = options.unmatched && typeof options.unmatched === 'object' ? options.unmatched : {};
    state.onPersist = options.onPersist || null;

    buildSkipSelectors();
    buildIndex();

    if (state.settings.enabled) start();
    else applyHighlight();

    // SPA 路由变化：AI Studio 是 Angular 单页应用，切换页面不会刷新文档
    state.urlTimer = setInterval(function () {
      if (location.href === state.url) return;
      state.url = location.href;
      if (!state.running || !state.enabled) return;
      setTimeout(function () { if (state.enabled) scan(document.body); }, 350);
      setTimeout(function () {
        if (!state.enabled) return;
        scan(document.body);
        translateTitle();
      }, 1400);
      setTimeout(function () {
        if (state.enabled && state.settings.translateAttrs) scanAttributes(document);
      }, 1600);
    }, 800);

    window.addEventListener('popstate', function () {
      setTimeout(function () { if (state.enabled) scan(document.body); }, 500);
    });

    return api;
  }

  var api = {
    version: ENGINE_VERSION,
    init: init,
    setSettings: setSettings,
    setCustomDict: setCustomDict,
    retranslate: retranslate,
    translateAll: function () { translateAll(); return state.translated; },
    restore: function () { stop(); },
    start: start,
    stats: function () {
      return {
        enabled: state.enabled,
        translated: state.translated,
        unique: state.unique.size,
        dictSize: Object.keys(state.builtin).length,
        customSize: Object.keys(state.custom).length,
        unmatchedCount: Object.keys(state.unmatched).length,
        unmatched: Object.keys(state.unmatched),
        url: location.href,
        version: ENGINE_VERSION
      };
    },
    getSettings: function () { return Object.assign({}, state.settings); },
    getUnmatched: function () { return Object.assign({}, state.unmatched); }
  };

  window.__AIZ_ENGINE__ = api;
})();
