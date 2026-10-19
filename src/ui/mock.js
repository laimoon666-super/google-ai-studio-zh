/* ==========================================================================
   Google AI Studio 汉化插件 · UI 共享运行时 + 预览模式 mock
   --------------------------------------------------------------------------
   本文件被 popup.html / options.html 以 <script defer> 方式在页面脚本之前加载：

   1) 共享工具：window.AIZ = { Store, esc, toast, confirm, prompt, choice, ... }
      - 所有 chrome.storage.local 读写都经 Store，默认值与 CONTRACT §4 一致；
      - 消息封装统一做超时降级，扩展未安装 / 背景页休眠时页面不会卡死。
   2) 预览模式：当 `chrome.storage.local` 不存在（file:// 直接打开 HTML）时，
      用内存 + localStorage 覆盖 chrome 对象，并插入一条淡色提示条，
      让 popup / options 可以脱离扩展环境独立预览。
      真实扩展环境下不会安装 mock，也不会出现提示条。
   ========================================================================== */

(function () {
  'use strict';

  const AIZ = (globalThis.AIZ = globalThis.AIZ || {});

  /* ------------------------------------------------------------------------
     常量
     ---------------------------------------------------------------------- */

  const VERSION_FALLBACK = '1.0.0';
  const SCHEMA = 1;

  const KEYS = Object.freeze({
    settings: 'aiz.settings',
    customDict: 'aiz.customDict',
    unmatched: 'aiz.unmatched',
    stats: 'aiz.stats',
    schema: 'aiz.schema'
  });

  const ALL_KEYS = Object.freeze([
    KEYS.settings,
    KEYS.customDict,
    KEYS.unmatched,
    KEYS.stats,
    KEYS.schema
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    forceEnglish: true,
    highlight: false,
    hoverOriginal: false,
    translateAttrs: true,
    collectUnmatched: true,
    extraSkipSelectors: [],
    /* 任务书要求的扩展字段：用户自定义正则替换规则（CONTRACT 未列出，缺省为空数组） */
    extraPatterns: []
  });

  const BOOLEAN_KEYS = [
    'enabled',
    'forceEnglish',
    'highlight',
    'hoverOriginal',
    'translateAttrs',
    'collectUnmatched'
  ];

  const FLAG_RE = /^[gimsuy]*$/;
  const MAX_SELECTORS = 200;
  const MAX_PATTERNS = 200;

  /* ------------------------------------------------------------------------
     纯工具函数
     ---------------------------------------------------------------------- */

  const ESC_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  /** HTML 转义：所有拼进 innerHTML 的用户数据都必须经过它 */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (ch) => ESC_MAP[ch]
    );
  }

  function clone(value) {
    if (value === null || value === undefined) return value;
    if (typeof globalThis.structuredClone === 'function') {
      try {
        return globalThis.structuredClone(value);
      } catch (err) {
        /* 含不可克隆值时退回 JSON */
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return value;
    }
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (fallback === undefined) {
          reject(new Error('操作超时'));
        } else {
          resolve(typeof fallback === 'function' ? fallback() : fallback);
        }
      }, ms);
      Promise.resolve(promise).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function debounce(fn, wait) {
    let timer = null;
    const wrapped = function () {
      const args = arguments;
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(self, args);
      }, wait);
    };
    wrapped.cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    return wrapped;
  }

  function pad2(num) {
    return String(num).padStart(2, '0');
  }

  function formatTime(ts) {
    const time = Number(ts);
    if (!Number.isFinite(time) || time <= 0) return '—';
    const d = new Date(time);
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate()) +
      ' ' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes())
    );
  }

  function formatRelative(ts) {
    const time = Number(ts);
    if (!Number.isFinite(time) || time <= 0) return '—';
    const diff = Date.now() - time;
    if (diff < 0) return formatTime(time);
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    return formatTime(time);
  }

  function stamp(date) {
    const d = date instanceof Date ? date : new Date();
    return (
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) +
      '-' +
      pad2(d.getHours()) +
      pad2(d.getMinutes())
    );
  }

  function prettyBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size < 1024) return Math.round(size) + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1024 / 1024).toFixed(2) + ' MB';
  }

  function byteLength(text) {
    try {
      return new Blob([String(text)]).size;
    } catch (err) {
      return String(text).length;
    }
  }

  function hostOf(url) {
    try {
      return new URL(String(url)).host;
    } catch (err) {
      return '';
    }
  }

  function pathOf(url) {
    try {
      const parsed = new URL(String(url));
      return parsed.pathname + parsed.search;
    } catch (err) {
      return String(url || '');
    }
  }

  function isAistudioUrl(url) {
    const host = hostOf(url).toLowerCase();
    return host === 'aistudio.google.com' || host.endsWith('.aistudio.google.com');
  }

  function versionFromManifest() {
    try {
      const version = globalThis.chrome?.runtime?.getManifest?.()?.version;
      return version || VERSION_FALLBACK;
    } catch (err) {
      return VERSION_FALLBACK;
    }
  }

  function readFileText(file) {
    if (!file) return Promise.reject(new Error('未选择文件'));
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  }

  function download(filename, text, mime) {
    const type = mime || 'application/json;charset=utf-8';
    const blob = new Blob([String(text)], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    const value = String(text);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (err) {
        /* 退回到 execCommand */
      }
    }
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    area.remove();
    if (!ok) throw new Error('浏览器拒绝了剪贴板写入，请手动复制');
    return true;
  }

  /* ------------------------------------------------------------------------
     Toast
     ---------------------------------------------------------------------- */

  function toast(message, kind) {
    if (!document.body) return null;
    let stack = document.querySelector('.aiz-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'aiz-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-atomic', 'false');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'aiz-toast' + (kind ? ' aiz-toast--' + kind : '');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = String(message === null || message === undefined ? '' : message);
    stack.appendChild(el);
    while (stack.children.length > 4) {
      stack.firstElementChild.remove();
    }
    setTimeout(() => {
      el.classList.add('aiz-toast--out');
      setTimeout(() => el.remove(), 220);
    }, 2000);
    return el;
  }

  /* ------------------------------------------------------------------------
     模态框
     ---------------------------------------------------------------------- */

  function trapFocus(event, container) {
    const focusables = Array.from(
      container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * 打开一个模态框。
   * @param {object} options { title, message, body, actions:[{label,className,value,onClick,autofocus}], cancelValue, allowBackdropClose }
   * @returns {Promise<any>} resolve 的值为 action.value（若为函数则取其返回值），取消时为 cancelValue
   */
  function openModal(options) {
    const opts = options || {};
    const cancelValue = Object.prototype.hasOwnProperty.call(opts, 'cancelValue')
      ? opts.cancelValue
      : null;

    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'aiz-modal-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'aiz-modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'aizModalTitle');
      dialog.innerHTML =
        '<h2 class="aiz-modal__title" id="aizModalTitle">' +
        esc(opts.title || '请确认') +
        '</h2>' +
        (opts.message ? '<p class="aiz-modal__message">' + esc(opts.message) + '</p>' : '') +
        '<div class="aiz-modal__body"></div>' +
        '<div class="aiz-modal__actions"></div>';

      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const body = dialog.querySelector('.aiz-modal__body');
      if (opts.body) body.appendChild(opts.body);
      if (!body.childElementCount) body.remove();

      let closed = false;
      let firstFocus = null;

      const focusable = () =>
        Array.from(
          dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

      const close = (value) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        dialog.removeEventListener('click', onClick);
        backdrop.remove();
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try {
            previousFocus.focus();
          } catch (err) {
            /* ignore */
          }
        }
        resolve(typeof value === 'function' ? value() : value);
      };

      function onKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(cancelValue);
          return;
        }
        if (event.key === 'Tab') {
          trapFocus(event, dialog);
        }
      }

      function onClick(event) {
        const direct = event.target.closest('[data-modal-close]');
        if (direct && dialog.contains(direct)) {
          close(direct.getAttribute('data-modal-close'));
          return;
        }
        if (event.target === backdrop && opts.allowBackdropClose !== false) {
          close(cancelValue);
        }
      }

      const actionsEl = dialog.querySelector('.aiz-modal__actions');
      (opts.actions || []).forEach((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'aiz-btn ' + (action.className || 'aiz-btn--ghost');
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
          if (typeof action.onClick === 'function') {
            const shouldClose = action.onClick(btn);
            if (shouldClose === false) return;
          }
          close(action.value);
        });
        actionsEl.appendChild(btn);
        if (action.autofocus) firstFocus = btn;
      });

      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', onClick);

      const initial = firstFocus || focusable()[0] || null;
      if (initial) {
        setTimeout(() => {
          try {
            initial.focus();
          } catch (err) {
            /* ignore */
          }
        }, 30);
      }
    });
  }

  function confirmDialog(options) {
    const opts = Object.assign(
      {
        title: '确认操作',
        message: '',
        okText: '确定',
        cancelText: '取消',
        danger: false
      },
      options || {}
    );
    return openModal({
      title: opts.title,
      message: opts.message,
      cancelValue: false,
      allowBackdropClose: true,
      actions: [
        {
          label: opts.cancelText,
          className: 'aiz-btn--ghost',
          value: false,
          autofocus: opts.danger
        },
        {
          label: opts.okText,
          className: opts.danger ? 'aiz-btn--danger' : 'aiz-btn--primary',
          value: true,
          autofocus: !opts.danger
        }
      ]
    });
  }

  function promptDialog(options) {
    const opts = Object.assign(
      {
        title: '输入内容',
        message: '',
        label: '输入',
        placeholder: '',
        hint: '',
        confirmText: '确定',
        cancelText: '取消',
        requiredValue: '',
        danger: false
      },
      options || {}
    );

    const body = document.createElement('div');
    const field = document.createElement('label');
    field.className = 'aiz-field';
    const labelText = document.createElement('span');
    labelText.textContent = opts.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'aiz-input';
    input.placeholder = opts.placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    field.appendChild(labelText);
    field.appendChild(input);
    body.appendChild(field);

    if (opts.requiredValue) {
      const note = document.createElement('p');
      note.className = 'aiz-modal__note';
      note.id = 'aizPromptHint';
      note.textContent =
        '此操作不可撤销，请输入 ' + opts.requiredValue + ' 以继续。';
      body.appendChild(note);
      input.setAttribute('aria-describedby', note.id);
    } else if (opts.hint) {
      const note = document.createElement('p');
      note.className = 'aiz-modal__note';
      note.textContent = opts.hint;
      body.appendChild(note);
    }

    return openModal({
      title: opts.title,
      message: opts.message,
      body,
      cancelValue: null,
      actions: [
        { label: opts.cancelText, className: 'aiz-btn--ghost', value: null },
        {
          label: opts.confirmText,
          className: opts.danger ? 'aiz-btn--danger' : 'aiz-btn--primary',
          autofocus: true,
          value: () => input.value.trim(),
          onClick: () => {
            const value = input.value.trim();
            if (!value) {
              input.setAttribute('aria-invalid', 'true');
              input.focus();
              return false;
            }
            if (opts.requiredValue && value !== opts.requiredValue) {
              input.setAttribute('aria-invalid', 'true');
              input.focus();
              toast('请输入 ' + opts.requiredValue + ' 以确认', 'error');
              return false;
            }
            input.removeAttribute('aria-invalid');
            return true;
          }
        }
      ]
    });
  }

  function choiceDialog(options) {
    const opts = Object.assign(
      {
        title: '请选择',
        message: '',
        choices: [],
        cancelText: '取消'
      },
      options || {}
    );
    const body = document.createElement('div');
    body.className = 'aiz-modal__choices';
    (opts.choices || []).forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'aiz-modal__choice' + (choice.primary ? ' aiz-modal__choice--primary' : '');
      btn.setAttribute('data-modal-close', String(choice.value));
      btn.innerHTML =
        '<strong>' +
        esc(choice.label) +
        '</strong>' +
        (choice.description ? '<span>' + esc(choice.description) + '</span>' : '');
      body.appendChild(btn);
    });
    return openModal({
      title: opts.title,
      message: opts.message,
      body,
      cancelValue: null,
      actions: [{ label: opts.cancelText, className: 'aiz-btn--ghost', value: null }]
    });
  }

  /* ------------------------------------------------------------------------
     设置 / 词典数据规范化
     ---------------------------------------------------------------------- */

  function normalizeSelectors(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const value = item.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= MAX_SELECTORS) break;
    }
    return out;
  }

  function normalizePatterns(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const re = typeof item.re === 'string' ? item.re.trim() : '';
      if (!re) continue;
      let flags = typeof item.flags === 'string' ? item.flags.trim() : '';
      if (!FLAG_RE.test(flags)) {
        flags = flags
          .split('')
          .filter((ch) => 'gimsuy'.includes(ch))
          .join('');
      }
      const to = typeof item.to === 'string' ? item.to : '';
      const note = typeof item.note === 'string' ? item.note.trim() : '';
      out.push({ re, flags, to, note });
      if (out.length >= MAX_PATTERNS) break;
    }
    return out;
  }

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of BOOLEAN_KEYS) {
      out[key] = typeof src[key] === 'boolean' ? src[key] : DEFAULT_SETTINGS[key];
    }
    out.extraSkipSelectors = normalizeSelectors(src.extraSkipSelectors);
    out.extraPatterns = normalizePatterns(src.extraPatterns);
    return out;
  }

  function sanitizeDict(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    let count = 0;
    for (const [key, value] of Object.entries(src)) {
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      const en = key.trim();
      const zh = value.trim();
      if (!en || !zh) continue;
      out[en] = zh;
      count += 1;
      if (count >= 5000) break;
    }
    return out;
  }

  function sanitizeUnmatched(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    let count = 0;
    for (const [key, value] of Object.entries(src)) {
      if (typeof key !== 'string') continue;
      const en = key.trim();
      if (!en) continue;
      const num = Math.floor(Number(value));
      out[en] = Number.isFinite(num) && num > 0 ? num : 1;
      count += 1;
      if (count >= 5000) break;
    }
    return out;
  }

  function sanitizeStats(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const translated = Math.max(0, Math.floor(Number(src.translated) || 0));
    const at = Math.max(0, Number(src.at) || 0);
    const url = typeof src.url === 'string' ? src.url : '';
    return { translated, at, url };
  }

  /* ------------------------------------------------------------------------
     chrome.storage.local 封装（Promise + 回调双兼容）
     ---------------------------------------------------------------------- */

  function chromeStorageLocal() {
    return globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local;
  }

  function storageError(err) {
    const message = err && err.message ? err.message : String(err);
    return new Error('本地存储不可用：' + message);
  }

  async function storageGet(keys) {
    const api = chromeStorageLocal();
    if (!api || typeof api.get !== 'function') throw storageError('chrome.storage.local 缺失');
    try {
      const maybe = api.get(keys);
      if (maybe && typeof maybe.then === 'function') return (await maybe) || {};
    } catch (err) {
      /* 回退到回调风格 */
    }
    return new Promise((resolve, reject) => {
      try {
        api.get(keys, (result) => {
          const lastError = globalThis.chrome?.runtime?.lastError;
          if (lastError) reject(storageError(lastError));
          else resolve(result || {});
        });
      } catch (err) {
        reject(storageError(err));
      }
    });
  }

  async function storageSet(items) {
    const api = chromeStorageLocal();
    if (!api || typeof api.set !== 'function') throw storageError('chrome.storage.local 缺失');
    try {
      const maybe = api.set(items);
      if (maybe && typeof maybe.then === 'function') {
        await maybe;
        return;
      }
    } catch (err) {
      /* 回退到回调风格 */
    }
    await new Promise((resolve, reject) => {
      try {
        api.set(items, () => {
          const lastError = globalThis.chrome?.runtime?.lastError;
          if (lastError) reject(storageError(lastError));
          else resolve();
        });
      } catch (err) {
        reject(storageError(err));
      }
    });
  }

  async function storageRemove(keys) {
    const api = chromeStorageLocal();
    if (!api || typeof api.remove !== 'function') throw storageError('chrome.storage.local 缺失');
    try {
      const maybe = api.remove(keys);
      if (maybe && typeof maybe.then === 'function') {
        await maybe;
        return;
      }
    } catch (err) {
      /* 回退到回调风格 */
    }
    await new Promise((resolve, reject) => {
      try {
        api.remove(keys, () => {
          const lastError = globalThis.chrome?.runtime?.lastError;
          if (lastError) reject(storageError(lastError));
          else resolve();
        });
      } catch (err) {
        reject(storageError(err));
      }
    });
  }

  /* ------------------------------------------------------------------------
     Store：UI 唯一的数据入口
     ---------------------------------------------------------------------- */

  const Store = {
    keys: KEYS,
    defaults: DEFAULT_SETTINGS,

    async getSettings() {
      const result = await storageGet(KEYS.settings);
      return normalizeSettings(result[KEYS.settings]);
    },

    async setSettings(patch) {
      const current = await this.getSettings();
      const next = normalizeSettings(Object.assign({}, current, patch || {}));
      await storageSet({ [KEYS.settings]: next, [KEYS.schema]: SCHEMA });
      return next;
    },

    async getCustomDict() {
      const result = await storageGet(KEYS.customDict);
      return sanitizeDict(result[KEYS.customDict]);
    },

    async setCustomDict(dict) {
      const next = sanitizeDict(dict);
      await storageSet({ [KEYS.customDict]: next, [KEYS.schema]: SCHEMA });
      return next;
    },

    async getUnmatched() {
      const result = await storageGet(KEYS.unmatched);
      return sanitizeUnmatched(result[KEYS.unmatched]);
    },

    async setUnmatched(map) {
      const next = sanitizeUnmatched(map);
      await storageSet({ [KEYS.unmatched]: next, [KEYS.schema]: SCHEMA });
      return next;
    },

    async getStats() {
      const result = await storageGet(KEYS.stats);
      return sanitizeStats(result[KEYS.stats]);
    },

    async setStats(stats) {
      const next = sanitizeStats(stats);
      await storageSet({ [KEYS.stats]: next, [KEYS.schema]: SCHEMA });
      return next;
    },

    async getAll() {
      const result = await storageGet(ALL_KEYS);
      return {
        settings: normalizeSettings(result[KEYS.settings]),
        customDict: sanitizeDict(result[KEYS.customDict]),
        unmatched: sanitizeUnmatched(result[KEYS.unmatched]),
        stats: sanitizeStats(result[KEYS.stats]),
        schema: Number.isFinite(Number(result[KEYS.schema]))
          ? Number(result[KEYS.schema])
          : SCHEMA
      };
    },

    async clearAll() {
      await storageRemove(ALL_KEYS);
    },

    /** 监听扩展内任何页面写入的 aiz.* 变更，返回取消订阅函数 */
    onChanged(listener) {
      const storage = globalThis.chrome && globalThis.chrome.storage;
      if (!storage || !storage.onChanged || typeof listener !== 'function') {
        return () => {};
      }
      const handler = (changes, areaName) => {
        if (areaName && areaName !== 'local') return;
        const names = Object.keys(changes || {}).filter((key) => ALL_KEYS.includes(key));
        if (names.length) listener(changes, names);
      };
      storage.onChanged.addListener(handler);
      return () => {
        try {
          storage.onChanged.removeListener(handler);
        } catch (err) {
          /* ignore */
        }
      };
    }
  };

  /* ------------------------------------------------------------------------
     消息封装
     ---------------------------------------------------------------------- */

  function chromeRuntime() {
    return globalThis.chrome && globalThis.chrome.runtime;
  }

  async function sendRuntime(message) {
    const runtime = chromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      throw new Error('扩展运行时不可用');
    }
    try {
      const maybe = runtime.sendMessage(message);
      if (maybe && typeof maybe.then === 'function') return await maybe;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    return new Promise((resolve, reject) => {
      try {
        runtime.sendMessage(message, (response) => {
          const lastError = runtime.lastError;
          if (lastError) reject(new Error(lastError.message || '消息发送失败'));
          else resolve(response);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async function getActiveTab() {
    const tabs = globalThis.chrome && globalThis.chrome.tabs;
    if (!tabs || typeof tabs.query !== 'function') return null;
    try {
      const maybe = tabs.query({ active: true, currentWindow: true });
      let list;
      if (maybe && typeof maybe.then === 'function') list = await maybe;
      else {
        list = await new Promise((resolve, reject) => {
          try {
            tabs.query({ active: true, currentWindow: true }, (result) => {
              const lastError = chromeRuntime()?.lastError;
              if (lastError) reject(new Error(lastError.message));
              else resolve(result);
            });
          } catch (err) {
            reject(err);
          }
        });
      }
      return Array.isArray(list) && list.length ? list[0] : null;
    } catch (err) {
      return null;
    }
  }

  async function sendTab(message, tabId) {
    const tabs = globalThis.chrome && globalThis.chrome.tabs;
    if (!tabs || typeof tabs.sendMessage !== 'function') {
      throw new Error('chrome.tabs 不可用');
    }
    let id = tabId;
    if (id === null || id === undefined) {
      const tab = await getActiveTab();
      if (!tab || tab.id === null || tab.id === undefined) {
        throw new Error('没有可用的活动标签页');
      }
      id = tab.id;
    }
    try {
      const maybe = tabs.sendMessage(id, message);
      if (maybe && typeof maybe.then === 'function') return await maybe;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    return new Promise((resolve, reject) => {
      try {
        tabs.sendMessage(id, message, (response) => {
          const lastError = chromeRuntime()?.lastError;
          if (lastError) reject(new Error(lastError.message || '内容脚本未响应'));
          else resolve(response);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async function getMeta() {
    const fallback = {
      ok: true,
      version: versionFromManifest(),
      dictCount: null,
      builtinDictSize: null,
      source: 'fallback'
    };
    try {
      const res = await withTimeout(sendRuntime({ type: 'AIZ_GET_META' }), 1500);
      if (res && res.ok) return Object.assign({}, fallback, res, { source: 'background' });
    } catch (err) {
      /* 背景页未启动 / 非扩展环境：使用兜底值 */
    }
    return fallback;
  }

  /**
   * 可选扩展消息：向后台请求内置词典 / 内置正则的只读快照。
   * CONTRACT §4 未定义该消息；后台未实现时返回 null，页面自动退化为「仅统计数量」。
   */
  async function getSnapshot() {
    try {
      const res = await withTimeout(sendRuntime({ type: 'AIZ_GET_SNAPSHOT' }), 1200);
      if (res && res.ok) return res;
    } catch (err) {
      /* 未实现 / 无接收方：静默降级 */
    }
    return null;
  }

  async function retranslate(tabId) {
    return sendTab({ type: 'AIZ_RETRANSLATE' }, tabId);
  }

  async function clearMarks(tabId) {
    return sendTab({ type: 'AIZ_CLEAR_MARKS' }, tabId);
  }

  async function applySettings(tabId) {
    return sendTab({ type: 'AIZ_APPLY_SETTINGS' }, tabId);
  }

  async function openOptions() {
    try {
      const res = await withTimeout(sendRuntime({ type: 'AIZ_OPEN_OPTIONS' }), 900);
      if (res && res.ok) return;
    } catch (err) {
      /* 后台未响应，走下面的兜底 */
    }
    const runtime = chromeRuntime();
    if (runtime && typeof runtime.openOptionsPage === 'function') {
      try {
        runtime.openOptionsPage();
        return;
      } catch (err) {
        /* ignore */
      }
    }
    window.location.assign(new URL('../options/options.html', window.location.href).href);
  }

  /* ------------------------------------------------------------------------
     预览模式：mock 数据
     ---------------------------------------------------------------------- */

  const VOLUME_LABELS = Object.freeze({
    common: '_common.js · 通用',
    playground: 'playground.js · 对话实验室',
    build: 'build.js · 构建',
    manage: 'manage.js · 管理',
    custom: '自定义（本地）'
  });

  const MOCK_BUILTIN_DICT = [
    /* _common.js */
    ['Settings', '设置', 'common'],
    ['Save', '保存', 'common'],
    ['Cancel', '取消', 'common'],
    ['Close', '关闭', 'common'],
    ['Done', '完成', 'common'],
    ['Delete', '删除', 'common'],
    ['Copy', '复制', 'common'],
    ['Retry', '重试', 'common'],
    ['Download', '下载', 'common'],
    ['Upload', '上传', 'common'],
    ['Search', '搜索', 'common'],
    ['Share', '分享', 'common'],
    ['Learn more', '了解更多', 'common'],
    ['Advanced settings', '高级设置', 'common'],
    ['API key', 'API 密钥', 'common'],
    ['Account', '账号', 'common'],
    ['Documentation', '文档', 'common'],
    ['Dashboard', '控制台', 'common'],
    ['History', '历史记录', 'common'],
    ['Gallery', '应用广场', 'common'],
    ['New app', '新建应用', 'common'],
    ['My apps', '我的应用', 'common'],
    ['Build', '构建', 'common'],
    ['Model', '模型', 'common'],
    ['Token', 'Token', 'common'],
    ['Credits', '赠金', 'common'],
    ['Feedback', '反馈', 'common'],
    ['Report a problem', '报告问题', 'common'],
    ['Terms of service', '服务条款', 'common'],
    ['Privacy policy', '隐私权政策', 'common'],
    ['Your settings', '你的设置', 'common'],
    ['Theme', '主题', 'common'],
    ['Language', '语言', 'common'],
    ['Clear', '清空', 'common'],

    /* playground.js */
    ['Playground', '对话实验室', 'playground'],
    ['Run', '运行', 'playground'],
    ['Run settings', '运行设置', 'playground'],
    ['System instructions', '系统指令', 'playground'],
    ['Thinking level', '思考等级', 'playground'],
    ['Thinking budget', '思考预算', 'playground'],
    ['Structured outputs', '结构化输出', 'playground'],
    ['Code execution', '代码执行', 'playground'],
    ['Function calling', '函数调用', 'playground'],
    ['Grounding with Google Search', 'Google 搜索接地', 'playground'],
    ['URL context', 'URL 上下文', 'playground'],
    ['Temperature', '温度', 'playground'],
    ['Top-P', 'Top-P', 'playground'],
    ['Top-K', 'Top-K', 'playground'],
    ['Max output tokens', '最大输出 Token 数', 'playground'],
    ['Stop sequence', '停止序列', 'playground'],
    ['Add stop sequence', '添加停止序列', 'playground'],
    ['Prompt', '提示词', 'playground'],
    ['Clear chat', '清空对话', 'playground'],
    ['Compare mode', '对比模式', 'playground'],
    ['Freeform', '自由格式', 'playground'],
    ['Chat', '对话', 'playground'],
    ['Response', '回复', 'playground'],
    ['Add files', '添加文件', 'playground'],
    ['Insert media', '插入媒体', 'playground'],
    ['Safety settings', '安全设置', 'playground'],
    ['Media resolution', '媒体分辨率', 'playground'],
    ['Seed', '随机种子', 'playground'],
    ['Aspect ratio', '宽高比', 'playground'],
    ['Voice', '语音', 'playground'],

    /* build.js */
    ['Get code', '获取代码', 'build'],
    ['API quickstart', 'API 快速入门', 'build'],
    ['Save to Drive', '保存到云端硬盘', 'build'],
    ['Deploy', '部署', 'build'],
    ['Model garden', '模型库', 'build'],
    ['Prompt gallery', '提示词广场', 'build'],
    ['Response schema', '响应结构', 'build'],
    ['Examples', '示例', 'build'],
    ['Use in new chat', '在新对话中使用', 'build'],
    ['Starter notebook', '入门 Notebook', 'build'],
    ['Import from Drive', '从云端硬盘导入', 'build'],
    ['Export as JSON', '导出为 JSON', 'build'],
    ['Save prompt', '保存提示词', 'build'],
    ['Show thinking', '显示思考过程', 'build'],
    ['Thinking summary', '思考摘要', 'build'],

    /* manage.js */
    ['API keys', 'API 密钥', 'manage'],
    ['Create API key', '创建 API 密钥', 'manage'],
    ['Usage', '用量', 'manage'],
    ['Quota', '配额', 'manage'],
    ['Billing', '计费', 'manage'],
    ['Project', '项目', 'manage'],
    ['Region', '区域', 'manage'],
    ['Activity', '活动', 'manage'],
    ['Members', '成员', 'manage'],
    ['Rate limits', '速率限制', 'manage'],
    ['Free tier', '免费层级', 'manage'],
    ['Model version', '模型版本', 'manage']
  ].map((row) => ({ en: row[0], zh: row[1], volume: row[2] }));

  const MOCK_PATTERNS = [
    {
      re: '^(\\d[\\d,]*)\\s+(tokens?)\\b',
      flags: 'i',
      to: '$1 Token',
      note: 'Token 计数统一为单位',
      builtin: true
    },
    {
      re: '^(\\d+)\\s*%\\s*used$',
      flags: 'i',
      to: '已使用 $1%',
      note: '配额百分比',
      builtin: true
    },
    {
      re: '^(\\d+)\\s+credits?\\b',
      flags: 'i',
      to: '$1 赠金',
      note: 'API 赠金',
      builtin: true
    },
    {
      re: '^(\\d+)\\s*RPM$',
      flags: 'i',
      to: '每分钟 $1 次',
      note: '每分钟请求数',
      builtin: true
    },
    {
      re: '^Show\\s+(\\d+)\\s+more$',
      flags: 'i',
      to: '再显示 $1 项',
      note: '列表展开按钮',
      builtin: true
    },
    {
      re: '^([A-Za-z][A-Za-z ]+)\\s+settings$',
      flags: '',
      to: '$1 设置',
      note: '通用「X settings」组合',
      builtin: true
    },
    {
      re: '^(\\d+)\\s+of\\s+(\\d+)$',
      flags: '',
      to: '第 $1 / 共 $2 项',
      note: '分页计数',
      builtin: true
    }
  ];

  const MOCK_CUSTOM_DICT = {
    'Prompt gallery': '提示词广场',
    'Response schema': '响应结构',
    'Save prompt': '保存提示词',
    'Show thinking': '显示思考过程',
    'Thinking summary': '思考摘要',
    /* 故意与内置词条重名，用于演示「自定义覆盖内置」 */
    'Run': '运行（自定义覆盖）'
  };

  const MOCK_UNMATCHED = {
    'Flexible thinking': 3,
    'Tune your model': 2,
    'Compare models': 1,
    'Vertex AI': 2,
    'Free tier': 1,
    'RPM': 2,
    'Safety filters': 1,
    'Model version': 1,
    'Preview model': 2,
    'Thinking level: High': 4,
    'Starter notebook': 1,
    'Import from Drive': 1,
    'Export as JSON': 2,
    'Aspect ratio: 16:9': 1,
    'Media resolution': 3,
    'Show 12 more': 2
  };

  const MOCK_CUSTOM_PATTERNS = [
    {
      re: '^Gemini\\s+([\\d.]+)\\s+(Pro|Flash)$',
      flags: 'i',
      to: 'Gemini $1 $2',
      note: '模型名保持原样，仅规范空格'
    },
    {
      re: '^(\\d+)\\s+credits?\\s+left$',
      flags: 'i',
      to: '剩余 $1 赠金',
      note: '剩余额度提示'
    }
  ];

  const MOCK_CUSTOM_SELECTORS = ['[data-aiz-skip]', '.prompt-editor'];

  /**
   * 预览模式下补齐内置词典 / 内置正则的全局变量。
   * 真实扩展里这些变量由 src/dict/*.js 与 src/core/patterns.js 静态注入，
   * 若文件已加载则完全不覆盖；只有 file:// 预览且文件缺失时才用演示数据兜底。
   */
  function seedMockGlobals() {
    const existingDict = globalThis.__AIZ_DICT__;
    if (
      !existingDict ||
      typeof existingDict !== 'object' ||
      Object.keys(existingDict).length === 0
    ) {
      const dict = {};
      MOCK_BUILTIN_DICT.forEach((entry) => {
        dict[entry.en] = entry.zh;
      });
      globalThis.__AIZ_DICT__ = dict;
    }

    if (!Array.isArray(globalThis.__AIZ_PATTERNS__) || globalThis.__AIZ_PATTERNS__.length === 0) {
      globalThis.__AIZ_PATTERNS__ = MOCK_PATTERNS.map((pattern) => {
        let re;
        try {
          re = new RegExp(pattern.re, pattern.flags);
        } catch (err) {
          re = /(?:)/;
        }
        return { re, to: pattern.to, note: pattern.note, sample: '' };
      });
    }
  }

  /* ------------------------------------------------------------------------
     预览模式：安装 mock
     ---------------------------------------------------------------------- */

  const MOCK_STATE = {
    installed: false,
    tabId: 7,
    tabUrl: 'https://aistudio.google.com/prompts/new_chat',
    translated: 214,
    retranslateTicks: 0,
    banner: null,
    api: null
  };

  function installMock() {
    if (MOCK_STATE.installed) return;

    const LS_PREFIX = 'aiz.mock.v1.';
    const memory = new Map();
    const listeners = [];

    function persist(key) {
      try {
        if (memory.has(key)) {
          window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(memory.get(key)));
        } else {
          window.localStorage.removeItem(LS_PREFIX + key);
        }
      } catch (err) {
        /* localStorage 不可用时仅保留内存态 */
      }
    }

    function hydrate() {
      try {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const fullKey = window.localStorage.key(i);
          if (!fullKey || !fullKey.startsWith(LS_PREFIX)) continue;
          const key = fullKey.slice(LS_PREFIX.length);
          const raw = window.localStorage.getItem(fullKey);
          if (raw === null) continue;
          try {
            memory.set(key, JSON.parse(raw));
          } catch (err) {
            /* 跳过损坏的演示数据 */
          }
        }
      } catch (err) {
        /* ignore */
      }
    }

    function seed() {
      const seedData = {
        [KEYS.schema]: SCHEMA,
        [KEYS.settings]: normalizeSettings(
          Object.assign({}, DEFAULT_SETTINGS, {
            extraSkipSelectors: MOCK_CUSTOM_SELECTORS,
            extraPatterns: MOCK_CUSTOM_PATTERNS
          })
        ),
        [KEYS.customDict]: clone(MOCK_CUSTOM_DICT),
        [KEYS.unmatched]: clone(MOCK_UNMATCHED),
        [KEYS.stats]: {
          translated: MOCK_STATE.translated,
          at: Date.now() - 42 * 60 * 1000,
          url: MOCK_STATE.tabUrl
        }
      };
      Object.keys(seedData).forEach((key) => {
        if (memory.has(key)) return;
        memory.set(key, seedData[key]);
        persist(key);
      });
    }

    hydrate();
    seed();
    seedMockGlobals();

    function emit(changes) {
      if (!Object.keys(changes).length) return;
      listeners.slice().forEach((fn) => {
        try {
          fn(clone(changes), 'local');
        } catch (err) {
          console.error('[AIZ mock] storage listener error', err);
        }
      });
    }

    function respond(callback, result) {
      if (typeof callback === 'function') {
        queueMicrotask(() => {
          try {
            callback(clone(result));
          } catch (err) {
            console.error('[AIZ mock] callback error', err);
          }
        });
        return undefined;
      }
      return Promise.resolve(clone(result));
    }

    function pick(keys) {
      const out = {};
      if (keys === null || keys === undefined) {
        memory.forEach((value, key) => {
          out[key] = clone(value);
        });
        return out;
      }
      if (typeof keys === 'string') {
        if (memory.has(keys)) out[keys] = clone(memory.get(keys));
        return out;
      }
      if (Array.isArray(keys)) {
        keys.forEach((key) => {
          if (typeof key === 'string' && memory.has(key)) out[key] = clone(memory.get(key));
        });
        return out;
      }
      if (typeof keys === 'object') {
        Object.keys(keys).forEach((key) => {
          out[key] = memory.has(key) ? clone(memory.get(key)) : clone(keys[key]);
        });
      }
      return out;
    }

    function writeItems(items, callback) {
      const changes = {};
      Object.keys(items || {}).forEach((key) => {
        const oldValue = memory.has(key) ? clone(memory.get(key)) : undefined;
        memory.set(key, clone(items[key]));
        persist(key);
        changes[key] = { oldValue, newValue: clone(items[key]) };
      });
      emit(changes);
      return respond(callback, undefined);
    }

    function removeKeys(keys, callback) {
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
      const changes = {};
      list.forEach((key) => {
        if (!memory.has(key)) return;
        changes[key] = { oldValue: clone(memory.get(key)), newValue: undefined };
        memory.delete(key);
        persist(key);
      });
      emit(changes);
      return respond(callback, undefined);
    }

    function clearAll(callback) {
      const changes = {};
      Array.from(memory.keys()).forEach((key) => {
        changes[key] = { oldValue: clone(memory.get(key)), newValue: undefined };
        memory.delete(key);
        persist(key);
      });
      emit(changes);
      return respond(callback, undefined);
    }

    function currentSettings() {
      return normalizeSettings(memory.get(KEYS.settings));
    }

    function currentUnmatched() {
      return sanitizeUnmatched(memory.get(KEYS.unmatched));
    }

    function updateStats(translated) {
      const stats = {
        translated: Math.max(0, Math.floor(Number(translated) || 0)),
        at: Date.now(),
        url: MOCK_STATE.tabUrl
      };
      memory.set(KEYS.stats, stats);
      persist(KEYS.stats);
      emit({ [KEYS.stats]: { oldValue: null, newValue: clone(stats) } });
    }

    function handleRuntimeMessage(message) {
      const type = message && message.type;
      if (type === 'AIZ_GET_META') {
        return {
          ok: true,
          version: VERSION_FALLBACK,
          dictCount: MOCK_BUILTIN_DICT.length,
          builtinDictSize: MOCK_BUILTIN_DICT.length,
          source: 'mock'
        };
      }
      if (type === 'AIZ_GET_SNAPSHOT') {
        return {
          ok: true,
          source: 'mock',
          volumes: VOLUME_LABELS,
          dict: clone(MOCK_BUILTIN_DICT),
          patterns: clone(MOCK_PATTERNS),
          generatedAt: Date.now()
        };
      }
      if (type === 'AIZ_OPEN_OPTIONS') {
        openOptionsPage();
        return { ok: true };
      }
      return undefined;
    }

    function handleTabMessage(message) {
      const type = message && message.type;
      if (!isAistudioUrl(MOCK_STATE.tabUrl)) {
        throw new Error('当前页面不是 AI Studio');
      }
      if (type === 'AIZ_GET_STATS') {
        return {
          ok: true,
          enabled: currentSettings().enabled,
          translated: MOCK_STATE.translated,
          unmatched: Object.keys(currentUnmatched()),
          version: VERSION_FALLBACK
        };
      }
      if (type === 'AIZ_RETRANSLATE') {
        MOCK_STATE.retranslateTicks += 1;
        MOCK_STATE.translated += 6 + (MOCK_STATE.retranslateTicks % 5);
        updateStats(MOCK_STATE.translated);
        return { ok: true, translated: MOCK_STATE.translated };
      }
      if (type === 'AIZ_CLEAR_MARKS') {
        return { ok: true };
      }
      if (type === 'AIZ_APPLY_SETTINGS') {
        return { ok: true };
      }
      return { ok: false, error: '未知消息类型' };
    }

    function openOptionsPage() {
      const target = new URL('../options/options.html', window.location.href).href;
      try {
        const opened = window.open(target, '_blank', 'noopener');
        if (opened) return;
      } catch (err) {
        /* popup 被拦截时退回当前标签 */
      }
      window.location.assign(target);
    }

    function changePage(url) {
      MOCK_STATE.tabUrl = url;
      updateBannerHost();
      window.dispatchEvent(
        new CustomEvent('aiz:mock-state', {
          detail: { url: MOCK_STATE.tabUrl, aistudio: isAistudioUrl(MOCK_STATE.tabUrl) }
        })
      );
    }

    function resetDemoData() {
      Array.from(memory.keys()).forEach((key) => {
        memory.delete(key);
        persist(key);
      });
      seed();
      try {
        window.location.reload();
      } catch (err) {
        /* ignore */
      }
    }

    const storageLocal = {
      get(keys, callback) {
        return respond(callback, pick(keys));
      },
      set(items, callback) {
        return writeItems(items, callback);
      },
      remove(keys, callback) {
        return removeKeys(keys, callback);
      },
      clear(callback) {
        return clearAll(callback);
      },
      QUOTA_BYTES: 10485760
    };

    const storage = {
      local: storageLocal,
      sync: storageLocal,
      onChanged: {
        addListener(fn) {
          if (typeof fn === 'function' && !listeners.includes(fn)) listeners.push(fn);
        },
        removeListener(fn) {
          const index = listeners.indexOf(fn);
          if (index >= 0) listeners.splice(index, 1);
        },
        hasListener(fn) {
          return listeners.includes(fn);
        }
      }
    };

    const runtime = {
      id: 'aiz-preview-mock',
      lastError: undefined,
      getManifest() {
        return {
          manifest_version: 3,
          name: 'Google AI Studio 汉化（预览模式）',
          version: VERSION_FALLBACK
        };
      },
      getURL(path) {
        return new URL(String(path), window.location.href).href;
      },
      sendMessage(message, callback) {
        const promise = Promise.resolve()
          .then(() => handleRuntimeMessage(message))
          .catch((err) => {
            runtime.lastError = { message: err.message };
            throw err;
          });
        if (typeof callback === 'function') {
          promise.then(
            (result) => {
              runtime.lastError = undefined;
              callback(result);
            },
            () => {
              callback(undefined);
              runtime.lastError = undefined;
            }
          );
          return undefined;
        }
        return promise;
      },
      openOptionsPage(callback) {
        openOptionsPage();
        if (typeof callback === 'function') queueMicrotask(() => callback());
      },
      onMessage: {
        addListener() {},
        removeListener() {},
        hasListener() {
          return false;
        }
      }
    };

    const tabs = {
      query(queryInfo, callback) {
        return respond(callback, [
          {
            id: MOCK_STATE.tabId,
            url: MOCK_STATE.tabUrl,
            title: isAistudioUrl(MOCK_STATE.tabUrl) ? 'Google AI Studio' : '示例页面',
            active: true,
            windowId: 1
          }
        ]);
      },
      sendMessage(tabId, message, callback) {
        const promise = Promise.resolve().then(() => handleTabMessage(message));
        if (typeof callback === 'function') {
          promise.then(
            (result) => {
              runtime.lastError = undefined;
              callback(result);
            },
            (err) => {
              runtime.lastError = { message: err.message };
              callback(undefined);
              runtime.lastError = undefined;
            }
          );
          return undefined;
        }
        return promise;
      }
    };

    globalThis.chrome = { storage, runtime, tabs };
    MOCK_STATE.installed = true;
    AIZ.isMock = true;

    MOCK_STATE.api = {
      getState() {
        return {
          tabUrl: MOCK_STATE.tabUrl,
          translated: MOCK_STATE.translated
        };
      },
      setTabUrl(url) {
        changePage(String(url));
      },
      useAistudio() {
        changePage('https://aistudio.google.com/prompts/new_chat');
      },
      useOtherSite() {
        changePage('https://example.com/');
      },
      resetData: resetDemoData,
      storage: {
        read() {
          return pick(null);
        }
      }
    };
    AIZ.mock = MOCK_STATE.api;

    function updateBannerHost() {
      const host = MOCK_STATE.banner && MOCK_STATE.banner.querySelector('[data-mock-host]');
      if (host) {
        host.textContent = isAistudioUrl(MOCK_STATE.tabUrl)
          ? '模拟页面：aistudio.google.com'
          : '模拟页面：example.com（非 AI Studio）';
      }
    }

    function mountBanner() {
      if (!document.body || document.getElementById('aizMockBanner')) return;
      const bar = document.createElement('div');
      bar.id = 'aizMockBanner';
      bar.className = 'aiz-preview-banner';
      bar.setAttribute('role', 'status');
      bar.innerHTML =
        '<span class="aiz-preview-banner__dot" aria-hidden="true"></span>' +
        '<span class="aiz-preview-banner__text">预览模式（mock）· 数据仅用于演示</span>' +
        '<span class="aiz-preview-banner__host" data-mock-host></span>' +
        '<span class="aiz-preview-banner__actions">' +
        '<button type="button" class="aiz-preview-banner__btn" data-mock-action="switch">切换模拟页面</button>' +
        '<button type="button" class="aiz-preview-banner__btn" data-mock-action="reset">重置演示数据</button>' +
        '</span>';
      bar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-mock-action]');
        if (!button) return;
        if (button.getAttribute('data-mock-action') === 'switch') {
          changePage(
            isAistudioUrl(MOCK_STATE.tabUrl)
              ? 'https://example.com/'
              : 'https://aistudio.google.com/prompts/new_chat'
          );
        } else {
          resetDemoData();
        }
      });
      document.body.insertBefore(bar, document.body.firstChild);
      MOCK_STATE.banner = bar;
      updateBannerHost();
    }

    if (document.body) mountBanner();
    else document.addEventListener('DOMContentLoaded', mountBanner, { once: true });
  }

  /* ------------------------------------------------------------------------
     启动：主题覆盖参数 + mock 检测
     ---------------------------------------------------------------------- */

  try {
    const theme = new URLSearchParams(window.location.search).get('theme');
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (err) {
    /* ignore */
  }

  const hasChromeStorage = Boolean(
    globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local
  );

  if (!hasChromeStorage) {
    installMock();
  } else {
    AIZ.isMock = false;
  }

  /* ------------------------------------------------------------------------
     导出
     ---------------------------------------------------------------------- */

  Object.assign(AIZ, {
    version: VERSION_FALLBACK,
    schema: SCHEMA,
    KEYS,
    DEFAULT_SETTINGS,
    VOLUME_LABELS,
    isMock: Boolean(AIZ.isMock),
    Store,
    esc,
    clone,
    debounce,
    withTimeout,
    formatTime,
    formatRelative,
    stamp,
    prettyBytes,
    byteLength,
    hostOf,
    pathOf,
    isAistudioUrl,
    versionFromManifest,
    readFileText,
    download,
    copyText,
    toast,
    openModal,
    confirm: confirmDialog,
    prompt: promptDialog,
    choice: choiceDialog,
    normalizeSettings,
    normalizeSelectors,
    normalizePatterns,
    sanitizeDict,
    sanitizeUnmatched,
    sanitizeStats,
    getMeta,
    getSnapshot,
    getActiveTab,
    sendTab,
    sendRuntime,
    retranslate,
    clearMarks,
    applySettings,
    openOptions
  });
})();
