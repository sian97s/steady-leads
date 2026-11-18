'use strict';
/* Steady Leads — shared helpers: formatting, API, icons, sheets, toasts, the click dispatcher. */
const STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const STAGE_LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
const DAY = 864e5;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const plural = (n, w) => `${n.toLocaleString()} ${n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(ch|s|x)$/.test(w) ? w + 'es' : w + 's'}`;
const money = v => v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v);
const cad = v => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v || 0);
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

/* dates: permits carry 'YYYY-MM-DD'; activity rows carry UTC 'YYYY-MM-DD HH:MM:SS'; tasks carry local 'YYYY-MM-DD HH:MM' */
const dayOf = d => d ? new Date(String(d).slice(0, 10) + 'T12:00') : null;
const utc = s => s ? new Date(String(s).replace(' ', 'T') + 'Z') : null;
const local = s => s ? new Date(String(s).replace(' ', 'T')) : null;
const daysAgo = d => Math.floor((Date.now() - d) / DAY);
function ago(d) {
  if (!d) return '';
  const s = (Date.now() - d) / 1e3;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  const n = Math.floor(s / 86400);
  return n < 2 ? 'yesterday' : n < 14 ? n + ' days ago' : n < 70 ? Math.round(n / 7) + ' weeks ago' : n < 365 ? Math.round(n / 30.4) + ' months ago' : Math.floor(n / 365) + (n < 730 ? ' year ago' : ' years ago');
}
const issuedAgo = p => { const d = dayOf(p.issued_date); if (!d) return 'not issued'; const n = daysAgo(d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? n + 'd ago' : n < 70 ? Math.round(n / 7) + 'w ago' : Math.round(n / 30.4) + 'mo ago'; };
const dstr = (d, o) => d.toLocaleDateString('en-CA', o || { weekday: 'short', month: 'short', day: 'numeric' });
const dlong = d => d ? dstr(dayOf(d), { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const t12 = d => d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/* City feeds shout in capitals. Show them the way a person would write them. */
const KEEP_UP = /^(NE|NW|SE|SW|BC|LLP|LP|II|III|IV|DBA|PO|CSRD|BCIT|UBC|SFU|HVAC)$/;
const STREET_ABBR = /^(st|rd|dr|ltd|crt|blvd|pl|hwy|ct|ln|pkwy|mt|ft|sq|cr|trl|ph|th|nd)$/;
function tcase(s) {
  s = String(s ?? '').trim();
  if (!s || s !== s.toUpperCase() || !/[A-Z]{2}/.test(s)) return s;
  return s.toLowerCase().replace(/[a-z0-9']+/g, w => {
    const u = w.toUpperCase();
    if (KEEP_UP.test(u)) return u;
    if (w.length <= 4 && !/[aeiouy]/.test(w) && !/\d/.test(w) && !STREET_ABBR.test(w)) return u;   // initials such as RCG, HK, DBD
    if (/\d/.test(w) && /[a-z]/.test(w)) return /^\d+(st|nd|rd|th)$/.test(w) ? w : u;
    return w[0].toUpperCase() + w.slice(1);
  });
}
const addr = p => tcase(String(p.address || 'No address').replace(new RegExp(',\\s*' + String(p.city || '~').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ',\\s*BC.*$', 'i'), ''));
const bname = p => tcase(p.contractor || p.applicant || '');
const bkey = p => p.contractor_key || p.applicant_key || '';
const workLabel = p => [({ new: 'New build', addition: 'Addition', alteration: 'Alteration', demolition: 'Demolition', repair: 'Repair', temporary: 'Temporary', other: 'Other work' })[p.work_type] || '', p.use_type && p.use_type !== 'other' ? p.use_type : ''].filter(Boolean).join(' · ') || 'Permit';
const initials = n => (String(n || '?').match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const phonesOf = p => [...new Set([p.contact?.phone, p.contact?.alt_phone, p.contact_phone].filter(Boolean))];
const emailsOf = p => [...new Set([p.contact?.email, p.contact_email].filter(Boolean).flatMap(e => String(e).split(/[;,\s]+/)).filter(e => /@/.test(e)))];
const tierOf = s => s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cool';
// Filled mark = nobody has picked the lead up; its colour says how hard to chase it (hot, warm, low).
// Outlined mark = it is already in the pipeline; the tag beside it says how far along.
const TAG = { new: ['Saved', 'bookmark'], contacted: ['Reached out', 'phone'], quoted: ['Quoted', 'doc'], won: ['Won', 'check'], lost: ['Lost', 'x'] };
const leadStage = p => (p && (stageOf(p.id) || p.stage)) || null;
const sc = (s, stage) => `<span class="sc ${tierOf(s || 0)}${stage ? ' own' : ''}" role="img" aria-label="Lead score ${s || 0}${stage ? ', ' + TAG[stage][0].toLowerCase() : ''}">${s ?? '–'}</span>`;
const scOf = p => sc(p.score, leadStage(p));
const tag = st => st ? `<em class="st ${st}">${ic(TAG[st][1])}${TAG[st][0]}</em>` : '';

/* icons (drawn in the SF Symbols idiom: one weight, round caps) */
const ICON = {
  today: '<rect x="3" y="4.500" width="18" height="16.500" rx="3.500"/><path d="M3 9.500h18M8 2.500v4M16 2.500v4"/><path d="M8.500 15l2.500 2.500 4.500-5"/>',
  leads: '<path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
  pipeline: '<rect x="3" y="4" width="5" height="16" rx="1.500"/><rect x="9.500" y="4" width="5" height="11" rx="1.500"/><rect x="16" y="4" width="5" height="7" rx="1.500"/>',
  builders: '<path d="M4 21V6.500A1.500 1.500 0 0 1 5.500 5h7A1.500 1.500 0 0 1 14 6.500V21M14 10h4.500A1.500 1.500 0 0 1 20 11.500V21M2.500 21h19M7.500 9h3M7.500 12.500h3M7.500 16h3"/>',
  agent: '<path d="M12 3.500l1.700 4.600a2 2 0 0 0 1.200 1.200L19.500 11l-4.600 1.700a2 2 0 0 0-1.200 1.200L12 18.500l-1.700-4.600a2 2 0 0 0-1.200-1.200L4.500 11l4.600-1.700a2 2 0 0 0 1.200-1.200L12 3.500z"/><path d="M19 16.500v4M17 18.500h4"/>',
  sources: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6"/>',
  team: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.500a6.500 6.500 0 0 1 3.500 5.500"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.800-3.800"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V5.500A1.500 1.500 0 0 1 5.500 4H9M15 4h3.500A1.500 1.500 0 0 1 20 5.500V9M20 15v3.500a1.500 1.500 0 0 1-1.500 1.500H15M9 20H5.500A1.500 1.500 0 0 1 4 18.500V15"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  chevd: '<path d="m5 9 7 7 7-7"/>',
  phone: '<path d="M21 16.500v3a1.800 1.800 0 0 1-2 1.800A18 18 0 0 1 2.700 5 1.800 1.800 0 0 1 4.500 3h3a1.800 1.800 0 0 1 1.800 1.500c.100 1 .400 1.900.700 2.800a1.800 1.800 0 0 1-.400 1.900L8.300 10.500a14.500 14.500 0 0 0 5.200 5.200l1.300-1.300a1.800 1.800 0 0 1 1.900-.400c.900.300 1.800.600 2.800.700a1.800 1.800 0 0 1 1.500 1.800z"/>',
  mail: '<rect x="2.500" y="5" width="19" height="14" rx="3"/><path d="m3.500 7.500 8.500 6 8.500-6"/>',
  note: '<path d="M12 20h8.500M16.200 4a2.100 2.100 0 0 1 3 3L7.500 18.700l-4 1 1-4L16.200 4z"/>',
  dir: '<path d="M12 2.500 21.500 12 12 21.500 2.500 12z"/><path d="M8.500 14v-2.500A1.500 1.500 0 0 1 10 10h5M13 7.500l2.500 2.500-2.500 2.500"/>',
  doc: '<path d="M14 3H7.500A2.500 2.500 0 0 0 5 5.500v13A2.500 2.500 0 0 0 7.500 21h9a2.500 2.500 0 0 0 2.500-2.500V8zM14 3v5h5M9 13h6M9 17h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.200"/><circle cx="12" cy="12" r="1.200"/><circle cx="19" cy="12" r="1.200"/>',
  star: '<path d="m12 3.500 2.600 5.400 5.900.800-4.300 4.100 1.100 5.900L12 16.900l-5.300 2.800 1.100-5.900-4.300-4.100 5.900-.800z"/>',
  bookmark: '<path d="M6.500 4h11A1.500 1.500 0 0 1 19 5.500V21l-7-4.500L5 21V5.500A1.500 1.500 0 0 1 6.500 4z"/>',
  route: '<circle cx="6" cy="18" r="2.500"/><circle cx="18" cy="6" r="2.500"/><path d="M8.500 18H14a3.500 3.500 0 0 0 0-7h-4a3.500 3.500 0 0 1 0-7h5.500"/>',
  locate: '<path d="M20.500 3.500 3.500 10.500l7 3 3 7z"/>',
  share: '<path d="M12 15V3.500M8 7l4-4 4 4M5 12v6.500A2.500 2.500 0 0 0 7.500 21h9a2.500 2.500 0 0 0 2.500-2.500V12"/>',
  link: '<path d="M14 5h5v5M19 5l-8 8M17 13.500v4A2.500 2.500 0 0 1 14.500 20h-8A2.500 2.500 0 0 1 4 17.500v-8A2.500 2.500 0 0 1 6.500 7h4"/>',
  trash: '<path d="M4 6.500h16M9.500 6.500V4.500a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6 6.500l.900 12.200A2 2 0 0 0 8.900 20.500h6.200a2 2 0 0 0 2-1.800L18 6.500M10 10.500v6M14 10.500v6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M18 13l-6 6-6-6"/>',
  mic: '<rect x="9" y="2.500" width="6" height="11.500" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3.500"/>',
  copy: '<rect x="8.500" y="8.500" width="12" height="12" rx="2.500"/><path d="M5.500 15.500h-.500a1.500 1.500 0 0 1-1.500-1.500V5a1.500 1.500 0 0 1 1.500-1.500h9A1.500 1.500 0 0 1 15.500 5v.500"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300l1.800 1.800M16.900 16.900l1.800 1.800M5.300 18.700l1.800-1.800M16.900 7.100l1.800-1.800"/>',
  warn: '<path d="M12 3.500 2.500 20h19zM12 10v4.500M12 17.300v.200"/>',
  print: '<path d="M7 8V3.500h10V8M7 17.500H5A2.500 2.500 0 0 1 2.500 15v-4.500A2.500 2.500 0 0 1 5 8h14a2.500 2.500 0 0 1 2.500 2.500V15a2.500 2.500 0 0 1-2.500 2.500h-2M7 14h10v6.500H7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.500a8 8 0 0 1 16 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

/* per-device preferences (filters, route, templates, yard details) */
const UKEY = 'steadyleads.ui.v2';
const blankF = () => ({ q: '', city: '', type: '', use: '', min: 0, days: 90, score: 0, sort: 'score', builder: '', builderName: '', contact: false, named: false, saved: false, untouched: false, trade: false, area: null });
const TPL = [
  { id: 'intro', name: 'Introduction', subject: 'Materials for {{address}}', body: 'Hi {{first}},\n\nI saw the permit for {{address}} in {{city}}. We supply lumber, engineered wood, sheet goods and building materials for projects like this, with jobsite delivery.\n\nIf you send me the plans or a materials list, I can have a quote back to you within a day.\n\nThanks,\n{{me}}\n{{yard}}\n{{phone}}' },
  { id: 'follow', name: 'Follow-up', subject: 'Following up on {{address}}', body: 'Hi {{first}},\n\nFollowing up on my note about {{address}}. Happy to price from drawings or a takeoff, whichever is easier for you.\n\nIs there a good time this week for a quick call?\n\n{{me}}\n{{yard}}\n{{phone}}' },
  { id: 'quote', name: 'Quote sent', subject: 'Quote for {{address}}', body: 'Hi {{first}},\n\nOur material quote for {{address}} is attached. Pricing is held for the period shown on the quote. If the plans change, tell me and I will revise it the same day.\n\n{{me}}\n{{yard}}\n{{phone}}' }
];
const U = (() => {
  const d = { F: blankF(), mode: 'list', route: [], tpl: TPL, yard: { name: '', phone: '', tax: 12 }, chat: [], mapView: null };
  try { const s = JSON.parse(localStorage.getItem(UKEY) || 'null'); if (s) return { ...d, ...s, F: { ...d.F, ...s.F, q: '', area: null }, yard: { ...d.yard, ...s.yard } }; } catch { }
  return d;
})();
const saveU = () => { try { localStorage.setItem(UKEY, JSON.stringify(U)); } catch { } };

/* API */
let ME = null, META = null, PIPE = [], TASKS = [], WATCH = [];
async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (j.must_change && typeof askPassword === 'function') askPassword(true); throw new Error(j.error || 'Something went wrong. Try again.'); }
  return j;
}
const stageOf = id => PIPE.find(p => p.id === id)?.stage || null;
const isWatched = k => !!k && WATCH.some(w => w.k === k);

/* one delegated dispatcher for clicks (data-act) and inputs (data-on) */
const A = {}, I = {};
const run = (f, ...a) => { try { const r = f(...a); if (r && r.catch) r.catch(e => toast(e.message)); } catch (e) { toast(e.message); console.error(e); } };
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const f = A[el.dataset.act]; if (!f) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.dataset.busy) return;
  if (el.dataset.close) sheetOf(el)?.close();
  let r; try { r = f(el.dataset, el, e); } catch (err) { toast(err.message); console.error(err); return; }
  if (r && r.then) { el.dataset.busy = '1'; r.catch(err => toast(err.message)).finally(() => { delete el.dataset.busy; }); }
});
// Destructive buttons ask once more in place: the first tap arms the button, the second confirms.
function sure(el, label = 'Tap again to confirm') {
  if (el.dataset.sure) return true;
  const was = el.innerHTML; el.dataset.sure = '1'; el.textContent = label;
  setTimeout(() => { if (el.isConnected && el.dataset.sure) { el.innerHTML = was; delete el.dataset.sure; } }, 3200);
  return false;
}
for (const ev of ['input', 'change']) document.addEventListener(ev, e => {
  const el = e.target.closest('[data-on]');
  if (el && I[el.dataset.on] && (el.dataset.ev || 'input') === ev) run(I[el.dataset.on], el, e);
});
const formOf = el => { const o = {}; for (const f of $$('[name]', el)) o[f.name] = f.type === 'checkbox' ? f.checked : f.value.trim(); return o; };

/* sheets: a bottom sheet on phones, a centred panel on wider screens */
const sheets = [];
function sheet(o) {
  const w = document.createElement('div');
  w.className = 'sh' + (o.tall ? ' tall' : '') + (o.cls ? ' ' + o.cls : '');
  w.innerHTML = `<div class="sh-bg" data-act="sh-close"></div>
  <div class="sh-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(o.title || 'Dialog')}">
    <div class="sh-grab"><i></i></div>
    <header class="sh-head"><button class="tb" data-act="${o.cancelAct || 'sh-close'}">${o.cancel ?? 'Close'}</button><div class="sh-title"><b>${esc(o.title || '')}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div><span class="sh-do">${o.action || ''}</span></header>
    <div class="sh-body"></div>${o.foot ? `<footer class="sh-foot">${o.foot}</footer>` : ''}
  </div>`;
  const body = $('.sh-body', w), panel = $('.sh-panel', w);
  const sh = {
    el: w, o, body,
    update() { if (o.render) { const st = body.scrollTop; body.innerHTML = o.render(); body.scrollTop = st; } },
    close() { const i = sheets.indexOf(sh); if (i < 0) return; sheets.splice(i, 1); w.classList.remove('in'); setTimeout(() => w.remove(), 320); o.onClose && o.onClose(); }
  };
  body.innerHTML = o.render ? o.render() : o.html;
  $('#sheets').append(w); sheets.push(sh);
  requestAnimationFrame(() => requestAnimationFrame(() => { w.classList.add('in'); const f = $('[autofocus]', w); f ? f.focus() : panel.focus({ preventScroll: true }); }));
  let y0 = null, dy = 0;
  const grab = e => { if (e.target.closest('button,input,select,textarea,a') || innerWidth >= 720) return; y0 = e.clientY; dy = 0; panel.style.transition = 'none'; panel.setPointerCapture(e.pointerId); };
  panel.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
  const drop = () => { if (y0 == null) return; y0 = null; panel.style.transition = ''; panel.style.transform = ''; if (dy > 90) sh.close(); };
  for (const g of $$('.sh-grab,.sh-head', w)) g.addEventListener('pointerdown', grab);
  panel.addEventListener('pointerup', drop); panel.addEventListener('pointercancel', drop);
  return sh;
}
const sheetOf = el => sheets.find(s => s.el.contains(el));
const closeSheets = () => [...sheets].forEach(s => s.close());
A['sh-close'] = (d, el) => { const s = sheetOf(el); if (s && !s.o.locked) s.close(); };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const top = sheets[sheets.length - 1];
  if (top) { if (!top.o.locked) top.close(); } else if (typeof closeLead === 'function' && leadId) closeLead();
});

function toast(msg, o = {}) {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${o.label ? `<button>${esc(o.label)}</button>` : ''}`;
  const kill = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 260); };
  if (o.label) $('button', t).onclick = () => { run(o.fn); kill(); };
  for (const old of $$('#toasts .toast')) { old.classList.remove('in'); setTimeout(() => old.remove(), 260); }   // one message at a time, so there is only ever one Undo
  $('#toasts').append(t); requestAnimationFrame(() => t.classList.add('in')); setTimeout(kill, o.label ? 5500 : 2800);
}
const empty = (icon, title, text, btn = '') => `<div class="empty">${ic(icon)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${btn}</div>`;
const field = (label, input) => `<label class="fld"><span>${esc(label)}</span>${input}</label>`;
const cell = (label, value, extra = '') => value == null || value === '' ? '' : `<div class="cell" ${extra}><span>${esc(label)}</span><b>${value}</b></div>`;
function download(name, text, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); } toast('Copied'); }

/* dictation, where the browser offers it */
let rec = null;
A.dictate = (d, el) => {
  const target = document.getElementById(d.for), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Dictation is not available in this browser');
  if (rec) return rec.stop();
  rec = new SR(); rec.lang = 'en-CA'; rec.interimResults = true;
  const base = target.value ? target.value.replace(/\s*$/, ' ') : ''; el.classList.add('live');
  rec.onresult = ev => { target.value = base + [...ev.results].map(r => r[0].transcript).join(''); target.dispatchEvent(new Event('input', { bubbles: true })); };
  rec.onend = rec.onerror = () => { el.classList.remove('live'); rec = null; };
  rec.start();
};

/* The next useful step on a pipeline lead, from its stage, last contact, open follow-up and quote. */
function nextStep(r) {
  const now = Date.now(), task = local(r.next_task), touch = utc(r.last_touch), quiet = touch ? daysAgo(touch) : null;
  if (r.stage === 'won') return { tone: 'ok', text: 'Won' + (r.quote_total ? ` · ${money(r.quote_total)} quoted` : '') };
  if (r.stage === 'lost') return { tone: 'muted', text: 'Lost' };
  if (task && task < now) return { tone: 'warn', text: `Follow-up overdue since ${dstr(task)}`, act: 'tasks-for' };
  if (task && task - now < 2 * DAY) return { tone: 'info', text: `Follow-up ${dstr(task, { weekday: 'short' })} ${t12(task)}` };
  const reach = phonesOf(r).length || emailsOf(r).length;
  if (r.stage === 'new') {
    if (!reach) return { tone: 'warn', text: 'Find a number. Not in the contractor list.', act: 'find' };
    if (!touch) return { tone: daysAgo(utc(r.saved_at) || now) >= 2 ? 'warn' : 'info', text: 'Make the first call', act: 'call' };
    return { tone: 'warn', text: 'No answer yet. Try again.', act: 'call' };
  }
  if (r.stage === 'contacted') {
    if (r.quote_status === 'draft') return { tone: 'info', text: 'Finish and send the draft quote', act: 'quotes' };
    if (quiet != null && quiet >= 5) return { tone: 'warn', text: `Quiet for ${quiet} days. Follow up.`, act: 'email' };
    return { tone: 'info', text: 'Ask for plans and send a quote', act: 'quote-new' };
  }
  const d = daysAgo(utc(r.stage_updated) || now);
  return d >= 6 ? { tone: 'warn', text: `Quote out ${d} days. Chase it.`, act: 'call' } : { tone: 'info', text: d ? `Quote out ${plural(d, 'day')}. Check in at day 6.` : 'Quote sent today' };
}
