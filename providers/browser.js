import { register, query as registryQuery } from '../core/registry.js';

const isMac = () => {

  const brands = navigator.userAgentData?.platform;
  if (brands) return /mac/i.test(brands);
  return /mac/i.test(navigator.userAgent);
};

function matchText(text, q) {
  if (!q) return true;
  return (text || '').toLowerCase().includes(q.toLowerCase());
}

function macKey(mac, win) {
  return isMac() ? mac : win;
}

let _tabCache = null, _tabCacheTs = 0;
async function getAllTabs() {
  if (_tabCache && Date.now() - _tabCacheTs < 800) return _tabCache;
  return (_tabCache = await chrome.tabs.query({}), _tabCacheTs = Date.now(), _tabCache);
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function tabProvider(q) {
  const tabs = await getAllTabs();
  const sorted = q ? tabs : [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return sorted
    .filter(t => !q || matchText(t.title, q) || matchText(t.url, q))
    .slice(0, 50)
    .map(t => ({
      id: `tab:${t.id}`,
      title: t.title || t.url,
      desc: hostname(t.url) || 'Tab',
      icon: t.favIconUrl || '',
      type: 'tab',
      tabId: t.id,
      tabIndex: t.index,
      windowId: t.windowId,
    }));
}

async function bookmarkProvider(q) {
  const items = q
    ? await chrome.bookmarks.search({ query: q })
    : await chrome.bookmarks.getRecent(30);
  return items
    .filter(b => b.url)
    .slice(0, 30)
    .map(b => ({
      id: `bm:${b.id}`,
      title: b.title || b.url,
      desc: hostname(b.url) || 'Bookmark',
      emoji: '⭐️',
      type: 'bookmark',
      url: b.url,
      bookmarkId: b.id,
    }));
}

async function historyProvider(q) {
  const items = q
    ? await chrome.history.search({ text: q, maxResults: 20, startTime: 0 })
    : await chrome.history.search({ text: '', maxResults: 15, startTime: 0 });
  return items.map(h => ({
    id: `hist:${h.id}`,
    title: h.title || h.url,
    desc: hostname(h.url) || 'History',
    emoji: '🏛',
    type: 'history',
    url: h.url,
  }));
}

const SHORTCUTS = [

  { id: 'act:new-tab',       title: 'New tab',                desc: 'Open a new tab',                    emoji: '✨',  keys: macKey(['⌘','T'],    ['Ctrl','T']) },
  { id: 'act:incognito',     title: 'Incognito mode',         desc: 'Open an incognito window',          emoji: '🕵️', keys: macKey(['⌘','⇧','N'],['Ctrl','Shift','N']) },
  { id: 'act:duplicate-tab', title: 'Duplicate tab',          desc: 'Duplicate the current tab',        emoji: '📋', keys: macKey(['⌥','⇧','D'],['Alt','Shift','D']) },
  { id: 'act:close-tab',     title: 'Close tab',              desc: 'Close the current tab',            emoji: '🗑',  keys: macKey(['⌘','W'],    ['Ctrl','W']) },
  { id: 'act:close-window',  title: 'Close window',           desc: 'Close the current window',         emoji: '💥', keys: macKey(['⌘','⇧','W'],['Ctrl','Shift','W']) },
  { id: 'act:pin',           title: 'Pin tab',                desc: 'Pin the current tab',              emoji: '📌', keys: macKey(['⌥','⇧','P'],['Alt','Shift','P']) },
  { id: 'act:mute',          title: 'Mute tab',               desc: 'Mute the current tab',             emoji: '🔇', keys: macKey(['⌥','⇧','M'],['Alt','Shift','M']) },
  { id: 'act:reload',        title: 'Reload',                 desc: 'Reload the page',                  emoji: '♻️', keys: macKey(['⌘','⇧','R'],['F5']) },
  { id: 'act:fullscreen',    title: 'Fullscreen',             desc: 'Toggle fullscreen',                emoji: '🖥',  keys: macKey(['⌘','Ctrl','F'],['F11']) },
  { id: 'act:go-back',       title: 'Go back',                desc: 'Go back in tab history',           emoji: '👈', keys: macKey(['⌘','←'],    ['Alt','←']) },
  { id: 'act:go-forward',    title: 'Go forward',             desc: 'Go forward in tab history',        emoji: '👉', keys: macKey(['⌘','→'],    ['Alt','→']) },
  { id: 'act:scroll-top',    title: 'Scroll to top',          desc: 'Scroll to the top of the page',   emoji: '👆', keys: macKey(['⌘','↑'],    ['Home']) },
  { id: 'act:scroll-bottom', title: 'Scroll to bottom',       desc: 'Scroll to the bottom of the page',emoji: '👇', keys: macKey(['⌘','↓'],    ['End']) },
  { id: 'act:print',         title: 'Print page',             desc: 'Print the current page',           emoji: '🖨️', keys: macKey(['⌘','P'],    ['Ctrl','P']) },
  { id: 'act:history',       title: 'Browsing history',       desc: 'Open browsing history',            emoji: '🗂',  keys: macKey(['⌘','Y'],    ['Ctrl','H']) },
  { id: 'act:downloads',     title: 'Downloads',              desc: 'Open downloads',                   emoji: '📦', keys: macKey(['⌘','⇧','J'],['Ctrl','J']) },
  { id: 'act:extensions',    title: 'Extensions',             desc: 'Manage extensions',                emoji: '🧩' },
  { id: 'act:settings',      title: 'Chrome settings',        desc: 'Open Chrome settings',             emoji: '⚙️', keys: macKey(['⌘',','],    []) },
  { id: 'act:manage-data',   title: 'Manage browsing data',   desc: 'Open clear browsing data dialog',  emoji: '🔬', keys: macKey(['⌘','⇧','Delete'],['Ctrl','Shift','Delete']) },
  { id: 'act:bookmark',      title: 'Bookmark this page',     desc: 'Add current page to bookmarks',   emoji: '📕', keys: macKey(['⌘','D'],    ['Ctrl','D']) },

  { id: 'act:remove-all',            title: 'Clear all browsing data',  desc: 'Clear all browsing data',    emoji: '🧹' },
  { id: 'act:remove-history',        title: 'Clear browsing history',   desc: 'Clear browsing history',     emoji: '🗂' },
  { id: 'act:remove-cookies',        title: 'Clear cookies',            desc: 'Clear all cookies',          emoji: '🍪' },
  { id: 'act:remove-cache',          title: 'Clear cache',              desc: 'Clear the browser cache',    emoji: '🗄' },
  { id: 'act:remove-local-storage',  title: 'Clear local storage',      desc: 'Clear local storage',        emoji: '📦' },

  { id: 'sc:notion',      title: 'New Notion page',          desc: 'notion.new',                       url: 'https://notion.new' },
  { id: 'sc:sheets',      title: 'New Google Sheet',         desc: 'sheets.new',                       url: 'https://sheets.new' },
  { id: 'sc:docs',        title: 'New Google Doc',           desc: 'docs.new',                         url: 'https://docs.new' },
  { id: 'sc:slides',      title: 'New Google Slides',        desc: 'slides.new',                       url: 'https://slides.new' },
  { id: 'sc:meet',        title: 'New Google Meet',          desc: 'meet.new',                         url: 'https://meet.new' },
  { id: 'sc:github-repo', title: 'New GitHub repo',          desc: 'github.new',                       url: 'https://github.new' },
  { id: 'sc:gist',        title: 'New GitHub gist',          desc: 'gist.new',                         url: 'https://gist.new' },
  { id: 'sc:codepen',     title: 'New CodePen',              desc: 'pen.new',                          url: 'https://pen.new' },
  { id: 'sc:figma',       title: 'New Figma file',           desc: 'figma.new',                        url: 'https://figma.new' },
  { id: 'sc:excel',       title: 'New Excel spreadsheet',    desc: 'excel.new',                        url: 'https://excel.new' },
  { id: 'sc:word',        title: 'New Word document',        desc: 'word.new',                         url: 'https://word.new' },
  { id: 'sc:powerpoint',  title: 'New PowerPoint',           desc: 'powerpoint.new',                   url: 'https://powerpoint.new' },
  { id: 'sc:canva',       title: 'New Canva design',         desc: 'design.new',                       url: 'https://design.new' },
  { id: 'sc:linear',      title: 'New Linear issue',         desc: 'linear.new',                       url: 'https://linear.new' },
  { id: 'sc:asana',       title: 'New Asana task',           desc: 'task.new',                         url: 'https://task.new' },
  { id: 'sc:calendar',    title: 'New calendar event',       desc: 'cal.new',                          url: 'https://cal.new' },
  { id: 'sc:x-tweet',     title: 'Post on X',                desc: 'x.com/intent/tweet',               url: 'https://x.com/intent/tweet' },
  { id: 'sc:spotify',     title: 'New Spotify playlist',     desc: 'playlist.new',                     url: 'https://playlist.new' },
  { id: 'sc:pdf',         title: 'Convert to PDF',           desc: 'pdf.new',                          url: 'https://pdf.new' },
];

async function shortcutProvider(q) {
  return SHORTCUTS.filter(s => matchText(s.title, q) || matchText(s.desc, q));
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function switchTab(tabId, tabIndex, windowId) {
  await chrome.tabs.highlight({ tabs: tabIndex, windowId });
  await chrome.windows.update(windowId, { focused: true });
}

async function doAction(id, extra = {}) {
  switch (id) {
    case 'act:new-tab':       await chrome.tabs.create({}); break;
    case 'act:incognito':     await chrome.windows.create({ incognito: true }); break;
    case 'act:close-tab':     { const t = await getCurrentTab(); await chrome.tabs.remove(t.id); break; }
    case 'act:close-window':  { const t = await getCurrentTab(); await chrome.windows.remove(t.windowId); break; }
    case 'act:duplicate-tab': { const t = await getCurrentTab(); await chrome.tabs.duplicate(t.id); break; }
    case 'act:pin':           { const t = await getCurrentTab(); await chrome.tabs.update(t.id, { pinned: !t.pinned }); break; }
    case 'act:mute':          { const t = await getCurrentTab(); await chrome.tabs.update(t.id, { muted: !t.mutedInfo.muted }); break; }
    case 'act:reload':        await chrome.tabs.reload(); break;
    case 'act:go-back':       { const t = await getCurrentTab(); await chrome.tabs.goBack(t.id); break; }
    case 'act:go-forward':    { const t = await getCurrentTab(); await chrome.tabs.goForward(t.id); break; }
    case 'act:bookmark':      { const t = await getCurrentTab(); await chrome.bookmarks.create({ title: t.title, url: t.url }); break; }
    case 'act:history':       await chrome.tabs.create({ url: 'chrome://history/' }); break;
    case 'act:downloads':     await chrome.tabs.create({ url: 'chrome://downloads/' }); break;
    case 'act:extensions':    await chrome.tabs.create({ url: 'chrome://extensions/' }); break;
    case 'act:settings':      await chrome.tabs.create({ url: 'chrome://settings/' }); break;
    case 'act:manage-data':   await chrome.tabs.create({ url: 'chrome://settings/clearBrowserData' }); break;
    case 'act:fullscreen':    { const t = await getCurrentTab(); await chrome.tabs.sendMessage(t.id, { type: 'nexus:fullscreen' }).catch(() => {}); break; }
    case 'act:scroll-top':    { const t = await getCurrentTab(); await chrome.tabs.sendMessage(t.id, { type: 'nexus:scroll', dir: 'top' }).catch(() => {}); break; }
    case 'act:scroll-bottom': { const t = await getCurrentTab(); await chrome.tabs.sendMessage(t.id, { type: 'nexus:scroll', dir: 'bottom' }).catch(() => {}); break; }
    case 'act:print':         { const t = await getCurrentTab(); await chrome.tabs.sendMessage(t.id, { type: 'nexus:print' }).catch(() => {}); break; }
    case 'act:remove-all':    await chrome.browsingData.remove({ since: 0 }, { cache: true, cookies: true, history: true, indexedDB: true, localStorage: true, passwords: true }); break;
    case 'act:remove-history': await chrome.browsingData.removeHistory({ since: 0 }); break;
    case 'act:remove-cookies': await chrome.browsingData.removeCookies({ since: 0 }); break;
    case 'act:remove-cache':   await chrome.browsingData.removeCache({ since: 0 }); break;
    case 'act:remove-local-storage': await chrome.browsingData.removeLocalStorage({ since: 0 }); break;
    default:
      if (extra.url) await chrome.tabs.create({ url: extra.url });
      break;
  }
}

export async function init() {
  register('browser-tabs',      tabProvider);
  register('browser-bookmarks', bookmarkProvider);
  register('browser-history',   historyProvider);
  register('browser-shortcuts', shortcutProvider);
}

export const handlers = {
  'browser:get-actions': async (msg) => {

    const results = await registryQuery(msg.query || '');
    return { actions: results };
  },
  'browser:query': async (msg) => {
    const results = await registryQuery(msg.query || '');
    return { results };
  },
  'browser:do-action': async (msg) => {
    if (msg.actionType === 'tab')   { await switchTab(msg.tabId, msg.tabIndex, msg.windowId); return { ok: true }; }
    if (msg.type === 'bookmark' || msg.type === 'history') { await chrome.tabs.create({ url: msg.url }); return { ok: true }; }
    await doAction(msg.id, msg);
    return { ok: true };
  },
  'browser:remove': async (msg) => {
    if (msg.itemType === 'bookmark') await chrome.bookmarks.remove(msg.id).catch(() => {});
    else if (msg.itemType === 'tab') await chrome.tabs.remove(msg.tabId).catch(() => {});
    return { ok: true };
  },
  'browser:search': async (msg) => {
    await chrome.search.query({ text: msg.query });
    return { ok: true };
  },
  'browser:goto': async (msg) => {
    await chrome.tabs.create({ url: msg.url });
    return { ok: true };
  },
  'browser:search-history': async (msg) => {
    const data = await chrome.history.search({ text: msg.query, maxResults: 0, startTime: 0 });
    return { history: data };
  },
  'browser:search-bookmarks': async (msg) => {
    const data = await chrome.bookmarks.search({ query: msg.query });
    return { bookmarks: data.filter(b => b.url) };
  },

  'browser:open-nexus': async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    const isRestricted = !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');

    if (!isRestricted) {

      const sent = await chrome.tabs.sendMessage(tab.id, { type: 'nexus:open' })
        .then(() => true).catch(() => false);
      if (!sent) {

        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/overlay.js'] }).catch(() => {});
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/overlay.css'] }).catch(() => {});
        setTimeout(async () => {
          await chrome.tabs.sendMessage(tab.id, { type: 'nexus:open' }).catch(() => {});
        }, 80);
      }
    } else {

      await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
    }
    return { ok: true };
  },
};
