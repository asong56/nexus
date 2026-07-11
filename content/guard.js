'use strict';

let _ctxValid = true;

function safeSend(msg, respond) {
  if (!_ctxValid) return;
  try {
    const p = chrome.runtime.sendMessage(msg);
    (respond ? p.then(respond) : p).catch(() => {});
  } catch (e) {
    if (String(e).includes('invalidated')) { _ctxValid = false; cleanup(); }
  }
}

function cleanup() {
  gTimer?.remove();
  gAlert?.remove();
}

const TIMER_SIZES = ['10px', '12px', '14px', '16px'];
const TIMER_LOCATIONS = [
  ['0px',  'auto', '0px',  'auto'],
  ['0px',  'auto', 'auto', '0px' ],
  ['auto', '0px',  'auto', '0px' ],
  ['auto', '0px',  '0px',  'auto'],
];

let gTimer = null;
let gAlert = null;

function updateTimer(text, size, location) {
  if (!text) { if (gTimer) gTimer.hidden = true; return; }
  if (!gTimer) {
    gTimer = document.createElement('div');
    gTimer.className = 'nexus-guard-timer';
    gTimer.addEventListener('dblclick', () => { gTimer.style.display = 'none'; });
  }
  if (!document.documentElement.contains(gTimer))
    document.documentElement.appendChild(gTimer);
  gTimer.innerText = text;
  if (size >= 0 && size < TIMER_SIZES.length)
    gTimer.style.fontSize = TIMER_SIZES[size];
  if (location >= 0 && location < TIMER_LOCATIONS.length) {
    const [top, bottom, left, right] = TIMER_LOCATIONS[location];
    Object.assign(gTimer.style, { top, bottom, left, right });
  }
  gTimer.hidden = false;
}

function showAlert(text) {
  if (!gAlert) {
    gAlert = document.createElement('div');
    gAlert.className = 'nexus-guard-alert-container';
    const box = document.createElement('div');
    box.className = 'nexus-guard-alert-box';
    box.addEventListener('click', () => { gAlert.style.display = 'none'; });
    const icon = document.createElement('div');
    icon.className = 'nexus-guard-alert-icon';
    const txt = document.createElement('div');
    txt.className = 'nexus-guard-alert-text';
    box.appendChild(icon);
    box.appendChild(txt);
    gAlert.appendChild(box);
    document.documentElement.appendChild(gAlert);
  }
  gAlert.querySelector('.nexus-guard-alert-text').innerText = text;
  gAlert.style.display = 'flex';
}

function applyFilter(filterName, filterCustom) {
  const filters = {
    'blur (1px)': 'blur(1px)', 'blur (2px)': 'blur(2px)', 'blur (4px)': 'blur(4px)',
    'blur (8px)': 'blur(8px)', 'blur (16px)': 'blur(16px)', 'blur (32px)': 'blur(32px)',
    'fade (80%)': 'opacity(20%)', 'fade (90%)': 'opacity(10%)', 'fade (100%)': 'opacity(0%)',
    'grayscale': 'grayscale(100%)', 'invert': 'invert(100%)', 'sepia': 'sepia(100%)',
    'custom': filterCustom,
  };
  document.documentElement.style.filter = filters[filterName] || 'none';
}

safeSend({ type: 'fg:loaded',   url: document.URL });
safeSend({ type: 'fg:referrer', referrer: document.referrer });

window.addEventListener('focus', () => safeSend({ type: 'fg:focus', focus: true  }));
window.addEventListener('blur',  () => safeSend({ type: 'fg:focus', focus: false }));

chrome.runtime.onMessage.addListener((msg, _, respond) => {
      switch (msg.type) {
        case 'fg:timer':   updateTimer(msg.text, msg.size, msg.location); break;
        case 'fg:alert':   showAlert(msg.text);   break;
        case 'fg:filter':  applyFilter(msg.filterName, msg.filterCustom); break;
        case 'fg:keyword': {
          if (!msg.keywordRE) { respond(null); return true; }
          const text = document.title + ((!msg.titleOnly && document.body) ? '\n' + document.body.innerText : '');
          const m = new RegExp(msg.keywordRE, 'iu').exec(text);
          respond(m ? m[0] : null);
          return true;
        }
        case 'fg:ping':
          safeSend({ type: 'fg:loaded', url: document.URL });
          break;
        case 'nexus:scroll':
          if      (msg.dir === 'top')    window.scrollTo({ top: 0,                          behavior: 'smooth' });
          else if (msg.dir === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          break;
        case 'nexus:print':       window.print(); break;
        case 'nexus:fullscreen':
          if (!document.fullscreenElement)
            document.documentElement.requestFullscreen().catch(() => {});
          else
            document.exitFullscreen().catch(() => {});
          break;
      }
});


const timerStyle = document.createElement('style');
timerStyle.textContent = `
.nexus-guard-timer {
  position: fixed; z-index: 2147483647;
  font-family: monospace; font-size: 12px;
  background: rgba(0,0,0,.7); color: #fff;
  padding: 2px 6px; border-radius: 3px;
  pointer-events: none; user-select: none;
}
.nexus-guard-alert-container {
  position: fixed; inset: 0; z-index: 2147483647;
  display: none; align-items: flex-start; justify-content: center;
  padding-top: 40px;
}
.nexus-guard-alert-box {
  background: #b00; color: #fff;
  padding: 12px 20px; border-radius: 8px;
  font-family: system-ui, sans-serif; font-size: 14px;
  cursor: pointer; max-width: 400px;
}
`;
document.documentElement.appendChild(timerStyle);

if (/^https:\/\/www\.google\.[^/]+\/search/.test(location.href)) {
  initSerpFilter();
}

function initSerpFilter() {
  const cache = new Map();

  async function checkHostname(hostname) {
    if (cache.has(hostname)) return cache.get(hostname);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'bl:check', hostname });
      const blocked = result?.blocked ?? false;
      cache.set(hostname, blocked);
      return blocked;
    } catch { cache.set(hostname, false); return false; }
  }

  function extractHostname(el) {
    const cite = el.querySelector('cite');
    if (cite) {
      try { return new URL('https://' + cite.textContent.trim().split('/')[0]).hostname; } catch {}
    }
    const link = el.querySelector('a[href]');
    if (link) {
      try { return new URL(link.href).hostname; } catch {}
    }
    return null;
  }

  function markAsBlocked(el) {
    if (el.dataset.nexusFiltered) return;
    el.dataset.nexusFiltered = '1';
    el.style.display = 'none';
    const marker = document.createElement('div');
    marker.style.cssText = 'font-size:12px;color:#999;padding:2px 0;cursor:pointer;';
    marker.textContent = '⊘ Hidden by Nexus Search Filter — click to show';
    marker.addEventListener('click', () => { el.style.display = ''; marker.remove(); });
    el.parentNode?.insertBefore(marker, el);
  }

  async function processResults(root) {
    if (!_ctxValid) return;
    const items = (root || document).querySelectorAll('#search .g, #rso .g, #search [data-hveid]');
    for (const item of items) {
      if (item.dataset.nexusFiltered) continue;
      const hostname = extractHostname(item);
      if (!hostname) continue;
      const blocked = await checkHostname(hostname);
      if (blocked) markAsBlocked(item);
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => processResults(null));
  else
    processResults(null);

  const observer = new MutationObserver(mutations => {
    if (!_ctxValid) { observer.disconnect(); return; }
    for (const mutation of mutations)
      for (const node of mutation.addedNodes)
        if (node.nodeType === 1) processResults(node);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
