// providers/focus-guard.js
// LeechBlock NG blocking engine — migrated to ES module provider.
// Changes from original:
//   - importScripts → ES module import
//   - var → const/let
//   - callback → async/await
//   - storage.sync removed; only local storage used
//   - \r\n → \n (LF only)
//   - Tracking/telemetry: none (never existed in LB)
//   - Registered into Nexus provider system for command palette commands

import { register } from '../core/registry.js';
import {
  TIMEDATA_LEN, MAX_SETS, BLOCKED_PAGE, DELAYED_PAGE, PASSWORD_PAGE,
  DEFAULT_BLOCK_URL, DELAYED_BLOCK_URL, PASSWORD_BLOCK_URL,
  PER_SET_OPTIONS, GENERAL_OPTIONS,
  cleanOptions, cleanTimeData, getParsedURL, cleanSites,
  getRegExpSites, getMinPeriods, getTimePeriodStart,
  updateRolloverTime, formatTime, allTrue, getCleanURL,
} from './focus-guard-common.js';

const BLOCKABLE_URL = /^(http|file|chrome|edge|extension)/i;
const CLOCKABLE_URL = /^(http|file)/i;
const EXTENSION_URL = chrome.runtime.getURL('');
const BLOCKED_PAGE_URL  = chrome.runtime.getURL(BLOCKED_PAGE);
const DELAYED_PAGE_URL  = chrome.runtime.getURL(DELAYED_PAGE);
const PASSWORD_PAGE_URL = chrome.runtime.getURL(PASSWORD_PAGE);

const log  = msg => console.log('[FG] ' + msg);
const warn = msg => console.warn('[FG] ' + msg);

// ── State ────────────────────────────────────────────────────────────────────
let gGotOptions = false;
let gOptions = {};
let gNumSets = 0;
let gTabs = [];
let gSetCounted = [];
let gSavedTimeData = [];
let gRegExps = [];
let gActiveTabId = 0;
let gPrevActiveTabId = 0;
let gFocusWindowId = 0;
let gClockOffset = 0;
let gIgnoreJumpSecs = 0;
let gAllFocused = false;
let gUseDocFocus = true;
let gSaveSecsCount = 0;

// ── Tab init ─────────────────────────────────────────────────────────────────
function initTab(id) {
  if (gTabs[id]) return false;
  gTabs[id] = {
    allowedHost: null, allowedPath: null,
    allowedSet: 0, allowedEndTime: 0,
    referrer: '', url: 'about:blank',
    incog: false, audible: false,
    focused: false, loaded: false, loadedTime: 0,
  };
  return true;
}

// ── RegExp creation ──────────────────────────────────────────────────────────
function createRegExps() {
  for (let set = 1; set <= gNumSets; set++) {
    gRegExps[set] = {};
    const blockRE   = gOptions[`regexpBlock${set}`]   || gOptions[`blockRE${set}`];
    const allowRE   = gOptions[`regexpAllow${set}`]   || gOptions[`allowRE${set}`];
    const referRE   = gOptions[`referRE${set}`];
    const keywordRE = gOptions[`regexpKeyword${set}`] || gOptions[`keywordRE${set}`];
    gRegExps[set].block   = blockRE   ? new RegExp(blockRE,   'i') : null;
    gRegExps[set].allow   = allowRE   ? new RegExp(allowRE,   'i') : null;
    gRegExps[set].refer   = referRE   ? new RegExp(referRE,   'i') : null;
    gRegExps[set].keyword = keywordRE; // String; Chrome workaround: can't pass RegExp cross-context
  }
}

function testURL(url, referrer, blockRE, allowRE, referRE, allowRefers) {
  const block = blockRE && blockRE.test(url);
  const allow = allowRE && allowRE.test(url);
  const refer = referRE && referRE.test(referrer);
  return allowRefers ? block && !(allow || refer) : (block || refer) && !allow;
}

// ── Context menus ─────────────────────────────────────────────────────────────
function refreshMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll();
  const context = gOptions['contextMenu'] ? 'all' : 'action';
  chrome.contextMenus.create({ id: 'fg-options',   title: 'Focus Guard options',  contexts: [context] });
  chrome.contextMenus.create({ id: 'fg-lockdown',  title: 'Lockdown...',          contexts: [context] });
  chrome.contextMenus.create({ id: 'fg-override',  title: 'Override blocking',    contexts: [context] });
  chrome.contextMenus.create({ id: 'fg-separator', type: 'separator',             contexts: [context] });
  chrome.contextMenus.create({ id: 'addSite',      title: 'Add site to block set',contexts: [context] });
  for (let set = 1; set <= gNumSets; set++) {
    const setName = gOptions[`setName${set}`];
    const title = 'Block Set ' + set + (setName ? ` (${setName})` : '');
    chrome.contextMenus.create({ id: `addSite-${set}`, parentId: 'addSite', title, contexts: [context] });
  }
}

// ── Ticker (offscreen) ───────────────────────────────────────────────────────
async function createTicker() {
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('ticker.html'),
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Focus Guard ticker requires offscreen document',
    });
  } catch (e) {
    // Already exists
  }
}

function refreshTicker() {
  const secs = +gOptions['processTabsSecs'];
  chrome.runtime.sendMessage({ type: 'fg:ticker-config', tickerSecs: secs }).catch(() => {});
}

// ── Storage ──────────────────────────────────────────────────────────────────
async function retrieveOptions(update = false) {
  const stored = await chrome.storage.local.get(null);
  for (const key in stored) {
    if (!update || !/^timedata/.test(key)) gOptions[key] = stored[key];
  }
  gGotOptions = true;
  cleanOptions(gOptions);
  cleanTimeData(gOptions);
  gNumSets       = +gOptions['numSets'];
  gClockOffset   = +gOptions['clockOffset'];
  gIgnoreJumpSecs = +gOptions['ignoreJumpSecs'];
  gAllFocused    = gOptions['allFocused'];
  gUseDocFocus   = gOptions['useDocFocus'];
  createRegExps();
  refreshMenus();
  refreshTicker();
  loadSiteLists();
  updateIcon();
  for (let set = 1; set <= gNumSets; set++) {
    gSavedTimeData[set] = gOptions[`timedata${set}`].toString();
  }
}

async function loadSiteLists() {
  const time = Date.now();
  for (let set = 1; set <= gNumSets; set++) {
    let sitesURL = gOptions[`sitesURL${set}`];
    if (!sitesURL) continue;
    sitesURL = sitesURL.replace(/\$S/, set).replace(/\$T/, time);
    try {
      const res = await fetch(sitesURL);
      if (res.status === 200) {
        const text = await res.text();
        const sites = cleanSites(text);
        const regexps = getRegExpSites(sites, gOptions['matchSubdomains']);
        Object.assign(gOptions, {
          [`sites${set}`]:      sites,
          [`blockRE${set}`]:    regexps.block,
          [`allowRE${set}`]:    regexps.allow,
          [`referRE${set}`]:    regexps.refer,
          [`keywordRE${set}`]:  regexps.keyword,
        });
        createRegExps();
        await chrome.storage.local.set({
          [`sites${set}`]:     sites,
          [`blockRE${set}`]:   regexps.block,
          [`allowRE${set}`]:   regexps.allow,
          [`referRE${set}`]:   regexps.refer,
          [`keywordRE${set}`]: regexps.keyword,
        });
      }
    } catch (e) { warn('Cannot load sites from URL: ' + sitesURL); }
  }
}

async function saveTimeData() {
  if (!gGotOptions) return;
  const options = {};
  let touched = false;
  for (let set = 1; set <= gNumSets; set++) {
    const td = gOptions[`timedata${set}`];
    if (gSavedTimeData[set] !== td.toString()) {
      options[`timedata${set}`] = td;
      gSavedTimeData[set] = td.toString();
      touched = true;
    }
  }
  if (touched) await chrome.storage.local.set(options).catch(e => warn('Cannot save time data: ' + e));
}

function restartTimeData(set) {
  if (!gGotOptions || set < 0 || set > gNumSets) return;
  const now = Math.floor(Date.now() / 1000) + gClockOffset * 60;
  if (!set) {
    for (let s = 1; s <= gNumSets; s++) { gOptions[`timedata${s}`][0] = now; gOptions[`timedata${s}`][1] = 0; }
  } else { gOptions[`timedata${set}`][0] = now; gOptions[`timedata${set}`][1] = 0; }
  saveTimeData();
}

function reorderTimeData(ordering) {
  if (!ordering) return;
  const saved = [];
  for (let set = 1; set <= gNumSets; set++) saved[set] = gOptions[`timedata${set}`].slice();
  for (let set = 1; set <= gNumSets; set++) {
    if (ordering[set] <= gNumSets) gOptions[`timedata${set}`] = saved[ordering[set]];
  }
  saveTimeData();
}

// ── Icon ─────────────────────────────────────────────────────────────────────
function updateIcon() {
  const overrideEnd = gOptions['oret'] || 0;
  const now = Math.floor(Date.now() / 1000);
  if (overrideEnd > now) {
    chrome.action.setIcon({ path: 'assets/icon-override.svg' }).catch(() => {});
  } else {
    chrome.action.setIcon({ path: 'assets/icon.svg' }).catch(() => {});
  }
}

// ── Time/page clocking ────────────────────────────────────────────────────────
function clockPageTime(tabId, isNew, isFocused) {
  if (!gGotOptions) return;
  const tab = gTabs[tabId];
  if (!tab) return;
  const url = tab.url;
  if (!CLOCKABLE_URL.test(url)) return;
  const now = Math.floor(Date.now() / 1000) + gClockOffset * 60;
  for (let set = 1; set <= gNumSets; set++) {
    if (gSetCounted[set]) continue;
    if (!testURL(url, tab.referrer, gRegExps[set].block, gRegExps[set].allow, gRegExps[set].refer, gOptions[`allowRefers${set}`])) continue;
    const timedata = gOptions[`timedata${set}`];
    const focused = tab.focused || gAllFocused;
    const audible = tab.audible && gOptions[`countAudio${set}`];
    const active  = gOptions[`countFocus${set}`] ? (focused && isFocused) : true;
    if (active || audible) {
      if (tab.loadedTime && tab.loadedTime < now) {
        const elapsed = now - tab.loadedTime;
        if (gIgnoreJumpSecs <= 0 || elapsed <= gIgnoreJumpSecs) {
          timedata[1] += elapsed;
          const periodStart = getTimePeriodStart(now, gOptions[`limitPeriod${set}`], gOptions[`limitOffset${set}`]);
          if (timedata[2] < periodStart) { timedata[2] = periodStart; timedata[3] = 0; }
          timedata[3] += elapsed;
        }
      }
    }
    if (isNew && !gOptions[`processActiveTabs`]) gSetCounted[set] = true;
    if (isNew) tab.loadedTime = now;
  }
}

// ── Block checking ────────────────────────────────────────────────────────────
function checkTab(id, isBeforeNav, isRepeat) {
  if (!gGotOptions) return false;
  const tab = gTabs[id];
  if (!tab) return false;
  const url = tab.url;
  if (!BLOCKABLE_URL.test(url)) return false;
  if (url.startsWith(EXTENSION_URL)) return false;

  const now = Math.floor(Date.now() / 1000) + gClockOffset * 60;
  const dayOfWeek = new Date(now * 1000).getDay();
  const minuteOfDay = new Date(now * 1000).getHours() * 60 + new Date(now * 1000).getMinutes();

  for (let set = 1; set <= gNumSets; set++) {
    if (gOptions[`disable${set}`]) continue;
    if (!gRegExps[set].block && !gRegExps[set].refer) continue;
    if (!testURL(url, tab.referrer, gRegExps[set].block, gRegExps[set].allow, gRegExps[set].refer, gOptions[`allowRefers${set}`])) continue;

    const days = gOptions[`days${set}`];
    if (!days[dayOfWeek]) continue;

    const times = gOptions[`times${set}`];
    const minPeriods = getMinPeriods(times);
    const inTimePeriod = !minPeriods.length || minPeriods.some(mp => minuteOfDay >= mp.start && minuteOfDay < mp.end);
    if (!inTimePeriod && !gOptions[`limitMins${set}`]) continue;

    const timedata  = gOptions[`timedata${set}`];
    const limitMins = +gOptions[`limitMins${set}`];
    const lockdown  = timedata[4] > now;
    const limitSecs = limitMins * 60;
    const periodStart = getTimePeriodStart(now, gOptions[`limitPeriod${set}`], gOptions[`limitOffset${set}`]);
    if (timedata[2] < periodStart) { timedata[2] = periodStart; timedata[3] = 0; }
    updateRolloverTime(timedata, limitMins, gOptions[`limitPeriod${set}`], periodStart);

    const rolloverSecs = gOptions[`rollover${set}`] ? timedata[5] : 0;
    const timeLeft = limitSecs ? (limitSecs + rolloverSecs - timedata[3]) : Infinity;
    const overTimeLimit = limitSecs && timeLeft <= 0;
    const overrideEnd = gOptions['oret'] || 0;
    const overrideActive = overrideEnd > now;

    const shouldBlock = (lockdown || (inTimePeriod && overTimeLimit)) && !overrideActive;
    if (!shouldBlock) continue;

    // Choose block URL
    let blockURL = gOptions[`blockURL${set}`] || DEFAULT_BLOCK_URL;
    const parsedURL = getParsedURL(url);
    blockURL = blockURL.replace(/\$S/g, set).replace(/\$U/g, encodeURIComponent(url));

    const delayFirst = gOptions[`delayFirst${set}`];
    const delaySecs  = +gOptions[`delaySecs${set}`];

    if (delayFirst && delaySecs > 0 && !gOptions[`disable${set}`]) {
      const delayURL = DELAYED_PAGE_URL + '?set=' + set + '&url=' + encodeURIComponent(url);
      chrome.tabs.update(id, { url: delayURL });
    } else {
      chrome.tabs.update(id, { url: BLOCKED_PAGE_URL + '?set=' + set + '&url=' + encodeURIComponent(url) });
    }
    return true;
  }
  return false;
}

// ── Lockdown / Override ───────────────────────────────────────────────────────
async function applyLockdown(set, endTime) {
  if (set) { gOptions[`timedata${set}`][4] = endTime; }
  else { for (let s = 1; s <= gNumSets; s++) gOptions[`timedata${s}`][4] = endTime; }
  await saveTimeData();
}

async function cancelLockdown(set) {
  if (set) { gOptions[`timedata${set}`][4] = 0; }
  else { for (let s = 1; s <= gNumSets; s++) gOptions[`timedata${s}`][4] = 0; }
  await saveTimeData();
}

async function applyOverride(endTime) {
  gOptions['oret'] = endTime;
  await chrome.storage.local.set({ oret: endTime });
  updateIcon();
}

async function discardRemainingTime() {
  const now = Math.floor(Date.now() / 1000) + gClockOffset * 60;
  for (let set = 1; set <= gNumSets; set++) {
    const limitMins = +gOptions[`limitMins${set}`];
    if (limitMins) {
      const periodStart = getTimePeriodStart(now, gOptions[`limitPeriod${set}`], gOptions[`limitOffset${set}`]);
      if (gOptions[`timedata${set}`][2] < periodStart) {
        gOptions[`timedata${set}`][2] = periodStart;
        gOptions[`timedata${set}`][3] = 0;
      }
      gOptions[`timedata${set}`][3] = limitMins * 60;
    }
  }
  await saveTimeData();
}

async function allowBlockedPage(tabId, blockedURL, blockedSet, autoLoad) {
  const tab = gTabs[tabId];
  if (!tab) return;
  if (autoLoad) {
    await chrome.tabs.update(tabId, { url: blockedURL });
  }
}

// ── Timer display ─────────────────────────────────────────────────────────────
function updateTimer(tabId) {
  const tab = gTabs[tabId];
  if (!tab || !gGotOptions) return;
  if (!gOptions['timerVisible']) {
    chrome.tabs.sendMessage(tabId, { type: 'fg:timer', text: '', size: 0, location: 0 }).catch(() => {});
    return;
  }
  const url = tab.url;
  const now = Math.floor(Date.now() / 1000) + gClockOffset * 60;
  let text = '';
  for (let set = 1; set <= gNumSets; set++) {
    if (!testURL(url, tab.referrer, gRegExps[set].block, gRegExps[set].allow, gRegExps[set].refer, gOptions[`allowRefers${set}`])) continue;
    const timedata  = gOptions[`timedata${set}`];
    const limitMins = +gOptions[`limitMins${set}`];
    if (!limitMins) continue;
    const periodStart = getTimePeriodStart(now, gOptions[`limitPeriod${set}`], gOptions[`limitOffset${set}`]);
    if (timedata[2] < periodStart) { timedata[2] = periodStart; timedata[3] = 0; }
    const rollover = gOptions[`rollover${set}`] ? timedata[5] : 0;
    const left = (limitMins * 60) + rollover - timedata[3];
    const maxHours = +gOptions['timerMaxHours'];
    if (left < maxHours * 3600) { text = formatTime(left); break; }
  }
  const size     = +gOptions['timerSize'] || 0;
  const location = +gOptions['timerLocation'] || 0;
  chrome.tabs.sendMessage(tabId, { type: 'fg:timer', text, size, location }).catch(() => {});
}

// ── Site add ──────────────────────────────────────────────────────────────────
async function addSitesToSet(sites, set) {
  if (!set || set < 1 || set > gNumSets) return;
  const key = `sites${set}`;
  const existing = gOptions[key] || '';
  const merged = cleanSites((existing + ' ' + sites).trim());
  const regexps = getRegExpSites(merged, gOptions['matchSubdomains']);
  gOptions[key]                    = merged;
  gOptions[`blockRE${set}`]        = regexps.block;
  gOptions[`allowRE${set}`]        = regexps.allow;
  gOptions[`referRE${set}`]        = regexps.refer;
  gOptions[`regexpKeyword${set}`]  = regexps.keyword;
  createRegExps();
  await chrome.storage.local.set({
    [key]:                     merged,
    [`blockRE${set}`]:         regexps.block,
    [`allowRE${set}`]:         regexps.allow,
    [`referRE${set}`]:         regexps.refer,
    [`regexpKeyword${set}`]:   regexps.keyword,
  });
}

function blockCurrentSite(sender) {
  if (!sender?.tab?.id) return;
  const tab = gTabs[sender.tab.id];
  if (!tab?.url) return;
  const parsed = getParsedURL(tab.url);
  const host = parsed.host || '';
  if (host) addSitesToSet(host, 1);
}

// ── processTabs (called by ticker) ───────────────────────────────────────────
function processTabs(activeOnly) {
  gSetCounted = [];
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) {
      initTab(tab.id);
      const focusWin = gFocusWindowId;
      const focus = tab.active && (gAllFocused || !focusWin || tab.windowId === focusWin);
      if (activeOnly && !tab.active) continue;
      clockPageTime(tab.id, false, focus);
      const blocked = checkTab(tab.id, false, true);
      if (!blocked && tab.active) updateTimer(tab.id);
    }
  }).catch(() => {});
}

// ── Window focus ──────────────────────────────────────────────────────────────
async function updateFocusedWindowId() {
  if (!chrome.windows) return;
  try {
    const win = await chrome.windows.getCurrent();
    gFocusWindowId = win.focused ? win.id : chrome.windows.WINDOW_ID_NONE;
  } catch (e) {}
}

// ── Tick ─────────────────────────────────────────────────────────────────────
async function handleTick() {
  await updateFocusedWindowId();
  if (!gGotOptions) { await retrieveOptions(); return; }
  processTabs(gOptions['processActiveTabs']);
  updateIcon();
  if (++gSaveSecsCount >= +gOptions['saveSecs']) { await saveTimeData(); gSaveSecsCount = 0; }
}

// ── Tab event handlers ────────────────────────────────────────────────────────
function handleTabCreated(tab) {
  initTab(tab.id);
  if (tab.openerTabId && gTabs[tab.openerTabId]) {
    const p = gTabs[tab.openerTabId];
    gTabs[tab.id].allowedHost    = p.allowedHost;
    gTabs[tab.id].allowedPath    = p.allowedPath;
    gTabs[tab.id].allowedSet     = p.allowedSet;
    gTabs[tab.id].allowedEndTime = p.allowedEndTime;
  }
}

function handleTabUpdated(tabId, changeInfo, tab) {
  initTab(tabId);
  if (!gGotOptions) return;
  const focus = tab.active && (gAllFocused || !gFocusWindowId || tab.windowId === gFocusWindowId);
  gTabs[tabId].incog   = tab.incognito;
  gTabs[tabId].audible = tab.audible;
  if (changeInfo.url) gTabs[tabId].url = getCleanURL(changeInfo.url);
  if (changeInfo.status === 'complete') {
    clockPageTime(tabId, true, focus);
    const blocked = checkTab(tabId, false, false);
    if (!blocked && tab.active) updateTimer(tabId);
  }
}

function handleTabActivated(activeInfo) {
  const tabId = activeInfo.tabId;
  gActiveTabId = tabId;
  gPrevActiveTabId = activeInfo.previousTabId;
  initTab(tabId);
  gTabs[tabId].focused = true;
  if (!gGotOptions) return;
  if (gOptions['processActiveTabs']) { processTabs(false); return; }
  const focus = gAllFocused || !gFocusWindowId || activeInfo.windowId === gFocusWindowId;
  clockPageTime(tabId, true, focus);
  updateTimer(tabId);
}

function handleTabRemoved(tabId) {
  if (!gGotOptions) return;
  clockPageTime(tabId, false, false);
  if (gTabs[tabId]?.url?.startsWith(EXTENSION_URL)) {
    chrome.tabs.update(gPrevActiveTabId, { active: true }).catch(() => {});
  }
  if (gTabs[tabId]) delete gTabs[tabId];
}

function handleBeforeNavigate(navDetails) {
  const tabId = navDetails.tabId;
  initTab(tabId);
  if (!gGotOptions) return;
  clockPageTime(tabId, false, false);
  if (navDetails.frameId === 0) {
    gTabs[tabId].loaded = false;
    gTabs[tabId].url = getCleanURL(navDetails.url);
    checkTab(tabId, true, false);
  }
}

// ── Context menu clicks ───────────────────────────────────────────────────────
function handleMenuClick(info, tab) {
  const id = info.menuItemId;
  if (id === 'fg-options')  openOptions();
  else if (id === 'fg-lockdown') openLockdown();
  else if (id === 'fg-override') applyOverride(Math.floor(Date.now() / 1000) + 3600);
  else if (id.startsWith('addSite-')) {
    const set = parseInt(id.split('-')[1], 10);
    if (tab?.url) {
      const parsed = getParsedURL(tab.url);
      if (parsed.host) addSitesToSet(parsed.host, set);
    }
  }
}

function openOptions(tab = 'focus-guard') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`pages/options.html#${tab}`) });
}

function openLockdown() {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/lockdown.html') });
}

// ── Public init + handlers (provider interface) ───────────────────────────────
export async function init() {
  await retrieveOptions();
  await createTicker();

  chrome.tabs.onCreated.addListener(handleTabCreated);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);
  if (chrome.contextMenus) chrome.contextMenus.onClicked.addListener(handleMenuClick);

  // Keep service worker alive with staggered alarms
  const now = Date.now();
  for (let alarm = 1; alarm <= 6; alarm++) {
    chrome.alarms.create(`fg-alarm-${alarm}`, { when: now + alarm * 10000, periodInMinutes: 1 });
  }

  // Register Omni commands for this provider
  register('focus-guard', async (q) => {
    const match = t => !q || t.toLowerCase().includes(q.toLowerCase());
    const cmds = [
      { id: 'fg:block-site',   title: 'Focus Guard: Block this site',     desc: 'Add current site to block set 1',       emoji: '🚫' },
      { id: 'fg:lockdown',     title: 'Focus Guard: Lockdown mode',       desc: 'Enable lockdown for all block sets',    emoji: '🔒' },
      { id: 'fg:override',     title: 'Focus Guard: Override (1 hour)',   desc: 'Temporarily disable blocking for 1hr', emoji: '⏰' },
      { id: 'fg:open-options', title: 'Focus Guard: Open settings',       desc: 'Open Focus Guard settings tab',        emoji: '⚙️' },
    ];
    return cmds.filter(c => match(c.title));
  });
}

export const handlers = {
  'fg:loaded': async (msg, sender) => {
    if (!sender?.tab?.id) return;
    initTab(sender.tab.id);
    gTabs[sender.tab.id].loaded = true;
    gTabs[sender.tab.id].loadedTime = Date.now() / 1000;
    gTabs[sender.tab.id].url = getCleanURL(msg.url);
  },
  'fg:referrer': async (msg, sender) => {
    if (!sender?.tab?.id) return;
    initTab(sender.tab.id);
    gTabs[sender.tab.id].referrer = msg.referrer;
  },
  'fg:focus': async (msg, sender) => {
    if (!sender?.tab?.id) return;
    initTab(sender.tab.id);
    gTabs[sender.tab.id].focused = msg.focus;
  },
  'fg:timer': async (msg) => {
    await handleTick();
  },
  'fg:tick': async () => {
    await handleTick();
  },
  'fg:ticker-config': async () => {},
  'fg:keyword': async (msg, sender) => {
    // Respond to keyword check from content script
    return null;
  },
  'fg:blocked': async (msg, sender) => {
    if (!sender?.tab?.id) return null;
    return { set: 1, url: gTabs[sender.tab.id]?.url || '' };
  },
  'fg:delayed': async (msg, sender) => {
    if (!sender?.tab?.id) return;
    await allowBlockedPage(sender.tab.id, msg.blockedURL, msg.blockedSet, gOptions[`delayAutoLoad${msg.blockedSet}`]);
  },
  'fg:close': async (msg, sender) => {
    if (sender?.tab?.id) chrome.tabs.remove(sender.tab.id);
  },
  'fg:lockdown': async (msg) => {
    if (!msg.endTime) await cancelLockdown(msg.set);
    else await applyLockdown(msg.set, msg.endTime);
  },
  'fg:override': async () => {
    await applyOverride(Math.floor(Date.now() / 1000) + 3600);
  },
  'fg:options': async (msg) => {
    await retrieveOptions(true);
    reorderTimeData(msg.ordering);
  },
  'fg:add-sites': async (msg) => {
    await addSitesToSet(msg.sites, msg.set);
  },
  'fg:block-site': async (_, sender) => {
    blockCurrentSite(sender);
  },
  'fg:open-options': async () => {
    openOptions();
  },
  'fg:restart': async (msg) => {
    restartTimeData(msg.set);
  },
  'fg:discard-time': async () => {
    await discardRemainingTime();
  },
  'fg:password': async (msg, sender) => {
    if (!sender?.tab?.id) return;
    await allowBlockedPage(sender.tab.id, msg.blockedURL, msg.blockedSet, true);
  },
};
