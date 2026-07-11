// providers/proxy.js — Nexus Proxy Manager
// Clean ES module replacing SwitchyOmega's ~2 MB of AngularJS + jQuery bundles.
// Supports: direct, system, fixed (HTTP/SOCKS5), PAC script, rule-based switch.

import { register } from '../core/registry.js';
import { get, set } from '../core/storage.js';

const KEY_PROFILES = 'p.proxy.profiles';
const KEY_ACTIVE   = 'p.proxy.active';

// Built-ins are never stored — always present, never editable or deletable.
const BUILTINS = [
  { name: 'direct', type: 'direct', color: '#5b5', builtin: true, desc: 'Connect directly, no proxy' },
  { name: 'system', type: 'system', color: '#888', builtin: true, desc: 'Use system proxy settings'  },
];

// ── Storage helpers ───────────────────────────────────────────────────────────
const loadCustom  = () => get(KEY_PROFILES).then(v => v || []);
const saveCustom  = ps => set(KEY_PROFILES, ps);
const loadActive  = () => get(KEY_ACTIVE).then(v => v || 'system');

async function allProfiles() { return [...BUILTINS, ...await loadCustom()]; }
async function findProfile(name) { return (await allProfiles()).find(p => p.name === name) ?? null; }

// ── PAC generation ────────────────────────────────────────────────────────────
// Converts a proxy profile to a PAC proxy string.
function pacStr(p) {
  if (!p || p.type === 'direct' || p.type === 'system') return 'DIRECT';
  if (p.type !== 'fixed') return 'DIRECT';
  const { protocol: pr, host, port } = p;
  if (pr === 'socks5') return `SOCKS5 ${host}:${port}`;
  if (pr === 'socks4') return `SOCKS ${host}:${port}`;
  return `PROXY ${host}:${port}`;
}

// Builds the FindProxyForURL PAC function for a switch profile.
async function buildPAC(profile) {
  const all = await allProfiles();
  const resolve = name => all.find(p => p.name === name);

  const lines = (profile.rules || []).map(r => {
    const s = JSON.stringify(pacStr(resolve(r.profile)));
    const pat = JSON.stringify(r.pattern || '');
    switch (r.condType) {
      case 'domain':
        return `  if(host===${pat}||host.endsWith('.'+${pat}))return ${s};`;
      case 'wildcard':
        return `  if(shExpMatch(host,${pat})||shExpMatch(url,${pat}))return ${s};`;
      case 'urlwildcard':
        return `  if(shExpMatch(url,${pat}))return ${s};`;
      case 'regex': {
        const m = (r.pattern || '').match(/^\/(.+)\/([gimsuy]*)$/);
        const src = JSON.stringify(m ? m[1] : r.pattern);
        const flg = JSON.stringify(m ? m[2] : '');
        return `  if(new RegExp(${src},${flg}).test(url))return ${s};`;
      }
      default: return '';
    }
  }).filter(Boolean);

  const fallback = JSON.stringify(pacStr(resolve(profile.defaultProfile)));
  return `/* Nexus proxy — auto-generated */\nfunction FindProxyForURL(url,host){\n${lines.join('\n')}\n  return ${fallback};\n}`;
}

// ── Apply profile via chrome.proxy ────────────────────────────────────────────
async function apply(name) {
  const p = await findProfile(name);
  if (!p) throw new Error(`Unknown proxy profile: "${name}"`);
  await set(KEY_ACTIVE, name);

  if (p.type === 'system')  { chrome.proxy.settings.clear({ scope: 'regular' }); return; }
  if (p.type === 'direct')  { chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' }); return; }

  if (p.type === 'fixed') {
    const scheme = p.protocol === 'socks5' ? 'socks5' : p.protocol === 'socks4' ? 'socks4' : p.protocol;
    chrome.proxy.settings.set({
      value: { mode: 'fixed_servers', rules: {
        singleProxy: { scheme, host: p.host, port: Number(p.port) },
        bypassList: p.bypass || [],
      }},
      scope: 'regular',
    });
    return;
  }

  if (p.type === 'pac') {
    const pacScript = p.pacUrl ? { url: p.pacUrl } : { data: p.pacData || 'function FindProxyForURL(){return"DIRECT";}' };
    chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript }, scope: 'regular' });
    return;
  }

  if (p.type === 'switch') {
    const data = await buildPAC(p);
    chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data } }, scope: 'regular' });
    return;
  }
}

// ── Command palette items ─────────────────────────────────────────────────────
async function paletteItems(q) {
  const lq     = (q || '').toLowerCase();
  const active = await loadActive();
  const all    = await allProfiles();
  const items  = [];

  if (!lq || 'proxy settings'.includes(lq))
    items.push({ id: 'proxy:open-options', title: 'Proxy: Open settings',
                 desc: 'Manage proxy profiles', emoji: '🔀', type: 'action' });

  for (const p of all) {
    const label = `${p.name} (${p.type})`;
    if (lq && !label.toLowerCase().includes(lq)) continue;
    items.push({
      id:    `proxy:switch:${encodeURIComponent(p.name)}`,
      title: `Proxy → ${p.name}`,
      desc:  p.desc || label,
      emoji: active === p.name ? '🟢' : '🔀',
      type:  'action',
    });
  }
  return items;
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function init() {
  register('proxy', paletteItems);
  try { await apply(await loadActive()); }
  catch (e) { console.warn('[Proxy] Could not restore profile on init:', e); }
}

// ── Dynamic palette action: proxy:switch:<name> ───────────────────────────────
// Called by background.js before the static handler table.
export function handleProxyAction(type) {
  if (!type?.startsWith('proxy:switch:')) return null;
  const name = decodeURIComponent(type.slice('proxy:switch:'.length));
  return () => apply(name).then(() => ({ ok: true, active: name }));
}

// ── Message handlers ──────────────────────────────────────────────────────────
export const handlers = {

  'proxy:list':   async ()    => ({ ok: true, profiles: await allProfiles() }),
  'proxy:active': async ()    => { const name = await loadActive(); return { ok: true, name, profile: await findProfile(name) }; },

  'proxy:create': async msg => {
    const ps = await loadCustom();
    if (BUILTINS.some(b => b.name === msg.name) || ps.some(p => p.name === msg.name))
      return { ok: false, error: 'Name already exists' };
    const p = { name: msg.name, color: '#9ce', type: 'fixed',
                protocol: 'http', host: '', port: 8080, bypass: ['localhost','127.0.0.1'],
                ...msg.profile };
    ps.push(p);
    await saveCustom(ps);
    return { ok: true, profile: p };
  },

  'proxy:update': async msg => {
    if (BUILTINS.some(b => b.name === msg.name)) return { ok: false, error: 'Built-in profiles are read-only' };
    const ps  = await loadCustom();
    const idx = ps.findIndex(p => p.name === msg.name);
    if (idx < 0) return { ok: false, error: 'Not found' };
    ps[idx] = { ...ps[idx], ...msg.patch };
    await saveCustom(ps);
    if ((await loadActive()) === msg.name) await apply(msg.name).catch(() => {});
    return { ok: true, profile: ps[idx] };
  },

  'proxy:delete': async msg => {
    if (BUILTINS.some(b => b.name === msg.name)) return { ok: false, error: 'Built-in profiles are read-only' };
    const ps   = await loadCustom();
    const next = ps.filter(p => p.name !== msg.name);
    if (next.length === ps.length) return { ok: false, error: 'Not found' };
    await saveCustom(next);
    if ((await loadActive()) === msg.name) { await set(KEY_ACTIVE, 'system'); await apply('system').catch(() => {}); }
    return { ok: true };
  },

  'proxy:switch': async msg => {
    await apply(msg.name);
    return { ok: true, active: msg.name };
  },

  'proxy:preview-pac': async msg => {
    const p = await findProfile(msg.name);
    if (!p)              return { ok: false, error: 'Not found' };
    if (p.type !== 'switch') return { ok: false, error: 'Only switch profiles generate PAC' };
    return { ok: true, data: await buildPAC(p) };
  },

  'proxy:open-options': async () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/options.html#proxy') });
    return { ok: true };
  },
};
