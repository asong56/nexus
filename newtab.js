'use strict';
// newtab.js — standalone palette page (used on restricted chrome:// tabs).
// Re-uses the same overlay-inner iframe; action dispatch mirrors overlay.js.

(function () {
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('content/overlay-inner.html');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:none;z-index:2147483647;background:transparent';
  document.body.appendChild(frame);

  frame.addEventListener('load', () => {
    document.getElementById('msg').style.display = 'none';
    frame.contentWindow.postMessage({ type: 'nexus:show' }, '*');
  });

  window.addEventListener('message', async e => {
    const { type, query, action, itemType, id, tabId } = e.data || {};
    if (!type?.startsWith('nexus:')) return;

    if (type === 'nexus:close') { window.close(); return; }

    if (type === 'nexus:query') {
      const res = await chrome.runtime.sendMessage({ type: 'browser:get-actions', query: query || '' }).catch(() => ({}));
      frame.contentWindow.postMessage({ type: 'nexus:results', actions: res?.actions || [] }, '*');
      return;
    }

    if (type === 'nexus:remove') {
      chrome.runtime.sendMessage({ type: 'browser:remove', itemType, id, tabId }).catch(() => {});
      return;
    }

    if (type === 'nexus:action' && action) {
      await dispatchAction(action);
      window.close();
    }
  });

  async function dispatchAction(action) {
    const id = action.id || '';
    let msg;

    if (id === 'browser:search' || action.action === 'search') {
      msg = { type: 'browser:search', query: action.query };
    } else if (id === 'browser:goto' || action.action === 'goto') {
      let url = action.query || action.url || '';
      if (url && !/^[\w-]+:\/\//i.test(url)) url = 'https://' + url;
      msg = { type: 'browser:goto', url };
    } else if (action.type === 'tab') {
      msg = { type: 'browser:do-action', actionType: 'tab',
              tabId: action.tabId, tabIndex: action.tabIndex, windowId: action.windowId };
    } else if (action.type === 'bookmark' || action.type === 'history') {
      msg = { type: 'browser:goto', url: action.url };
    } else if (id.startsWith('ua:set:')) {
      msg = { type: 'ua:set', ua: decodeURIComponent(id.slice(7)), mode: 'global' };
    } else {
      msg = { type: id, ...action };
    }

    await chrome.runtime.sendMessage(msg).catch(() => {});
  }
}());
