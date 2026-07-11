// providers/blacklist.js
// Reimplemented from uBlacklist-9.9.0 (Google-only, cloud sync removed)
// Rule formats: domain.com | *.wildcard.com | /regex/i
// Storage key: 'p.bl.rules' → string (one rule per line)

import { register } from '../core/registry.js';
import { get, set } from '../core/storage.js';

const RULES_KEY = 'p.bl.rules';

// ── Rule parsing ──────────────────────────────────────────────────────────────
function parseRules(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function ruleToMatcher(rule) {
  // /regex/ or /regex/flags
  const reParts = rule.match(/^\/(.+)\/([gimsuy]*)$/);
  if (reParts) {
    try { return new RegExp(reParts[1], reParts[2]); } catch { return null; }
  }
  // Wildcard: *.example.com
  if (rule.startsWith('*.')) {
    const base = rule.slice(2).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\.)${base}$`, 'i');
  }
  // Plain domain
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\.)${escaped}$`, 'i');
}

// Build matcher list from stored rules text
async function getMatchers() {
  const text = await get(RULES_KEY);
  return parseRules(text || '').map(ruleToMatcher).filter(Boolean);
}

export async function isBlocked(hostname) {
  if (!hostname) return false;
  const matchers = await getMatchers();
  return matchers.some(m => m.test(hostname));
}

async function getRuleCount() {
  const text = await get(RULES_KEY);
  return parseRules(text || '').length;
}

async function addRule(hostname) {
  const text = (await get(RULES_KEY)) || '';
  const existing = parseRules(text);
  if (existing.includes(hostname)) return { ok: true, added: false };
  const updated = [...existing, hostname].join('\n');
  await set(RULES_KEY, updated);
  return { ok: true, added: true };
}

function openOptions() {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/options.html#blacklist') });
}

// ── Provider init ─────────────────────────────────────────────────────────────
export async function init() {
  register('blacklist', async (q) => {
    const match = t => !q || t.toLowerCase().includes(q.toLowerCase());
    const count = await getRuleCount();
    const results = [];
    if (match('search filter settings')) {
      results.push({
        id: 'bl:open',
        title: 'Search Filter: Open settings',
        desc: `${count} rule${count !== 1 ? 's' : ''} active`,
        emoji: '🚫',
        type: 'action',
      });
    }
    if (match('block site search')) {
      results.push({
        id: 'bl:add-current',
        title: 'Search Filter: Block current site',
        desc: 'Hide this domain from Google results',
        emoji: '🚫',
        type: 'action',
      });
    }
    return results;
  });
}

export const handlers = {
  'bl:check': async (msg) => ({
    blocked: await isBlocked(msg.hostname),
  }),
  'bl:add': async (msg) => addRule(msg.hostname),
  'bl:add-current': async (_, sender) => {
    try {
      const tab = sender?.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const url = new URL(tab?.url || '');
      return addRule(url.hostname);
    } catch { return { ok: false }; }
  },
  'bl:remove': async (msg) => {
    const text = (await get(RULES_KEY)) || '';
    const updated = parseRules(text).filter(r => r !== msg.rule).join('\n');
    await set(RULES_KEY, updated);
    return { ok: true };
  },
  'bl:get-rules': async () => {
    const text = (await get(RULES_KEY)) || '';
    return { ok: true, rules: text };
  },
  'bl:set-rules': async (msg) => {
    await set(RULES_KEY, msg.rules || '');
    return { ok: true };
  },
  'bl:open': async () => {
    openOptions();
    return { ok: true };
  },
  'bl:open-options': async () => {
    openOptions();
    return { ok: true };
  },
};
