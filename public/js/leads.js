'use strict';
/* Leads: one server-filtered result set shown as a list and on the map. */
let LEADS = [], map = null, dotLayer = null, routeLayer = null, mePos = null, meDot = null, listLimit = 80, loadSeq = 0, leadsLoaded = false;
const LIMIT = 500;

function leadParams(F = U.F, limit = LIMIT) {
  const p = new URLSearchParams();
  if (F.q) p.set('q', F.q);
  if (F.city) p.set('city', F.city);
  if (F.type) p.set('type', F.type);
  if (F.use) p.set('use', F.use);
  if (F.min) p.set('minValue', F.min);
  if (F.days) p.set('from', ymd(new Date(Date.now() - F.days * DAY)));
  if (F.score) p.set('minScore', F.score);
  if (F.sort !== 'score') p.set('sort', F.sort);
  if (F.builder) p.set('builder', F.builder);
  if (F.contact) p.set('hasContact', '1');
  if (F.named) p.set('hasBuilder', '1');
  if (F.saved) p.set('saved', '1'); else if (F.untouched) p.set('saved', '0');
  if (F.trade) p.set('trade', '1');
  if (F.area) p.set('bbox', F.area.join(','));
  p.set('limit', limit); p.set('slim', '1');
  return p;
}
const filterCount = (F = U.F) => (F.city ? 1 : 0) + (F.type ? 1 : 0) + (F.use ? 1 : 0) + (F.min ? 1 : 0) + (F.days !== 90 ? 1 : 0) + (F.score ? 1 : 0) + (F.contact ? 1 : 0) + (F.named ? 1 : 0) + (F.saved ? 1 : 0) + (F.untouched ? 1 : 0) + (F.trade ? 1 : 0) + (F.builder ? 1 : 0);

async function loadLeads(fit) {
  const seq = ++loadSeq; saveU();
  $('#list').classList.add('busy');
  let rows;
  try { rows = await api('/api/permits?' + leadParams()); }
  finally { if (seq === loadSeq) $('#list').classList.remove('busy'); }
  if (seq !== loadSeq) return;
  LEADS = rows; listLimit = 80; leadsLoaded = true;
  $('#list').scrollTop = 0;
  renderLeads(); drawMap();
  if (fit && !U.F.area) fitLeads();
}
const reloadLeads = debounce(() => run(loadLeads, true), 220);

const leadRow = p => {
  const stage = leadStage(p), b = bname(p), reach = p.contact && (p.contact.phone || p.contact.email);
  return `<button class="lead${p.id === leadId ? ' sel' : ''}${stage === 'won' || stage === 'lost' ? ' done' : ''}" data-act="lead" data-id="${esc(p.id)}">${scOf(p)}
    <span class="lead-main"><span class="l1"><b>${esc(addr(p))}</b><i>${money(p.value)}</i></span>
    <span class="l2">${esc(p.city || '')} · ${esc(workLabel(p))} · ${issuedAgo(p)}</span>
    <span class="l3"><span class="nm">${b ? esc(b) : 'No builder named'}</span>${reach ? `<em class="reach" title="Phone or email on file">${ic('phone')}</em>` : ''}${tag(stage)}</span></span></button>`;
};
function renderLeads() {
  const F = U.F, n = filterCount(), x = ic('x');
  $('#filterbtn').innerHTML = ic('filter') + (n ? `<i class="badge">${n}</i>` : '');
  $('#filterbtn').classList.toggle('on', !!n);
  const tok = (label, k) => `<button class="tok" data-act="f-clear" data-k="${k}" aria-label="Remove filter ${esc(label)}">${esc(label)}${x}</button>`;
  $('#scope').innerHTML = `<div class="seg" role="tablist" aria-label="Sort">${[['score', 'Best'], ['fresh', 'Newest'], ['value', 'Largest']].map(([k, l]) => `<button class="${F.sort === k ? 'on' : ''}" data-act="f-sort" data-v="${k}" role="tab" aria-selected="${F.sort === k}">${l}</button>`).join('')}</div>
    <div class="toks">${F.builder ? tok(F.builderName || 'Builder', 'builder') : ''}${F.area ? tok('Map area', 'area') : ''}${F.city ? tok(F.city, 'city') : ''}${F.saved ? tok('Saved', 'saved') : ''}${F.untouched ? tok('Not picked up', 'untouched') : ''}${F.score ? tok(F.score + '+', 'score') : ''}
      <span class="count">${leadsLoaded ? (LEADS.length >= LIMIT ? `Top ${LIMIT}` : plural(LEADS.length, 'lead')) : ''}${F.days ? ` · ${F.days === 7 ? 'this week' : F.days + ' days'}` : ''}</span></div>`;
  for (const b of $$('#lmode button')) { b.classList.toggle('on', b.dataset.v === U.mode); b.setAttribute('aria-selected', b.dataset.v === U.mode); }
  $('#v-leads').dataset.mode = U.mode;
  $('#list').innerHTML = !leadsLoaded ? '<div class="rowskel"></div>'.repeat(9) : LEADS.length
    ? LEADS.slice(0, listLimit).map(leadRow).join('') + (LEADS.length > listLimit ? `<button class="morebtn" data-act="list-more">Show more</button>` : LEADS.length >= LIMIT ? `<p class="listnote">Showing the top ${LIMIT}. Narrow the filters to see others.</p>` : '')
    : empty('search', 'No leads match', n || F.q ? 'Loosen a filter or clear the search.' : 'Nothing was issued in this window.', n || F.q ? `<button class="btn" data-act="f-reset">Clear filters</button>` : '');
  drawOverlay();
  const rp = $('#routepill'); rp.hidden = !U.route.length; rp.innerHTML = `${ic('route')}<b>${U.route.length}</b> ${U.route.length === 1 ? 'stop' : 'stops'}`;
}
A['list-more'] = () => { listLimit += 120; renderLeads(); };
A.lmode = d => { U.mode = d.v; saveU(); hideCard(); renderLeads(); };

/* ---- filters ---- */
I.q = debounce(el => { U.F.q = el.value.trim(); run(loadLeads, false); }, 260);
A['f-sort'] = d => { U.F.sort = d.v; run(loadLeads, false); };
A['f-clear'] = d => { const b = blankF(); U.F[d.k] = b[d.k]; if (d.k === 'builder') U.F.builderName = ''; run(loadLeads, true); };
A['f-reset'] = () => { U.F = blankF(); $('#q').value = ''; for (const s of sheets) s.update(); run(loadLeads, true); };
A.filters = () => sheet({
  title: 'Filters', cancel: 'Reset', cancelAct: 'f-reset', action: `<button class="tb strong" data-act="sh-done">Done</button>`,
  render: () => {
    const F = U.F, opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
    const sel = (k, opts) => `<select data-on="f-set" data-ev="change" data-k="${k}">${opts}</select>`;
    const sw = (k, t, s) => `<label class="cell switch"><span>${t}${s ? `<small>${s}</small>` : ''}</span><input type="checkbox" data-on="f-set" data-ev="change" data-k="${k}" ${F[k] ? 'checked' : ''}><i></i></label>`;
    return `<div class="group">
      <label class="cell"><span>City</span>${sel('city', opt('', 'All cities', F.city) + (META?.cities || []).map(c => opt(c.city, `${c.city}`, F.city)).join(''))}</label>
      <label class="cell"><span>Work</span>${sel('type', opt('', 'Any', F.type) + [['new', 'New build'], ['addition', 'Addition'], ['alteration', 'Alteration'], ['demolition', 'Demolition'], ['repair', 'Repair']].map(([v, l]) => opt(v, l, F.type)).join(''))}</label>
      <label class="cell"><span>Use</span>${sel('use', opt('', 'Any', F.use) + ['residential', 'commercial', 'mixed', 'industrial', 'institutional'].map(v => opt(v, v[0].toUpperCase() + v.slice(1), F.use)).join(''))}</label></div>
    <div class="group">
      <label class="cell"><span>Issued</span>${sel('days', [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [0, 'Any time']].map(([v, l]) => opt(v, l, F.days)).join(''))}</label>
      <label class="cell"><span>Project value</span>${sel('min', [[0, 'Any'], [50e3, '$50K or more'], [150e3, '$150K or more'], [500e3, '$500K or more'], [1e6, '$1M or more'], [5e6, '$5M or more']].map(([v, l]) => opt(v, l, F.min)).join(''))}</label>
      <label class="cell"><span>Lead score</span>${sel('score', [[0, 'Any'], [45, '45 or higher'], [70, '70 or higher'], [85, '85 or higher']].map(([v, l]) => opt(v, l, F.score)).join(''))}</label></div>
    <div class="group">${sw('contact', 'In the contractor list', 'A phone number or email is on file')}${sw('named', 'Builder named on the permit')}${sw('untouched', 'Hide leads already in the pipeline', 'Show only leads nobody on the team has picked up')}${sw('saved', 'Saved leads only')}${sw('trade', 'Include trade permits', 'Electrical, plumbing, gas and signs')}</div>`;
  }
});
A['sh-done'] = (d, el) => sheetOf(el)?.close();
I['f-set'] = el => { const k = el.dataset.k; U.F[k] = el.type === 'checkbox' ? el.checked : ['days', 'min', 'score'].includes(k) ? +el.value : el.value; reloadLeads(); };
function showBuilderLeads(k, name) { U.F = { ...blankF(), builder: k, builderName: name, days: 0 }; $('#q').value = ''; closeSheets(); if (leadId) closeLead(); go('leads'); run(loadLeads, true); }
A['builder-leads'] = d => showBuilderLeads(d.k, d.name);

/* ---- route: stops live on this device ---- */
const km = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const routeLen = (o = U.route) => { let t = 0, pv = mePos; for (const s of o) { if (pv) t += km(pv, s); pv = s; } return t; };
const inRoute = id => U.route.some(s => s.id === id);
function routeToggle(p) {
  if (inRoute(p.id)) U.route = U.route.filter(s => s.id !== p.id);
  else { if (p.lat == null) return toast('This permit has no map location, so it cannot be routed'); U.route.push({ id: p.id, address: addr(p), city: p.city, lat: p.lat, lng: p.lng }); toast(`Added to route · ${plural(U.route.length, 'stop')}`, { label: 'View', fn: () => A['route-open']() }); }
  saveU(); refresh();
}
function shortestRoute() {
  let rest = [...U.route], cur = mePos || rest[0], out = [];
  while (rest.length) { rest.sort((a, b) => km(cur, a) - km(cur, b)); cur = rest.shift(); out.push(cur); }
  for (let better = true; better;) {                 // 2-opt
    better = false;
    for (let i = mePos ? 0 : 1; i < out.length - 1; i++) for (let j = i + 1; j < out.length; j++) {
      const alt = [...out.slice(0, i), ...out.slice(i, j + 1).reverse(), ...out.slice(j + 1)];
      if (routeLen(alt) < routeLen(out) - 1e-6) { out = alt; better = true; }
    }
  }
  U.route = out; saveU();
}
A['route-open'] = () => sheet({
  title: 'Route', sub: 'Site visits',
  render: () => {
    const r = U.route; if (!r.length) return empty('route', 'No stops yet', 'Add leads to your route from any lead page.');
    const d = routeLen() * 1.3, last = r[r.length - 1], ll = s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    const url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ll(last)}${r.length > 1 ? '&waypoints=' + r.slice(0, -1).map(ll).join('%7C') : ''}`;
    return `<p class="foot-note top">${plural(r.length, 'stop')}${d ? ` · about ${Math.round(d)} km of driving${mePos ? ' from where you are' : ''}` : ''}</p>
      <div class="group">${r.map((s, i) => `<div class="cell stop"><em class="stopn">${i + 1}</em><button class="stop-main" data-act="lead" data-id="${esc(s.id)}" data-close="1"><b>${esc(s.address)}</b><small>${esc(s.city || '')}</small></button>
        <button class="ib sm" data-act="route-move" data-i="${i}" data-by="-1" ${i ? '' : 'disabled'} aria-label="Move up">${ic('up')}</button><button class="ib sm" data-act="route-move" data-i="${i}" data-by="1" ${i < r.length - 1 ? '' : 'disabled'} aria-label="Move down">${ic('down')}</button><button class="ib sm" data-act="route-drop" data-i="${i}" aria-label="Remove stop">${ic('x')}</button></div>`).join('')}</div>
      <div class="group">${r.length > 2 ? `<button class="cell act" data-act="route-short">Put in the shortest order</button>` : ''}<button class="cell act danger" data-act="route-clear">Clear route</button></div>
      <a class="btn wide" href="${url}" target="_blank" rel="noopener">${ic('dir')}Open in Maps</a>`;
  }
});
A['route-move'] = d => { const i = +d.i, j = i + +d.by, r = U.route;[r[i], r[j]] = [r[j], r[i]]; saveU(); refresh(); };
A['route-drop'] = d => { U.route.splice(+d.i, 1); saveU(); refresh(); };
A['route-short'] = () => { const b = routeLen(); shortestRoute(); refresh(); const s = (b - routeLen()) * 1.3; toast(s > .5 ? `Reordered. About ${Math.round(s)} km shorter.` : 'Already the shortest order'); };
A['route-clear'] = (d, el) => { const old = U.route; U.route = []; saveU(); sheetOf(el)?.close(); refresh(); toast('Route cleared', { label: 'Undo', fn: () => { U.route = old; saveU(); refresh(); } }); };
