'use strict';
/* Navigation, refresh loop, start-up. */
const VIEWS = {
  today: { label: 'Today', icon: 'today', render: renderToday, load: async () => { [TODAY] = await Promise.all([api('/api/today'), loadBoard()]); } },
  leads: { label: 'Leads', icon: 'leads' },
  pipeline: { label: 'Pipeline', icon: 'pipeline', render: renderPipeline, load: async () => { await Promise.all([loadBoard(), TODAY ? null : api('/api/today').then(t => { TODAY = t; })]); } },
  builders: { label: 'Builders', icon: 'builders', render: renderBuilders },
  agent: { label: 'Lead Agent', short: 'Agent', icon: 'agent', render: renderAgent, after: scrollChat },
  sources: { label: 'Data sources', icon: 'sources', render: renderSources },
  team: { label: 'Team', icon: 'team', render: renderTeam, admin: true }
};
const MAIN = ['today', 'leads', 'pipeline', 'builders', 'agent'];
let cur = 'today';
// The loading screen fades out, then is removed outright, so a paused fade (background tab) can never leave it covering the app.
function hideBoot() { const b = $('#boot'); if (!b) return; b.classList.add('gone'); setTimeout(() => b.remove(), 400); }
const go = v => { if (location.hash === '#/' + v) route(); else location.hash = '#/' + v; };
A.go = d => go(d.v);

function renderNav() {
  const due = TASKS.filter(t => !t.done_at && local(t.due_at) < Date.now()).length + PIPE.filter(r => nextStep(r).tone === 'warn').length;
  const item = (k, cls = '') => `<button class="${cur === k ? 'on' : ''} ${cls}" data-act="go" data-v="${k}" ${cur === k ? 'aria-current="page"' : ''}>${ic(VIEWS[k].icon)}<span>${VIEWS[k].label}</span>${k === 'today' && due ? `<i class="badge">${due}</i>` : ''}</button>`;
  $('#side').innerHTML = `<div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#171a22"/><rect x="5" y="11" width="22" height="10" rx="5" fill="none" stroke="#c5ee3a" stroke-width="2"/><path d="M12 11.500v9M20 11.500v9" stroke="#c5ee3a" stroke-width="1.500"/><circle cx="16" cy="16" r="2.600" fill="#c5ee3a"/></svg><b>Steady Leads</b></div>
    <nav>${MAIN.map(k => item(k)).join('')}</nav><p class="side-h">Admin</p><nav>${item('sources')}${ME?.role === 'admin' ? item('team') : ''}</nav><span class="grow"></span>
    <button class="acct" data-act="settings"><span class="av">${esc(initials(ME?.name || ME?.email))}</span><span><b>${esc(ME?.name || 'Account')}</b><small>${esc(ME?.email || '')}</small></span></button>`;
  $('#tabs').innerHTML = MAIN.map(k => `<button class="${cur === k ? 'on' : ''}" data-act="go" data-v="${k}" ${cur === k ? 'aria-current="page"' : ''}><span>${ic(VIEWS[k].icon)}${k === 'today' && due ? `<i class="badge">${due}</i>` : ''}</span>${VIEWS[k].short || VIEWS[k].label}</button>`).join('');
  for (const m of $$('.me')) m.textContent = initials(ME?.name || ME?.email);
}
function renderView(fresh) {
  const lv = $('#v-leads'), ov = $('#v-other'), isL = cur === 'leads';
  lv.hidden = !isL; ov.hidden = isL;
  if (isL) { renderLeads(); if (!leadsLoaded) run(loadLeads, !(U.mapView && U.mapView.z >= 6)); }
  else {
    const scn = $('.scroll', ov), st = fresh || !scn ? 0 : scn.scrollTop, a = document.activeElement, fid = a && ov.contains(a) && a.id, val = fid && a.value;
    ov.innerHTML = VIEWS[cur].render(); ov.dataset.v = cur;
    const ns = $('.scroll', ov); if (ns) ns.scrollTop = st;
    if (fid && document.getElementById(fid)) { const n = document.getElementById(fid); n.value = val; n.focus(); }
    if (fresh) { ov.classList.remove('enter'); void ov.offsetWidth; ov.classList.add('enter'); VIEWS[cur].after && VIEWS[cur].after(); }
  }
  renderNav();
}
function refresh() { renderView(false); renderLead(); for (const s of sheets) s.update(); }
/* After any change: reload the shared state (pipeline, follow-ups, watches), then redraw. */
async function sync() {
  const jobs = [api('/api/pipeline'), api('/api/tasks'), api('/api/watches')];
  if (cur === 'today' || TODAY) jobs.push(api('/api/today').then(t => { TODAY = t; }));
  if (BOARD || cur === 'pipeline') jobs.push(loadBoard());
  if (leadId) jobs.push(loadLead(leadId));
  [PIPE, TASKS, WATCH] = await Promise.all(jobs);
  const st = Object.fromEntries(PIPE.map(r => [r.id, r.stage])); for (const p of LEADS) p.stage = st[p.id] || null;
  refresh();
}
function route() {
  const [v, id] = location.hash.replace(/^#\/?/, '').split('/');
  const next = VIEWS[v] && (!VIEWS[v].admin || ME?.role === 'admin') ? v : 'today', changed = next !== cur || ($('#v-leads').hidden && $('#v-other').hidden);
  cur = next;
  if (changed) { closeSheets(); renderView(true); if (VIEWS[cur].load) run(async () => { await VIEWS[cur].load(); if (cur === next) refresh(); }); }
  if (id) run(showLead, decodeURIComponent(id)); else hideLead();
}
window.addEventListener('hashchange', route);
// Keyboard: "/" jumps to search; on Leads, the arrow keys walk the list with the panel following.
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || sheets.length) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !typing) { e.preventDefault(); if (cur !== 'leads') go('leads'); setTimeout(() => $('#q').focus(), 30); return; }
  if (typing || cur !== 'leads' || !['ArrowDown', 'ArrowUp'].includes(e.key) || !LEADS.length) return;
  e.preventDefault();
  const i = LEADS.findIndex(p => p.id === leadId), n = Math.max(0, Math.min(LEADS.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)));
  if (n >= listLimit) { listLimit = n + 40; renderLeads(); }
  A.lead({ id: LEADS[n].id });
  $(`.lead[data-id="${CSS.escape(LEADS[n].id)}"]`)?.scrollIntoView({ block: 'nearest' });
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (leadsLoaded) drawMap(); });

$('.search-ic').innerHTML = ic('search'); $('#locate').innerHTML = ic('locate'); $('#q').value = '';
if (!window.L) { U.mode = 'list'; $('#lmode').hidden = true; $('#mapwrap').hidden = true; }
(async () => {
  try {
    ME = await api('/auth/me');
    if (ME.must_change) { hideBoot(); renderNav(); return askPassword(true); }
    [META, PIPE, TASKS, WATCH] = await Promise.all([api('/api/meta'), api('/api/pipeline'), api('/api/tasks'), api('/api/watches')]);
    route();
  } catch (e) { toast(e.message); }
  hideBoot();
})();
setInterval(() => { if (!document.hidden && !sheets.length && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) run(sync); }, 5 * 60e3); // pick up teammates' changes
