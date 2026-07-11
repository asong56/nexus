'use strict';

// ── Shared utilities ──────────────────────────────────────────────────────────
function esc(s) {
  return (s ?? '').toString()
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatus(id, msg, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent   = msg;
  el.style.color   = isError ? 'var(--danger)' : 'var(--sub)';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 3000);
}

// ── Nav ───────────────────────────────────────────────────────────────────────
const navItems = document.querySelectorAll('.nav-item');
const panels   = document.querySelectorAll('.panel');

function showPanel(name) {
  navItems.forEach(n => n.classList.toggle('active', n.dataset.panel === name));
  panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  history.replaceState(null, '', '#' + name);
}

navItems.forEach(n => n.addEventListener('click', () => showPanel(n.dataset.panel)));
const initHash = location.hash.slice(1);
if (initHash) showPanel(initHash);

// ── WebRTC ────────────────────────────────────────────────────────────────────
async function loadWebRTC() {
  const res = await chrome.runtime.sendMessage({ type: 'webrtc:get' });
  const mode = res?.mode || 'off';
  document.querySelectorAll('input[name="webrtc-mode"]').forEach(r => { r.checked = r.value === mode; });
}
document.getElementById('save-webrtc').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="webrtc-mode"]:checked')?.value || 'off';
  await chrome.runtime.sendMessage({ type: 'webrtc:set', mode });
  setStatus('webrtc-status', 'Applied. ✓');
});
loadWebRTC();

// ── User-Agent ────────────────────────────────────────────────────────────────
async function loadUA() {
  const res     = await chrome.runtime.sendMessage({ type: 'ua:list-presets' });
  const presets = res?.presets || [];
  const sel     = document.getElementById('ua-preset-select');

  const groups = {};
  for (const p of presets) (groups[p.group] ??= []).push(p);
  for (const [group, items] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const { ua, title } of items) {
      const opt = document.createElement('option');
      opt.value = ua; opt.textContent = title;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }

  const active = await chrome.runtime.sendMessage({ type: 'ua:get' });
  const a = active?.active;
  if (a?.ua) {
    document.getElementById('ua-active').textContent = a.ua;
    document.getElementById('ua-mode').value = a.mode || 'global';
    if (a.domain) document.getElementById('ua-domain').value = a.domain;
  }
}
document.getElementById('ua-mode').addEventListener('change', e => {
  document.getElementById('ua-domain-row').style.display = e.target.value === 'domain' ? 'flex' : 'none';
});
document.getElementById('ua-preset-select').addEventListener('change', e => {
  document.getElementById('ua-custom').value = e.target.value;
});
document.getElementById('save-ua').addEventListener('click', async () => {
  const ua     = document.getElementById('ua-custom').value.trim();
  const mode   = document.getElementById('ua-mode').value;
  const domain = document.getElementById('ua-domain').value.trim();
  if (!ua) { setStatus('ua-status', 'Enter a UA string or pick a preset.', true); return; }
  await chrome.runtime.sendMessage({ type: 'ua:set', ua, mode, domain: domain || undefined });
  document.getElementById('ua-active').textContent = ua;
  setStatus('ua-status', 'Applied. ✓');
});
document.getElementById('reset-ua').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'ua:reset' });
  document.getElementById('ua-active').textContent = 'None';
  document.getElementById('ua-custom').value = '';
  document.getElementById('ua-preset-select').value = '';
  setStatus('ua-status', 'Reset. ✓');
});
loadUA();

// ── Search Filter ─────────────────────────────────────────────────────────────
async function loadBL() {
  const res = await chrome.runtime.sendMessage({ type: 'bl:get-rules' });
  document.getElementById('bl-rules').value = res?.rules || '';
}
document.getElementById('save-bl').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'bl:set-rules', rules: document.getElementById('bl-rules').value });
  setStatus('bl-status', 'Saved. ✓');
});
document.getElementById('export-bl').addEventListener('click', () => {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([document.getElementById('bl-rules').value], { type:'text/plain' })),
    download: 'nexus-blocklist.txt',
  });
  a.click();
});
document.getElementById('import-bl').addEventListener('click', () => document.getElementById('bl-import-file').click());
document.getElementById('bl-import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => { document.getElementById('bl-rules').value = ev.target.result; };
  r.readAsText(file);
});
document.getElementById('bl-test-btn').addEventListener('click', async () => {
  const hostname = document.getElementById('bl-test-input').value.trim();
  if (!hostname) return;
  const res = await chrome.runtime.sendMessage({ type: 'bl:check', hostname });
  const el = document.getElementById('bl-test-result');
  el.textContent  = res?.blocked ? `✓ "${hostname}" would be hidden` : `✗ "${hostname}" would NOT be hidden`;
  el.style.color  = res?.blocked ? 'var(--danger)' : 'var(--sub)';
});
loadBL();

// ── Focus Guard ───────────────────────────────────────────────────────────────
let fgOptions = {};
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const DEFAULT_DAYS = [false,true,true,true,true,true,false];

async function loadFG() {
  fgOptions = await chrome.storage.local.get(null);
  const n   = parseInt(fgOptions.numSets) || 6;
  document.getElementById('fg-num-sets').value         = n;
  document.getElementById('fg-timer-visible').checked  = fgOptions.timerVisible !== false;
  document.getElementById('fg-context-menu').checked   = fgOptions.contextMenu  !== false;
  document.getElementById('fg-match-subdomains').checked = !!fgOptions.matchSubdomains;
  renderSets(n);
}

function renderSets(n) {
  const container = document.getElementById('fg-sets');
  container.innerHTML = '';
  for (let s = 1; s <= n; s++) {
    const name  = fgOptions[`setName${s}`] || '';
    const sites = (fgOptions[`sites${s}`] || '').replace(/ /g, '\n');
    const days  = fgOptions[`days${s}`] || DEFAULT_DAYS;
    const lp    = fgOptions[`limitPeriod${s}`] || '86400';

    const detail = document.createElement('details');
    detail.className = 'set-block';
    detail.innerHTML = `
      <summary class="set-header">
        <span class="set-number">Set ${s}</span>
        <span class="set-name" id="sn-label-${s}">${esc(name) || 'unnamed'}</span>
        <span class="set-chevron"></span>
      </summary>
      <div>
        <div class="field-group" style="margin:12px">
          <div class="field">
            <div class="field-label"><strong>Name</strong></div>
            <input type="text" id="fg-setName${s}" value="${esc(name)}" placeholder="e.g. Social Media" style="width:200px">
          </div>
          <div class="field" style="flex-direction:column;align-items:stretch;gap:6px">
            <div class="field-label"><strong>Sites to block</strong><span>One per line. Wildcards: *.domain.com</span></div>
            <textarea id="fg-sites${s}" rows="4" placeholder="reddit.com&#10;twitter.com">${esc(sites)}</textarea>
          </div>
          <div class="field">
            <div class="field-label"><strong>Time periods</strong><span>e.g. 0900-1700,2200-2400</span></div>
            <input type="text" id="fg-times${s}" value="${esc(fgOptions[`times${s}`] || '')}" placeholder="0000-2400" style="width:180px">
          </div>
          <div class="field">
            <div class="field-label"><strong>Time limit (mins/period)</strong></div>
            <input type="number" id="fg-limitMins${s}" value="${esc(fgOptions[`limitMins${s}`] || '')}" placeholder="e.g. 30" style="width:80px">
            <select id="fg-limitPeriod${s}" style="margin-left:6px">
              <option value="3600"   ${lp==='3600'   ?'selected':''}>per hour</option>
              <option value="86400"  ${lp==='86400'  ?'selected':''}>per day</option>
              <option value="604800" ${lp==='604800' ?'selected':''}>per week</option>
            </select>
          </div>
          <div class="field">
            <div class="field-label"><strong>Active days</strong></div>
            <div style="display:flex;gap:6px">${DAYS.map((d,i) => `
              <label style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;cursor:pointer">
                <input type="checkbox" id="fg-day${s}-${i}" ${days[i]?'checked':''}> ${d}
              </label>`).join('')}
            </div>
          </div>
          <div class="field">
            <div class="field-label"><strong>Disable this set</strong></div>
            <label class="toggle"><input type="checkbox" id="fg-disable${s}" ${fgOptions[`disable${s}`]?'checked':''}><span class="toggle-track"></span></label>
          </div>
        </div>
      </div>`;
    container.appendChild(detail);
    document.getElementById(`fg-setName${s}`).addEventListener('input', e => {
      document.getElementById(`sn-label-${s}`).textContent = e.target.value || 'unnamed';
    });
  }
}

document.getElementById('fg-num-sets').addEventListener('change', e => {
  renderSets(Math.max(1, Math.min(30, parseInt(e.target.value) || 6)));
});

document.getElementById('save-fg').addEventListener('click', async () => {
  const n  = parseInt(document.getElementById('fg-num-sets').value) || 6;
  const updates = {
    numSets:         n.toString(),
    timerVisible:    document.getElementById('fg-timer-visible').checked,
    contextMenu:     document.getElementById('fg-context-menu').checked,
    matchSubdomains: document.getElementById('fg-match-subdomains').checked,
  };
  for (let s = 1; s <= n; s++) {
    updates[`setName${s}`]     = document.getElementById(`fg-setName${s}`)?.value || '';
    updates[`sites${s}`]       = (document.getElementById(`fg-sites${s}`)?.value || '').split('\n').map(x=>x.trim()).filter(Boolean).join(' ');
    updates[`times${s}`]       = document.getElementById(`fg-times${s}`)?.value || '';
    updates[`limitMins${s}`]   = document.getElementById(`fg-limitMins${s}`)?.value || '';
    updates[`limitPeriod${s}`] = document.getElementById(`fg-limitPeriod${s}`)?.value || '86400';
    updates[`disable${s}`]     = document.getElementById(`fg-disable${s}`)?.checked || false;
    updates[`days${s}`]        = DAYS.map((_, i) => document.getElementById(`fg-day${s}-${i}`)?.checked || false);
  }
  await chrome.storage.local.set(updates);
  await chrome.runtime.sendMessage({ type: 'fg:options', ordering: null });
  fgOptions = { ...fgOptions, ...updates };
  setStatus('fg-status', 'Saved. ✓');
});

document.getElementById('fg-lockdown-btn').addEventListener('click', () =>
  window.open(chrome.runtime.getURL('pages/lockdown.html'), '_blank')
);
loadFG();

// ── Command Palette: custom shortcuts ─────────────────────────────────────────
const SC_KEY = 'p.palette.shortcuts';
let shortcuts = [];

async function loadPalette() {
  const r = await chrome.storage.local.get(SC_KEY);
  shortcuts = r[SC_KEY] || [];
  renderShortcuts();
}

function renderShortcuts() {
  const list = document.getElementById('shortcut-list');
  list.innerHTML = '';
  shortcuts.forEach((sc, i) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.innerHTML = `
      <input type="text"  value="${esc(sc.title)}" placeholder="Title"      data-i="${i}" data-f="title" style="width:160px">
      <input type="text"  value="${esc(sc.url)}"   placeholder="https://…"  data-i="${i}" data-f="url">
      <span class="shortcut-rm" data-i="${i}" title="Remove">✕</span>`;
    list.appendChild(row);
  });
  list.querySelectorAll('input').forEach(inp =>
    inp.addEventListener('input', e => { shortcuts[e.target.dataset.i][e.target.dataset.f] = e.target.value; })
  );
  list.querySelectorAll('.shortcut-rm').forEach(btn =>
    btn.addEventListener('click', e => { shortcuts.splice(+e.target.dataset.i, 1); renderShortcuts(); })
  );
}

document.getElementById('add-shortcut').addEventListener('click', () => { shortcuts.push({ title:'', url:'' }); renderShortcuts(); });
document.getElementById('save-palette').addEventListener('click', async () => {
  await chrome.storage.local.set({ [SC_KEY]: shortcuts });
  setStatus('palette-status', 'Saved. ✓');
});
loadPalette();

// ── Proxy ─────────────────────────────────────────────────────────────────────
const PROXY_COLORS = ['#9ce','#9d9','#fa8','#fe9','#d497ee','#47b','#5b5','#d63','#ca0'];
const COND_PLACEHOLDERS = { domain:'example.com', wildcard:'*.example.com', urlwildcard:'https://*.example.com/*', regex:'/\\.example\\.com\\//i' };

let proxyProfiles  = [];
let editingName    = null;   // null = new profile
let editRules      = [];     // rules for the switch editor

function profileMeta(p) {
  if (p.type === 'direct') return 'No proxy — direct connection';
  if (p.type === 'system') return 'Use system proxy settings';
  if (p.type === 'fixed')  return `${(p.protocol||'http').toUpperCase()}  ${p.host||'?'}:${p.port||'?'}`;
  if (p.type === 'pac')    return p.pacUrl ? `PAC: ${p.pacUrl}` : 'PAC (inline script)';
  if (p.type === 'switch') return `Auto-switch · ${(p.rules||[]).length} rules · default: ${p.defaultProfile||'direct'}`;
  return p.type;
}

async function loadProxy() {
  const [lr, ar] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'proxy:list'   }),
    chrome.runtime.sendMessage({ type: 'proxy:active' }),
  ]);
  proxyProfiles = lr?.profiles || [];
  const active  = ar?.name || 'system';
  const ap      = proxyProfiles.find(p => p.name === active);

  document.getElementById('proxy-active-dot').style.background = ap?.color || '#888';
  document.getElementById('proxy-active-name').textContent = active;

  const list = document.getElementById('proxy-profile-list');
  list.innerHTML = '';
  for (const p of proxyProfiles) {
    const card = document.createElement('div');
    card.className = 'profile-card' + (p.name === active ? ' is-active' : '');
    card.innerHTML = `
      <span class="profile-dot" style="background:${esc(p.color||'#888')}"></span>
      <div class="profile-info">
        <div class="profile-name">${esc(p.name)}</div>
        <div class="profile-meta">${esc(profileMeta(p))}</div>
      </div>
      <div class="profile-btns">
        <button class="btn btn-primary btn-sm"  data-action="apply" data-name="${esc(p.name)}">Apply</button>
        ${!p.builtin ? `<button class="btn btn-outline btn-sm" data-action="edit"  data-name="${esc(p.name)}">Edit</button>` : ''}
      </div>`;
    list.appendChild(card);
  }

}


function openEditor(name) {
  editingName = name;
  const p = proxyProfiles.find(x => x.name === name);
  if (!p) return;

  document.getElementById('proxy-editor-title').textContent = `Edit: ${p.name}`;
  document.getElementById('pe-name').value  = p.name;
  document.getElementById('pe-color').value = p.color || '#9ce';
  setEditorType(p.type);

  if (p.type === 'fixed') {
    document.getElementById('pe-protocol').value = p.protocol || 'http';
    document.getElementById('pe-host').value     = p.host     || '';
    document.getElementById('pe-port').value     = p.port     || '';
    document.getElementById('pe-bypass').value   = (p.bypass||[]).join('\n');
  } else if (p.type === 'pac') {
    document.getElementById('pe-pac-url').value  = p.pacUrl  || '';
    document.getElementById('pe-pac-data').value = p.pacData || '';
  } else if (p.type === 'switch') {
    fillSwitchDefault(p.defaultProfile);
    syncRules(p.rules || []);
    document.getElementById('pe-pac-preview').style.display = 'none';
  }

  document.getElementById('pe-delete').style.display = '';
  showEditor();
}

function openEditorNew(type) {
  editingName = null;
  document.getElementById('proxy-editor-title').textContent = 'New Profile';
  document.getElementById('pe-name').value    = '';
  document.getElementById('pe-color').value   = PROXY_COLORS[Math.floor(Math.random() * PROXY_COLORS.length)];
  document.getElementById('pe-protocol').value = 'http';
  document.getElementById('pe-host').value     = '';
  document.getElementById('pe-port').value     = '';
  document.getElementById('pe-bypass').value   = 'localhost\n127.0.0.1';
  document.getElementById('pe-pac-url').value  = '';
  document.getElementById('pe-pac-data').value = "function FindProxyForURL(url, host) {\n  return 'DIRECT';\n}";
  setEditorType(type);
  if (type === 'switch') { fillSwitchDefault('direct'); syncRules([]); }
  document.getElementById('pe-delete').style.display = 'none';
  showEditor();
}

function showEditor() {
  const ed = document.getElementById('proxy-editor');
  ed.classList.add('open');
  ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditor() {
  editingName = null;
  document.getElementById('proxy-editor').classList.remove('open');
}

function setEditorType(type) {
  document.getElementById('pe-fixed-fields').style.display  = type === 'fixed'  ? '' : 'none';
  document.getElementById('pe-pac-fields').style.display    = type === 'pac'    ? '' : 'none';
  document.getElementById('pe-switch-fields').style.display = type === 'switch' ? '' : 'none';
  document.getElementById('proxy-editor').dataset.type = type;
}

function fillSwitchDefault(selected) {
  document.getElementById('pe-switch-default').innerHTML =
    proxyProfiles.map(p => `<option value="${esc(p.name)}" ${p.name===selected?'selected':''}>${esc(p.name)}</option>`).join('');
}

// ── Rules ─────────────────────────────────────────────────────────────────────
function syncRules(rules) {
  editRules = rules.map(r => ({ ...r }));
  renderRules();
}

function renderRules() {
  const opts = proxyProfiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  const frag = document.createDocumentFragment();

  editRules.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <select class="rc" data-i="${i}">
        <option value="domain"      ${r.condType==='domain'     ?'selected':''}>Domain</option>
        <option value="wildcard"    ${r.condType==='wildcard'   ?'selected':''}>Host wildcard</option>
        <option value="urlwildcard" ${r.condType==='urlwildcard'?'selected':''}>URL wildcard</option>
        <option value="regex"       ${r.condType==='regex'      ?'selected':''}>URL regex</option>
      </select>
      <input class="rule-pattern rp" type="text" value="${esc(r.pattern||'')}"
             placeholder="${esc(COND_PLACEHOLDERS[r.condType]||'')}" data-i="${i}">
      <span class="rule-arrow">→</span>
      <select class="rf" data-i="${i}">${opts}</select>
      <span class="rule-rm" data-i="${i}">✕</span>`;
    frag.appendChild(row);
    // Set profile select to current value after insert
    row.querySelector('.rf').value = r.profile || 'direct';
  });

  const container = document.getElementById('pe-rules-list');
  container.innerHTML = '';
  container.appendChild(frag);

  container.querySelectorAll('.rc').forEach(el => el.addEventListener('change', e => {
    const i = +e.target.dataset.i;
    editRules[i].condType = e.target.value;
    e.target.closest('.rule-row').querySelector('.rp').placeholder = COND_PLACEHOLDERS[e.target.value] || '';
  }));
  container.querySelectorAll('.rp').forEach(el => el.addEventListener('input', e => {
    editRules[+e.target.dataset.i].pattern = e.target.value;
  }));
  container.querySelectorAll('.rf').forEach(el => el.addEventListener('change', e => {
    editRules[+e.target.dataset.i].profile = e.target.value;
  }));
  container.querySelectorAll('.rule-rm').forEach(el => el.addEventListener('click', e => {
    editRules.splice(+e.target.dataset.i, 1);
    renderRules();
  }));
}

document.getElementById('pe-add-rule').addEventListener('click', () => {
  editRules.push({ condType: 'domain', pattern: '', profile: 'direct' });
  renderRules();
});

document.getElementById('pe-preview-pac').addEventListener('click', async () => {
  if (!editingName) { setStatus('proxy-editor-status', 'Save the profile first to preview PAC.', true); return; }
  const res = await chrome.runtime.sendMessage({ type: 'proxy:preview-pac', name: editingName });
  const el  = document.getElementById('pe-pac-preview');
  if (res?.ok) { el.textContent = res.data; el.style.display = ''; }
  else setStatus('proxy-editor-status', res?.error || 'Preview failed.', true);
});

// ── Save / Delete ─────────────────────────────────────────────────────────────
document.getElementById('pe-save').addEventListener('click', async () => {
  const type  = document.getElementById('proxy-editor').dataset.type;
  const name  = document.getElementById('pe-name').value.trim();
  const color = document.getElementById('pe-color').value;

  if (!name) { setStatus('proxy-editor-status', 'Profile name required.', true); return; }

  const patch = { name, color, type };

  if (type === 'fixed') {
    const host = document.getElementById('pe-host').value.trim();
    const port = parseInt(document.getElementById('pe-port').value);
    if (!host || !port || port < 1 || port > 65535) {
      setStatus('proxy-editor-status', 'Valid host and port (1–65535) required.', true); return;
    }
    patch.protocol = document.getElementById('pe-protocol').value;
    patch.host = host; patch.port = port;
    patch.bypass = document.getElementById('pe-bypass').value.split('\n').map(s=>s.trim()).filter(Boolean);
  } else if (type === 'pac') {
    patch.pacUrl  = document.getElementById('pe-pac-url').value.trim();
    patch.pacData = document.getElementById('pe-pac-data').value;
  } else if (type === 'switch') {
    patch.defaultProfile = document.getElementById('pe-switch-default').value;
    patch.rules = editRules;
  }

  let res;
  if (editingName && editingName !== name) {
    await chrome.runtime.sendMessage({ type: 'proxy:delete', name: editingName });
    res = await chrome.runtime.sendMessage({ type: 'proxy:create', name, profile: patch });
  } else if (editingName) {
    res = await chrome.runtime.sendMessage({ type: 'proxy:update', name, patch });
  } else {
    res = await chrome.runtime.sendMessage({ type: 'proxy:create', name, profile: patch });
  }

  if (res?.ok) { closeEditor(); await loadProxy(); setStatus('proxy-status', `Saved "${name}". ✓`); }
  else setStatus('proxy-editor-status', res?.error || 'Save failed.', true);
});

document.getElementById('pe-delete').addEventListener('click', async () => {
  if (!editingName || !confirm(`Delete profile "${editingName}"?`)) return;
  const res = await chrome.runtime.sendMessage({ type: 'proxy:delete', name: editingName });
  if (res?.ok) { closeEditor(); await loadProxy(); setStatus('proxy-status', 'Deleted. ✓'); }
  else setStatus('proxy-editor-status', res?.error || 'Delete failed.', true);
});

document.getElementById('pe-cancel').addEventListener('click', closeEditor);

document.getElementById('proxy-add-fixed').addEventListener('click',  () => openEditorNew('fixed'));
document.getElementById('proxy-add-pac').addEventListener('click',    () => openEditorNew('pac'));
document.getElementById('proxy-add-switch').addEventListener('click', () => openEditorNew('switch'));

loadProxy();
