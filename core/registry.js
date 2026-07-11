'use strict';

// Prefixes that belong to action-type providers (shown first in empty-query palette)
const _providerRE = /^(webrtc:|fg:|ua:|bl:|proxy:)/;

const providers = new Map();

export const register   = (id, fn) => providers.set(id, fn);
export const unregister = (id)     => providers.delete(id);

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

export const query = async (text) => {
  const settled = await Promise.allSettled(
    [...providers.values()].map(p => withTimeout(p(text), 2000))
  );
  const flat = settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  if (!text) {
    const isAction = a => a.type === 'action' || _providerRE.test(a.id || '');
    return [...flat.filter(isAction), ...flat.filter(a => !isAction(a))];
  }

  return flat.sort(byRelevance(text));
};

const score = (item, q) => {
  const t  = (item.title || '').toLowerCase();
  const d  = (item.desc  || '').toLowerCase();
  const u  = (item.url   || '').toLowerCase();
  const ql = q.toLowerCase();
  if (t === ql)          return 200;
  if (t.startsWith(ql))  return 100;
  if (t.includes(ql))    return  40;
  if (u.includes(ql))    return  20;
  if (d.includes(ql))    return   5;
  return 0;
};
const byRelevance = q => (a, b) => score(b, q) - score(a, q);
