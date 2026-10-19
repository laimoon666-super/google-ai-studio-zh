/* ============================================================
 * Google AI Studio 汉化助手 · 启动器
 * ------------------------------------------------------------
 * 负责：读设置 → 交给引擎 → 订阅存储变化 → 响应 popup 消息 → 上报统计
 * 设计成「没有 chrome.* 也能跑」：方便在页面里直接注入做自动化验收。
 * ============================================================ */
(function () {
  'use strict';

  var ENGINE = window.__AIZ_ENGINE__;
  if (!ENGINE) return;

  var VERSION = ENGINE.version || '1.0.0';

  var KEY = {
    settings: 'aiz.settings',
    custom: 'aiz.customDict',
    unmatched: 'aiz.unmatched',
    stats: 'aiz.stats',
    schema: 'aiz.schema'
  };

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

  var hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function mergeSettings(raw) {
    return Object.assign({}, DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
  }

  function safeGet(keys, cb) {
    if (!hasChrome) {
      cb({});
      return;
    }
    try {
      chrome.storage.local.get(keys, function (res) {
        cb(res || {});
      });
    } catch (e) {
      cb({});
    }
  }

  function safeSet(payload) {
    if (!hasChrome) return;
    try {
      chrome.storage.local.set(payload);
    } catch (e) { /* ignore */ }
  }

  function notifyBackground(payload) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
    try {
      chrome.runtime.sendMessage(payload, function () {
        // 读取 lastError，避免控制台报 "Unchecked runtime.lastError"
        void (chrome.runtime.lastError || null);
      });
    } catch (e) { /* ignore */ }
  }

  var persistPending = false;
  var lastPersistAt = 0;

  function persist(data) {
    var now = Date.now();
    // 最多每 2.5 秒落一次盘，避免高频写入
    if (persistPending || now - lastPersistAt < 2500) return;
    persistPending = true;
    lastPersistAt = now;

    setTimeout(function () {
      persistPending = false;
    }, 2500);

    safeGet([KEY.unmatched], function (res) {
      var stored = res[KEY.unmatched] && typeof res[KEY.unmatched] === 'object' ? res[KEY.unmatched] : {};
      var incoming = data && data.unmatched ? data.unmatched : {};
      Object.keys(incoming).forEach(function (k) {
        stored[k] = Math.max(Number(stored[k]) || 0, Number(incoming[k]) || 0);
      });

      var stats = ENGINE.stats();
      safeSet({
        'aiz.unmatched': stored,
        'aiz.stats': {
          translated: stats.translated,
          unique: stats.unique,
          dictSize: stats.dictSize,
          unmatchedCount: Object.keys(stored).length,
          url: location.href,
          at: Date.now()
        }
      });

      notifyBackground({
        type: 'AIZ_STATS',
        translated: stats.translated,
        dictSize: stats.dictSize,
        unmatchedCount: Object.keys(stored).length,
        url: location.href
      });
    });
  }

  function boot() {
    safeGet([KEY.settings, KEY.custom, KEY.unmatched, KEY.schema], function (res) {
      var settings = mergeSettings(res[KEY.settings]);
      var custom = res[KEY.custom] && typeof res[KEY.custom] === 'object' ? res[KEY.custom] : {};
      var unmatched = res[KEY.unmatched] && typeof res[KEY.unmatched] === 'object' ? res[KEY.unmatched] : {};

      // 首次运行：补齐默认值，方便设置页与后续版本迁移
      if (!hasChrome || res[KEY.schema] !== 1) {
        safeSet({ 'aiz.schema': 1, 'aiz.settings': settings });
      }

      ENGINE.init({
        settings: settings,
        customDict: custom,
        unmatched: unmatched,
        onPersist: persist
      });

      document.documentElement.setAttribute('data-aiz-ready', '1');
      document.documentElement.setAttribute('data-aiz-version', VERSION);

      // 初次渲染完成后补一次统计与徽标
      setTimeout(function () {
        var stats = ENGINE.stats();
        notifyBackground({
          type: 'AIZ_STATS',
          translated: stats.translated,
          dictSize: stats.dictSize,
          unmatchedCount: stats.unmatchedCount,
          url: location.href
        });
      }, 1500);

      if (hasChrome && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local') return;

          if (changes[KEY.settings]) {
            ENGINE.setSettings(mergeSettings(changes[KEY.settings].newValue));
          }
          if (changes[KEY.custom]) {
            var next = changes[KEY.custom].newValue;
            ENGINE.setCustomDict(next && typeof next === 'object' ? next : {});
          }
          if (changes[KEY.unmatched]) {
            // 用户清空/编辑了候选池：同步到引擎，避免又把旧的写回去
            var val = changes[KEY.unmatched].newValue;
            if (val && typeof val === 'object') {
              var local = ENGINE.getUnmatched();
              Object.keys(local).forEach(function (k) {
                if (!(k in val)) delete local[k];
              });
            }
          }
        });
      }

      if (hasChrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
          if (!msg || typeof msg.type !== 'string') return false;

          if (msg.type === 'AIZ_GET_STATS' || msg.type === 'AIZ_PING') {
            var stats = ENGINE.stats();
            sendResponse({
              ok: true,
              enabled: stats.enabled,
              translated: stats.translated,
              unique: stats.unique,
              dictSize: stats.dictSize,
              customSize: stats.customSize,
              unmatchedCount: stats.unmatchedCount,
              unmatched: stats.unmatched,
              url: stats.url,
              version: VERSION
            });
            return false;
          }

          if (msg.type === 'AIZ_RETRANSLATE') {
            ENGINE.retranslate();
            setTimeout(function () {
              var s = ENGINE.stats();
              sendResponse({
                ok: true,
                translated: s.translated,
                unmatched: s.unmatched,
                version: VERSION
              });
            }, 300);
            return true;
          }

          if (msg.type === 'AIZ_CLEAR_MARKS') {
            var current = ENGINE.getSettings();
            if (hasChrome) {
              chrome.storage.local.set({
                'aiz.settings': Object.assign({}, current, { enabled: false })
              });
            } else {
              ENGINE.setSettings(Object.assign({}, current, { enabled: false }));
            }
            sendResponse({ ok: true });
            return false;
          }

          if (msg.type === 'AIZ_APPLY_SETTINGS') {
            safeGet([KEY.settings], function (res) {
              ENGINE.setSettings(mergeSettings(res[KEY.settings]));
              sendResponse({ ok: true });
            });
            return true;
          }

          if (msg.type === 'AIZ_GET_ORIGINALS') {
            // 供设置页调试用：返回当前页命中的原文集合
            sendResponse({ ok: true, originals: Array.from(ENGINE.stats().unmatched || []) });
            return false;
          }

          return false;
        });
      }

      window.__AIZ_BOOT__ = {
        version: VERSION,
        reload: function () {
          safeGet([KEY.settings, KEY.custom], function (res) {
            ENGINE.setSettings(mergeSettings(res[KEY.settings]));
            ENGINE.setCustomDict(res[KEY.custom] || {});
          });
        }
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
