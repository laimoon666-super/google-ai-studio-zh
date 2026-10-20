/* ============================================================
 * Google AI Studio 汉化助手 · Service Worker
 * ------------------------------------------------------------
 * 职责：
 *  1. 首次安装时写入默认设置
 *  2. 用 declarativeNetRequest 把 AI Studio 强制渲染成英文（可选）
 *  3. 把翻译数量显示在扩展图标徽标上
 *  4. 响应 popup / options 的全局消息，处理 Alt+Shift+H 快捷键
 * ============================================================ */
'use strict';

const VERSION = chrome.runtime.getManifest().version;

const KEY = {
  settings: 'aiz.settings',
  custom: 'aiz.customDict',
  unmatched: 'aiz.unmatched',
  stats: 'aiz.stats',
  schema: 'aiz.schema'
};

const DEFAULT_SETTINGS = {
  enabled: true,
  forceEnglish: true,
  highlight: false,
  hoverOriginal: false,
  translateAttrs: true,
  collectUnmatched: true,
  extraSkipSelectors: [],
  extraPatterns: []
};

const RULE_ID = 1001;

function mergeSettings(raw) {
  return Object.assign({}, DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
}

async function readSettings() {
  const res = await chrome.storage.local.get(KEY.settings);
  return mergeSettings(res[KEY.settings]);
}

/* ---------------- 强制英文界面 ---------------- */

async function applyForceEnglish(enabled) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
    if (!enabled) return;

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: RULE_ID,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: {
              transform: {
                queryTransform: {
                  addOrReplaceParams: [{ key: 'hl', value: 'en' }]
                }
              }
            }
          },
          condition: {
            urlFilter: '||aistudio.google.com/',
            resourceTypes: ['main_frame'],
            requestMethods: ['get']
          }
        }
      ]
    });
  } catch (err) {
    console.warn('[AI Studio 汉化] 强制英文规则设置失败：', err);
  }
}

/* ---------------- 徽标 ---------------- */

async function updateBadge(tabId, count, enabled) {
  try {
    const text = enabled === false ? 'OFF' : count > 0 ? String(count > 999 ? '999+' : count) : '';
    await chrome.action.setBadgeText(tabId ? { tabId, text } : { text });
    await chrome.action.setBadgeBackgroundColor({ color: enabled === false ? '#9AA0A6' : '#7C4DFF' });
    if (tabId) {
      await chrome.action.setTitle({
        tabId,
        title: enabled === false ? 'AI Studio 汉化：已关闭' : `AI Studio 汉化：本页已翻译 ${count} 处`
      });
    }
  } catch (e) {
    /* 标签页可能已关闭，忽略 */
  }
}

async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch (e) { /* ignore */ }
}

/* ---------------- 生命周期 ---------------- */

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await readSettings();
  const current = await chrome.storage.local.get([KEY.schema, KEY.settings, KEY.custom, KEY.unmatched]);

  const patch = {
    [KEY.schema]: 1,
    [KEY.settings]: settings,
    [KEY.custom]: current[KEY.custom] || {},
    [KEY.unmatched]: current[KEY.unmatched] || {}
  };
  await chrome.storage.local.set(patch);
  await applyForceEnglish(settings.forceEnglish);

  if (details.reason === 'install') {
    console.info('[AI Studio 汉化] 安装完成，v' + VERSION);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await readSettings();
  await applyForceEnglish(settings.forceEnglish);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[KEY.settings]) {
    const prev = changes[KEY.settings].oldValue;
    const next = mergeSettings(changes[KEY.settings].newValue);
    const forceChanged = !prev || !!prev.forceEnglish !== !!next.forceEnglish;
    if (forceChanged) await applyForceEnglish(next.forceEnglish);

    // 开关状态同步到所有已打开的 AI Studio 标签页徽标
    const tabs = await chrome.tabs.query({ url: 'https://aistudio.google.com/*' });
    for (const tab of tabs) {
      if (!next.enabled) await updateBadge(tab.id, 0, false);
    }
  }
});

/* ---------------- 消息 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'AIZ_GET_META') {
    sendResponse({ ok: true, version: VERSION });
    return false;
  }

  if (msg.type === 'AIZ_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'AIZ_STATS') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) updateBadge(tabId, Number(msg.translated) || 0, undefined);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'AIZ_GET_SNAPSHOT') {
    // 转发给某个已打开的 AI Studio 标签页上的内容脚本
    chrome.tabs.query({ url: 'https://aistudio.google.com/*' }, async (tabs) => {
      for (const tab of tabs) {
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'AIZ_GET_SNAPSHOT' });
          if (res && res.ok) {
            sendResponse(res);
            return;
          }
        } catch (e) {
          /* 该标签页内容脚本不可用，尝试下一个 */
        }
      }
      sendResponse({ ok: false, reason: 'no-content-tab' });
    });
    return true;
  }

  if (msg.type === 'AIZ_RESET_ALL') {
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ [KEY.schema]: 1, [KEY.settings]: DEFAULT_SETTINGS, [KEY.custom]: {} });
      applyForceEnglish(DEFAULT_SETTINGS.forceEnglish);
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

/* ---------------- 快捷键 Alt+Shift+H ---------------- */

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-localization') return;

  const settings = await readSettings();
  const next = Object.assign({}, settings, { enabled: !settings.enabled });
  await chrome.storage.local.set({ [KEY.settings]: next });

  const tabs = await chrome.tabs.query({ url: 'https://aistudio.google.com/*' });
  for (const tab of tabs) {
    if (!next.enabled) await updateBadge(tab.id, 0, false);
  }
});

/* ---------------- 标签页切换时清理徽标 ---------------- */

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'loading' || !tab.url) return;
  if (tab.url.indexOf('aistudio.google.com') === -1) clearBadge(tabId);
});

chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (!tab.url || tab.url.indexOf('aistudio.google.com') === -1) clearBadge(info.tabId);
  } catch (e) { /* ignore */ }
});
