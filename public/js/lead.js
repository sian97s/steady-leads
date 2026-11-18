'use strict';
/* One lead: the inspector panel, and everything a rep does from it. */
let leadId = null, leadData = null, leadActs = [], leadQuotes = [], leadDepth = 0, leadFresh = false;

// Opening a lead adds one step to the browser history; moving between leads replaces it, so Back always closes the panel in one go.
A.lead = d => {
  closeSheets(); const h = `#/${cur}/${enc(d.id)}`;
  if (location.hash === h) return;
  if (leadId) { history.replaceState(null, '', h); route(); } else { leadDepth = 1; location.hash = h; }
};
A['lead-close'] = () => closeLead();
function closeLead() {
  if (!leadId) return;
  if (leadDepth) { leadDepth = 0; history.back(); } else { history.replaceState(null, '', '#/' + cur); route(); }
}
async function loadLead(id) {
  const [p, acts, quotes] = await Promise.all([api('/api/permits/' + enc(id)), api('/api/activity?permit=' + enc(id)), api('/api/quotes?permit=' + enc(id))]);
  if (leadId !== id) return;
  leadData = p; leadActs = acts; leadQuotes = quotes;
}
async function showLead(id) {
  if (leadId === id && leadData) return;
  const el = $('#insp'), switching = !!(leadId && $('.iscroll', el));
  leadId = id; leadData = null; leadFresh = true;
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); $('#app').classList.add('has-insp');
  $$('.lead').forEach(l => l.classList.toggle('sel', l.dataset.id === id));
  if (switching) el.classList.add('loading');        // keep the previous lead on screen, dimmed, until the next one arrives
  else el.innerHTML = `<header class="ibar"><button class="ib" data-act="lead-close" aria-label="Close">${ic('back', 'only-m')}${ic('x', 'only-d')}</button></header><div class="iscroll"><div class="skel"></div><div class="skel short"></div></div>`;
  try { await loadLead(id); } catch (e) { el.classList.remove('loading'); toast(e.message); return closeLead(); }
  if (leadId !== id) return;
  el.classList.remove('loading'); renderLead();
  if (!switching) $('.ibar .ib', el)?.focus({ preventScroll: true });
  hideCard(); focusLeadOnMap();
}
function hideLead() {
  if (!leadId) return;
  leadId = null; leadData = null; leadDepth = 0; const el = $('#insp');
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); $('#app').classList.remove('has-insp');
  $$('.lead.sel').forEach(l => l.classList.remove('sel')); markSelected();
}

/* What a lumber and building-supply rep should say on this one. Heuristics from the permit, stated as suggestions. */
function angle(p) {
  const d = dayOf(p.issued_date), n = d ? daysAgo(d) : null, res = p.use_type === 'residential' || p.use_type === 'mixed', v = p.value || 0;
  if (p.record_type === 'application' || !d) return ['Not issued yet', 'The builder has not bought materials. Get on their supplier list now, and ask when they expect the permit.'];
  if (p.work_type === 'demolition') return ['A new build usually follows', 'Ask who is building on the lot once it is cleared. The framing package is still months away, which makes this an early conversation.'];
  if (p.work_type === 'new' && (v >= 2e7 || (v >= 5e6 && !res))) return ['Large build, likely concrete', 'Little framing lumber at this scale. Lead with formwork lumber, plywood, hoarding and site supplies, and ask who buys for the site.'];
  if (p.work_type === 'new') return n <= 30 ? ['Framing package is next', 'Issued recently, so the site is likely at excavation or foundation. Ask for the plans and quote the framing package this week.']
    : n <= 120 ? ['Likely framing now', 'They may already have a supplier. Offer fast fill-in deliveries, then quote sheathing, roofing and the next phase.']
      : ['Past framing on most builds', 'Pitch the finishing side: siding, decking, trim, doors and interior materials.'];
  if (p.work_type === 'addition') return ['Small framing order, quick decision', 'Ask for the materials list. Additions are usually bought within weeks of the permit.'];
  if (p.work_type === 'alteration') return ['Renovation order', 'Smaller and faster. Ask what they still need to buy, and offer same-week delivery.'];
  return ['Worth a quick call', 'Ask what materials are still to be bought and who orders them.'];
}

// The score read off a tape measure pulled out to the lead's number. Ticks every 5, longer every 10.
function tape(s) {
  s = Math.max(0, Math.min(100, s || 0));
  const ticks = Array.from({ length: 21 }, (_, i) => `<i style="left:${i * 5}%;height:${i % 2 ? 6 : 11}px"></i>`).join('');
  return `<div class="tape" role="img" aria-label="Lead score ${s} out of 100"><div class="tape-track"><div class="tape-blade" style="width:${s}%"><span style="position:absolute;inset:0;width:${s ? 10000 / s : 0}%">${ticks}</span></div><span class="tape-hook" style="left:${s}%"><b>${s}</b></span></div>
    <div class="tape-nums"><span style="left:0">0</span><span style="left:45%">45 warm</span><span style="left:70%">70 hot</span><span style="left:100%">100</span></div></div>`;
}
function renderLead() {
  const p = leadData; if (!p) return;
  const el = $('#insp'), sc0 = $('.iscroll', el), st = sc0 && !leadFresh ? sc0.scrollTop : 0, open = k => $(`#${k}`, el)?.open ? 'open' : '';
  const row = PIPE.find(r => r.id === p.id), stage = row?.stage || null, ns = row ? nextStep(row) : null, c = p.contact;
  const phones = phonesOf(p), emails = emailsOf(p), b = bname(p), k = p.builder_key, [at, ax] = angle(p), id = esc(p.id), rt = inRoute(p.id);
  leadFresh = false;
  const tasks = leadActs.filter(a => a.kind === 'task').sort((a, b) => !!a.done_at - !!b.done_at || String(a.due_at).localeCompare(String(b.due_at))), log = leadActs.filter(a => a.kind !== 'task');
  const q = enc(`${p.address || ''}, ${p.city || ''}, BC`), web = enc(`${p.contractor || p.applicant || ''} ${p.city || ''} BC contractor phone`);
  const act = (a, icon, label, on, extra = '') => `<button class="act-b" data-act="${a}" data-id="${id}" ${on ? '' : 'aria-disabled="true"'} ${extra}>${ic(icon)}<span>${label}</span></button>`;
  const logIc = { note: 'note', call: 'phone', email: 'mail', stage: 'pipeline' };
  el.innerHTML = `<header class="ibar"><button class="ib" data-act="lead-close" aria-label="Close">${ic('back', 'only-m')}${ic('x', 'only-d')}</button><span class="ibar-t">${esc(addr(p))}</span>
      <button class="ib${rt ? ' on' : ''}" data-act="route-toggle" data-id="${id}" aria-label="${rt ? 'Remove from route' : 'Add to route'}" aria-pressed="${rt}">${ic('route')}</button>
      <button class="ib" data-act="lead-share" aria-label="Share">${ic('share')}</button></header>
  <div class="iscroll">
    <div class="ihead"><div class="ihead-top">${scOf(p)}<span class="tier ${tierOf(p.score)}">${{ hot: 'Hot lead', warm: 'Warm lead', cool: 'Low priority' }[tierOf(p.score)]}</span>${tag(stage)}</div>
      <h1>${esc(addr(p))}</h1><p class="sub">${esc(p.city || '')}${p.permit_number ? ' · Permit ' + esc(p.permit_number) : ''}</p>
      <p class="fig">${p.value ? `<b>${money(p.value)}</b> · ` : ''}${esc(workLabel(p))} · ${p.issued_date ? 'issued ' + issuedAgo(p) : 'application'}</p></div>
    <div class="acts">${act('call', 'phone', 'Call', phones.length)}${act('email', 'mail', 'Email', true)}<a class="act-b" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${q}">${ic('dir')}<span>Directions</span></a>${act('note', 'note', 'Note', true)}</div>

    ${stage ? `<div class="stagebox"><div class="seg full" role="tablist" aria-label="Pipeline stage">${['new', 'contacted', 'quoted', 'won'].map(s => `<button class="${s === stage ? 'on' : ''}" data-act="stage-set" data-id="${id}" data-s="${s}" role="tab" aria-selected="${s === stage}">${STAGE_LABEL[s]}</button>`).join('')}</div>
        <button class="ib" data-act="stage-more" data-id="${id}" aria-label="More pipeline options">${ic('more')}</button></div>
        ${stage === 'lost' ? `<p class="next muted">${ic('x')}<span>Marked lost</span></p>` : ns ? `<p class="next ${ns.tone}">${ic(ns.tone === 'ok' ? 'check' : ns.tone === 'warn' ? 'warn' : 'clock')}<span>${esc(ns.text)}</span></p>` : ''}`
      : `<button class="btn wide" data-act="lead-save" data-id="${id}">${ic('bookmark')}Save to pipeline</button>`}

    <div class="group pad"><p class="eyebrow">Selling angle</p><b class="angle-t">${at}</b><p class="angle-x">${ax}</p></div>

    <div class="group">${tape(p.score)}<details class="disc" id="d-score" ${open('d-score')}><summary><span>Why it scores ${p.score}</span>${ic('chevd')}</summary>
      ${(p.score_parts || []).map(x => `<div class="part"><div class="part-top"><span>${esc(x.label)}</span><b>${x.pts}<small> / ${x.max}</small></b></div><div class="meter"><i style="width:${x.pts / x.max * 100}%"></i></div><p>${esc(x.why)}</p></div>`).join('')}</details></div>

    <h2>Builder</h2>
    <div class="group">
      ${b ? `<button class="cell nav" data-act="builder" data-k="${esc(k || '')}" ${k ? '' : 'aria-disabled="true"'}><span class="av">${initials(b)}</span><span class="cell-main"><b>${esc(b)}</b><small>${p.contractor ? 'Builder on the permit' : 'Applicant on the permit'}${p.history.length ? ` · ${p.history.length >= 20 ? '20+ other permits' : plural(p.history.length, 'other permit')}` : ''}</small></span>${k ? ic('chev') : ''}</button>` : `<div class="cell"><span>No builder or applicant is named on this permit.</span></div>`}
      ${c?.person ? cell('Contact', esc(c.person)) : ''}
      ${phones.map(ph => `<button class="cell tap" data-act="call" data-id="${id}" data-phone="${esc(ph)}"><span>Phone</span><b>${esc(ph)}</b></button>`).join('')}
      ${emails.map(em => `<button class="cell tap" data-act="email" data-id="${id}" data-to="${esc(em)}"><span>Email</span><b>${esc(em)}</b></button>`).join('')}
      ${c?.website ? `<a class="cell tap" target="_blank" rel="noopener" href="${esc(/^https?:/.test(c.website) ? c.website : 'https://' + c.website)}"><span>Website</span><b>${esc(String(c.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</b></a>` : ''}
      ${c?.status ? cell('Licence', esc(c.status) + (c.licence ? ` · ${esc(c.licence)}` : '')) : ''}
      ${b && !phones.length && !emails.length ? `<a class="cell tap" target="_blank" rel="noopener" href="https://www.google.com/search?q=${web}"><span>Not in the contractor list</span><b>Search the web</b></a>` : ''}
      ${k ? `<label class="cell switch"><span>Watch this builder<small>New permits from them appear on Today</small></span><input type="checkbox" data-on="watch" data-ev="change" data-k="${esc(k)}" data-name="${esc(b)}" ${p.watched ? 'checked' : ''}><i></i></label>` : ''}
    </div>

    <h2>Follow-ups</h2>
    <div class="group">${tasks.map(taskCell).join('')}<button class="cell act" data-act="task" data-id="${id}">${ic('plus')}Add a follow-up</button></div>

    <h2>Quotes</h2>
    <div class="group">${leadQuotes.map(x => `<button class="cell nav" data-act="quote-open" data-q="${x.id}"><span class="cell-main"><b>${esc(x.number)} · ${cad(x.total)}</b><small>${{ draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' }[x.status]} · ${ago(utc(x.updated_at))}</small></span>${ic('chev')}</button>`).join('')}
      <button class="cell act" data-act="quote-new" data-id="${id}">${ic('plus')}New material quote</button></div>

    <h2>Project</h2>
    <div class="group">${cell('Value', p.value ? cad(p.value).replace(/\.00$/, '') : 'Not stated')}${cell('Work', esc(workLabel(p)))}${cell('Permit type', esc(tcase(p.category || '')))}${cell('Issued', p.issued_date ? dlong(p.issued_date) : '')}${cell('Applied', p.filed_date ? dlong(p.filed_date) : '')}${cell('Status', esc(tcase(p.status || '')))}
      ${p.applicant && p.contractor && p.applicant !== p.contractor ? cell('Applicant', esc(tcase(p.applicant))) : ''}
      <a class="cell tap" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat != null ? p.lat + ',' + p.lng : ''}" ${p.lat == null ? 'hidden' : ''}><span>Site</span><b>Open Street View</b></a></div>
    ${p.description ? `<div class="group pad"><p class="eyebrow">Permit description</p><p class="desc">${esc(p.description)}</p></div>` : ''}

    <h2>Activity</h2>
    ${row?.notes ? `<div class="group pad"><p class="eyebrow">Earlier notes</p><p class="desc">${esc(row.notes)}</p></div>` : ''}
    <div class="group">${log.length ? log.map(a => `<div class="cell log">${ic(logIc[a.kind] || 'note')}<span class="cell-main"><b>${a.kind === 'call' ? 'Call · ' : a.kind === 'email' ? 'Email · ' : ''}${esc(a.kind === 'stage' ? tcaseStage(a.body) : a.body)}</b><small>${esc(a.who || 'Someone')} · ${ago(utc(a.created_at))}</small></span>${a.kind === 'note' ? `<button class="ib sm" data-act="act-del" data-a="${a.id}" aria-label="Delete note">${ic('trash')}</button>` : ''}</div>`).join('')
      : `<div class="cell"><span class="mutedc">Nothing yet. Calls, emails, notes and stage changes are logged here for the whole team.</span></div>`}</div>

    ${p.history.length ? `<h2>More from ${esc(b)}</h2><div class="group">${p.history.slice(0, 5).map(h => `<button class="cell nav" data-act="lead" data-id="${esc(h.id)}"><span class="cell-main"><b>${esc(addr(h))}</b><small>${esc(h.city || '')} · ${esc(workLabel(h))} · ${dlong(h.issued_date)}</small></span><i class="fig-r">${money(h.value)}</i>${ic('chev')}</button>`).join('')}
      ${p.history.length > 5 && k ? `<button class="cell act" data-act="builder" data-k="${esc(k)}">See all their permits</button>` : ''}</div>` : ''}
    <p class="foot-note">Source: ${esc(p.city || p.source)} permit records · first seen ${dlong(p.first_seen)}</p>
  </div>`;
  const isc = $('.iscroll', el); isc.scrollTop = st;
  const bar = $('.ibar', el), onS = () => bar.classList.toggle('scrolled', isc.scrollTop > 90); onS(); isc.addEventListener('scroll', onS, { passive: true });
}
const tcaseStage = s => String(s || '').replace(/\b(new|contacted|quoted|won|lost)\b/g, m => STAGE_LABEL[m]);
function taskCell(a) {
  const due = local(a.due_at), late = !a.done_at && due < Date.now();
  return `<div class="cell task${a.done_at ? ' done' : ''}"><button class="chk${a.done_at ? ' on' : ''}" data-act="task-done" data-a="${a.id}" data-done="${a.done_at ? '' : 1}" aria-label="${a.done_at ? 'Mark not done' : 'Mark done'}" aria-pressed="${!!a.done_at}">${ic('check')}</button>
    <span class="cell-main"><b>${esc(a.body)}</b><small class="${late ? 'late' : ''}">${late ? 'Overdue · ' : ''}${dstr(due)} at ${t12(due)}${a.who ? ' · ' + esc(a.who) : ''}</small></span>
    <button class="ib sm" data-act="task-ics" data-a="${a.id}" aria-label="Add to calendar">${ic('today')}</button><button class="ib sm" data-act="act-del" data-a="${a.id}" aria-label="Delete follow-up">${ic('trash')}</button></div>`;
}
const getLead = async id => leadData && leadData.id === id ? leadData : api('/api/permits/' + enc(id));

A['lead-share'] = () => { const p = leadData, t = `${addr(p)}, ${p.city}\n${workLabel(p)} · ${money(p.value)} · issued ${dlong(p.issued_date)}\nBuilder: ${bname(p) || 'not named'}\nLead score ${p.score}`; navigator.share ? navigator.share({ title: addr(p), text: t }).catch(() => { }) : copyText(t); };
A['route-toggle'] = async d => routeToggle(await getLead(d.id));
A.builder = d => openBuilder(d.k);
I.watch = async el => { await api('/api/watches/' + enc(el.dataset.k), el.checked ? 'PUT' : 'DELETE', el.checked ? { name: el.dataset.name } : undefined); toast(el.checked ? `Watching ${el.dataset.name}` : 'Stopped watching'); await sync(); };

/* ---- pipeline stage ---- */
const putStage = (id, stage, reason) => api('/api/pipeline/' + enc(id), 'PUT', { stage, reason });
A['lead-save'] = async d => { await putStage(d.id, 'new'); await sync(); toast('Saved to the pipeline'); };
A['stage-set'] = async d => {
  const was = stageOf(d.id); if (was === d.s) return;
  if (d.s === 'lost') return lostSheet(d.id);
  const row = PIPE.find(r => r.id === d.id);
  if (row) { row.stage = d.s; row.stage_updated = new Date().toISOString().slice(0, 19).replace('T', ' '); refresh(); }   // show it at once; the server confirms below
  try { await putStage(d.id, d.s); } finally { await sync(); }
  toast(`Moved to ${STAGE_LABEL[d.s]}`, was ? { label: 'Undo', fn: async () => { await putStage(d.id, was); await sync(); } } : {});
};
function lostSheet(id) {
  sheet({ title: 'Why was it lost?', cancel: 'Cancel', html: `<div class="group">${['Price', 'Timing', 'Went with another supplier', 'No response', 'Not a fit'].map(r => `<button class="cell act plain" data-act="lost-save" data-id="${esc(id)}" data-r="${r}">${r}</button>`).join('')}</div><p class="foot-note">The reason is saved in the lead's history, so the team can see where deals slip.</p>` });
}
A['lost-save'] = async (d, el) => { await putStage(d.id, 'lost', d.r.toLowerCase()); sheetOf(el)?.close(); await sync(); toast('Marked lost'); };
A['stage-more'] = d => sheet({ title: 'Pipeline', cancel: 'Cancel', html: `<div class="group"><button class="cell act plain" data-act="stage-set" data-id="${esc(d.id)}" data-s="lost" data-close="1">Mark as lost</button><button class="cell act danger" data-act="lead-remove" data-id="${esc(d.id)}" data-close="1">Remove from pipeline</button></div><p class="foot-note">Removing keeps the activity history and quotes.</p>` });
A['lead-remove'] = async d => { const was = stageOf(d.id); await api('/api/pipeline/' + enc(d.id), 'DELETE'); await sync(); toast('Removed from the pipeline', was ? { label: 'Undo', fn: async () => { await putStage(d.id, was); await sync(); } } : {}); };

/* ---- call ---- */
function nextBiz(days, time) { const d = new Date(); d.setHours(0, 0, 0, 0); for (let i = 0; i < days;) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) i++; } return `${ymd(d)} ${time}`; }
A.call = async d => {
  const p = await getLead(d.id), ph = d.phone || phonesOf(p)[0];
  if (!ph) return A.find(d);
  const a = document.createElement('a'); a.href = 'tel:' + ph.replace(/[^\d+]/g, ''); a.click();
  sheet({
    title: 'Log the call', sub: `${bname(p) || addr(p)} · ${ph}`, cancel: 'Skip',
    html: `<div class="group">${['Reached', 'Left voicemail', 'No answer'].map(o => `<button class="cell act plain" data-act="call-log" data-id="${esc(p.id)}" data-o="${o}">${o}</button>`).join('')}</div>
      ${field('What did they say? (optional)', `<textarea id="callnote" rows="2"></textarea>`)}<p class="foot-note">A voicemail or missed call books a call-back for you: in two working days, or tomorrow.</p>`
  });
};
A['call-log'] = async (d, el) => {
  const sh = sheetOf(el), note = $('#callnote', sh.el).value.trim(), p = await getLead(d.id);
  const follow = d.o === 'Reached' ? null : { due_at: nextBiz(d.o === 'No answer' ? 1 : 2, '09:30'), body: `Call back ${bname(p) || addr(p)}` };
  await api('/api/activity', 'POST', { permit_id: d.id, kind: 'call', body: d.o + (note ? ' — ' + note : ''), follow_up: follow });
  sh.close(); await sync(); toast(follow ? `Logged. Call-back set for ${dstr(local(follow.due_at))}.` : 'Call logged');
};
A.find = async d => {
  const p = await getLead(d.id), b = p.contractor || p.applicant || '', g = q => `https://www.google.com/search?q=${enc(q)}`;
  sheet({ title: 'Find a number', sub: tcase(b) || addr(p), html: `<p class="foot-note top">${b ? 'This builder is not in your contractor list yet.' : 'The permit does not name a builder.'} These searches usually turn up the office line.</p>
    <div class="group">${b ? `<a class="cell tap" target="_blank" rel="noopener" href="${g(`${b} ${p.city || ''} BC phone`)}"><span>Office phone</span><b>Search</b></a><a class="cell tap" target="_blank" rel="noopener" href="${g(`${b} BC Housing licensed builder`)}"><span>Builder licence record</span><b>Search</b></a>` : ''}
    <a class="cell tap" target="_blank" rel="noopener" href="${g(`"${addr(p)}" ${p.city || ''}`)}"><span>This address</span><b>Search</b></a></div>
    <p class="foot-note">Found one? Add it in a note so the team has it, and ask your admin to add the builder to the contractor list.</p>` });
};

/* ---- email ---- */
function fill(text, p, to) {
  const c = p.contact, first = c?.person && (!to || emailsOf({ contact: c }).includes(to)) ? String(c.person).split(/[\s,]+/)[0] : 'there';
  const v = { first, builder: bname(p), address: addr(p), city: p.city || '', me: ME?.name || '', yard: U.yard.name || '', phone: U.yard.phone || '' };
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => v[k] ?? m).replace(/\n{3,}/g, '\n\n').trim();
}
A.email = async d => {
  const p = await getLead(d.id), ems = emailsOf(p), to = d.to || ems[0] || '', st = stageOf(p.id);
  const t = U.tpl.find(x => x.id === (d.tpl || (st === 'quoted' ? 'quote' : leadActs.some(a => a.kind === 'call' || a.kind === 'email') && leadId === p.id ? 'follow' : 'intro'))) || U.tpl[0];
  sheet({
    title: 'New email', sub: addr(p), tall: true, cancel: 'Cancel', action: `<button class="tb strong" data-act="mail-send">Send</button>`,
    html: `<div id="mailform" data-id="${esc(p.id)}"><div class="group">
      <label class="cell"><span>To</span><input name="to" type="email" list="mail-l" value="${esc(to)}" placeholder="name@company.com" ${to ? '' : 'autofocus'}><datalist id="mail-l">${ems.map(e => `<option value="${esc(e)}">`).join('')}</datalist></label>
      <label class="cell"><span>Template</span><select name="tpl" data-on="mail-tpl" data-ev="change">${U.tpl.map(x => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="cell"><span>Subject</span><input name="subject" value="${esc(fill(t.subject, p, to))}"></label></div>
      <div class="group ta"><textarea name="body" id="mailbody" rows="12" aria-label="Message">${esc(fill(t.body, p, to))}</textarea><button class="ib sm mic" data-act="dictate" data-for="mailbody" aria-label="Dictate">${ic('mic')}</button></div>
      ${to ? '' : `<p class="foot-note">No email is on file for this builder. Type one above.</p>`}${ME?.name && U.yard.name ? '' : `<p class="foot-note">Add your name and yard in Settings so emails are signed properly.</p>`}</div>`,
    foot: `<button class="btn soft" data-act="mail-copy">${ic('copy')}Copy text</button>`
  });
};
I['mail-tpl'] = async el => { const w = $('#mailform'), p = await getLead(w.dataset.id), t = U.tpl.find(x => x.id === el.value), to = $('[name=to]', w).value; $('[name=subject]', w).value = fill(t.subject, p, to); $('[name=body]', w).value = fill(t.body, p, to); };
A['mail-send'] = async (d, el) => {
  const sh = sheetOf(el), f = formOf(sh.el), id = $('#mailform').dataset.id;
  if (!/^\S+@\S+\.\S+$/.test(f.to)) { $('[name=to]', sh.el).focus(); return toast('Add an email address first'); }
  const a = document.createElement('a'); a.href = `mailto:${enc(f.to)}?subject=${enc(f.subject)}&body=${enc(f.body)}`; a.click();
  await api('/api/activity', 'POST', { permit_id: id, kind: 'email', body: `${f.subject} → ${f.to}` });
  sh.close(); await sync(); toast('Opened in your mail app and logged');
};
A['mail-copy'] = (d, el) => { const f = formOf(sheetOf(el).el); copyText(`Subject: ${f.subject}\n\n${f.body}`); };

/* ---- notes and follow-ups ---- */
A.note = async d => {
  const p = await getLead(d.id);
  sheet({ title: 'New note', sub: addr(p), cancel: 'Cancel', action: `<button class="tb strong" data-act="note-save" data-id="${esc(p.id)}">Save</button>`,
    html: `<div class="group ta"><textarea id="notetext" rows="6" placeholder="What did you learn?" autofocus></textarea><button class="ib sm mic" data-act="dictate" data-for="notetext" aria-label="Dictate">${ic('mic')}</button></div>${stageOf(p.id) ? '' : `<p class="foot-note">Saving a note also saves this lead to the pipeline.</p>`}` });
};
A['note-save'] = async (d, el) => { const sh = sheetOf(el), t = $('#notetext', sh.el).value.trim(); if (!t) return $('#notetext', sh.el).focus(); await api('/api/activity', 'POST', { permit_id: d.id, kind: 'note', body: t }); sh.close(); await sync(); toast('Note saved'); };
A['act-del'] = async d => {
  const a = leadActs.find(x => String(x.id) === d.a) || TASKS.find(x => String(x.id) === d.a);
  await api('/api/activity/' + d.a, 'DELETE'); await sync();
  toast(a?.kind === 'task' ? 'Follow-up deleted' : 'Note deleted', a ? { label: 'Undo', fn: async () => { await api('/api/activity', 'POST', { permit_id: a.permit_id, kind: a.kind, body: a.body, due_at: a.due_at }); await sync(); } } : {});
};
function slot() { const d = new Date(Date.now() + 36e5); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); if (d.getHours() >= 17 || d.getHours() < 8 || !(d.getDay() % 6)) { if (d.getHours() >= 17) d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); while (!(d.getDay() % 6)) d.setDate(d.getDate() + 1); } return d; }
A.task = async d => {
  const p = d.id ? await getLead(d.id) : null, s = slot(), who = p ? bname(p) || addr(p) : '';
  const kinds = p ? [`Call ${who}`, `Site visit at ${addr(p)}`, `Send quote to ${who}`, `Drop off a price list`] : ['Call back', 'Site visit', 'Send quote'];
  sheet({ title: 'New follow-up', sub: p ? addr(p) : '', cancel: 'Cancel', action: `<button class="tb strong" data-act="task-save" data-id="${p ? esc(p.id) : ''}">Add</button>`,
    html: `<div id="taskform"><div class="group"><label class="cell"><span>What</span><input name="body" value="${esc(kinds[0])}" autofocus></label></div>
      <div class="chips">${kinds.map(x => `<button class="chip" data-act="task-kind" data-v="${esc(x)}">${esc(x.split(' ').slice(0, 2).join(' '))}</button>`).join('')}</div>
      <div class="group"><label class="cell"><span>Date</span><input type="date" name="date" value="${ymd(s)}"></label><label class="cell"><span>Time</span><input type="time" name="time" value="${hm(s)}" step="900"></label></div>
      <div class="chips">${[['Tomorrow', 1], ['In 2 days', 2], ['Next week', 5]].map(([l, n]) => `<button class="chip" data-act="task-when" data-n="${n}">${l}</button>`).join('')}</div></div>` });
};
A['task-kind'] = d => { $('#taskform [name=body]').value = d.v; };
A['task-when'] = d => { const [dt, tm] = nextBiz(+d.n, '09:00').split(' '); $('#taskform [name=date]').value = dt; $('#taskform [name=time]').value = tm; };
A['task-save'] = async (d, el) => {
  const sh = sheetOf(el), f = formOf($('#taskform', sh.el)); if (!f.body) return $('[name=body]', sh.el).focus();
  if (!f.date || !f.time) return toast('Pick a date and time');
  await api('/api/activity', 'POST', { permit_id: d.id || null, kind: 'task', body: f.body, due_at: `${f.date} ${f.time}` });
  sh.close(); await sync(); toast(`Follow-up set for ${dstr(local(f.date + ' ' + f.time))}`);
};
A['task-done'] = async d => {
  for (const l of [TASKS, leadActs]) { const a = l.find(t => String(t.id) === d.a); if (a) a.done_at = d.done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null; }
  refresh();                                                                          // tick it at once; the server confirms below
  try { await api('/api/activity/' + d.a, 'PUT', { done: !!d.done }); } finally { await sync(); }
};
A['task-ics'] = d => {
  const a = TASKS.find(t => String(t.id) === d.a) || leadActs.find(t => String(t.id) === d.a), z = s => s.replace(/[-:]/g, '').replace(' ', 'T') + '00', e = s => String(s || '').replace(/([,;\\])/g, '\\$1');
  const end = local(a.due_at); end.setMinutes(end.getMinutes() + 30);
  download('follow-up.ics', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Steady Leads//EN\r\nBEGIN:VEVENT\r\nUID:task-${a.id}@steadyleads\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}\r\nDTSTART:${z(a.due_at)}\r\nDTEND:${z(ymd(end) + ' ' + hm(end))}\r\nSUMMARY:${e(a.body)}\r\nLOCATION:${e(a.address ? `${a.address}, ${a.city || ''}` : leadData ? `${leadData.address}, ${leadData.city}` : '')}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`, 'text/calendar');
};

/* ---- material quotes ---- */
let QUOTE = null, quoteSheet = null;
const qSum = q => { const sub = q.data.items.reduce((s, i) => s + (+i.qty || 0) * (+i.rate || 0), 0), tax = sub * (+q.data.tax || 0) / 100; return { sub, tax, total: sub + tax }; };
const qTotals = q => { const t = qSum(q); return `<div><span>Subtotal</span><b>${cad(t.sub)}</b></div><div><span>Tax (${+q.data.tax || 0}%)</span><b>${cad(t.tax)}</b></div><div class="grand"><span>Total</span><b>${cad(t.total)}</b></div>`; };
A['quote-new'] = async d => {
  const p = await getLead(d.id), frame = p.work_type === 'new' || p.work_type === 'addition';
  const items = (frame ? ['Framing lumber package', 'Sheathing and subfloor', 'Engineered wood: I-joists, LVL, beams', 'Jobsite delivery'] : ['Materials as per list', 'Jobsite delivery']).map(x => ({ desc: x, qty: 1, unit: 'lot', rate: 0 }));
  openQuote({ id: null, permit_id: p.id, status: 'draft', number: null, data: { client: bname(p), attn: p.contact?.person || '', items, tax: U.yard.tax ?? 12, terms: 'Prices held for 14 days. Subject to stock at time of order. Delivery scheduled on confirmation.' } }, p);
};
A['quote-open'] = async d => { const q = leadQuotes.find(x => String(x.id) === d.q) || (await api('/api/quotes')).find(x => String(x.id) === d.q); openQuote(q, await getLead(q.permit_id)); };
function openQuote(q, p) {
  QUOTE = JSON.parse(JSON.stringify(q)); QUOTE.p = { address: addr(p), city: p.city, work: workLabel(p) };
  quoteSheet = sheet({
    title: QUOTE.number ? `Quote ${QUOTE.number}` : 'New quote', sub: addr(p), tall: true, cancel: 'Cancel', action: `<button class="tb strong" data-act="quote-save">Save</button>`, onClose: () => { quoteSheet = null; },
    render: () => { const D = QUOTE.data; return `<div class="group"><label class="cell"><span>Customer</span><input data-on="q-in" data-f="client" value="${esc(D.client)}"></label><label class="cell"><span>Attention</span><input data-on="q-in" data-f="attn" value="${esc(D.attn || '')}" placeholder="Name"></label></div>
      ${QUOTE.id ? '' : `<p class="foot-note">Lines are suggested from the permit. Prices start at zero for you to fill in.</p>`}
      ${D.items.map((it, i) => `<div class="group item"><div class="cell"><input data-on="q-in" data-f="items.${i}.desc" value="${esc(it.desc)}" placeholder="Description" aria-label="Description"><button class="ib sm" data-act="q-del" data-i="${i}" aria-label="Remove line">${ic('x')}</button></div>
        <div class="cell nums"><label><small>Qty</small><input type="number" inputmode="decimal" min="0" step="any" data-on="q-in" data-f="items.${i}.qty" value="${it.qty}"></label><label><small>Unit</small><input data-on="q-in" data-f="items.${i}.unit" value="${esc(it.unit)}"></label><label><small>Price</small><input type="number" inputmode="decimal" min="0" step="any" data-on="q-in" data-f="items.${i}.rate" value="${it.rate || ''}" placeholder="0.00"></label></div></div>`).join('')}
      <div class="group"><button class="cell act" data-act="q-add">${ic('plus')}Add a line</button></div>
      <div class="group"><label class="cell"><span>Tax %</span><input type="number" inputmode="decimal" min="0" step="any" data-on="q-in" data-f="tax" value="${D.tax}"></label></div>
      <div class="totals" id="q-totals">${qTotals(QUOTE)}</div>
      <div class="group ta"><textarea rows="3" data-on="q-in" data-f="terms" aria-label="Terms">${esc(D.terms || '')}</textarea></div>
      ${QUOTE.id ? `<div class="group"><label class="cell"><span>Status</span><select data-on="q-status" data-ev="change">${[['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined']].map(([v, l]) => `<option value="${v}" ${QUOTE.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="cell act" data-act="quote-print">${ic('print')}Print or save as PDF</button><button class="cell act danger" data-act="quote-del">Delete quote</button></div>` : ''}`; },
    foot: `<button class="btn wide" data-act="quote-send">${q.status === 'draft' ? 'Save and mark as sent' : 'Save'}</button>`
  });
}
I['q-in'] = el => { const path = el.dataset.f.split('.'); let o = QUOTE.data; while (path.length > 1) o = o[path.shift()]; o[path[0]] = el.type === 'number' ? (el.value === '' ? 0 : +el.value) : el.value; $('#q-totals').innerHTML = qTotals(QUOTE); };
I['q-status'] = el => { QUOTE.status = el.value; };
A['q-add'] = () => { QUOTE.data.items.push({ desc: '', qty: 1, unit: 'ea', rate: 0 }); quoteSheet.update(); const ins = $$('.item input[data-f$=desc]', quoteSheet.el); ins[ins.length - 1].focus(); };
A['q-del'] = d => { QUOTE.data.items.splice(+d.i, 1); quoteSheet.update(); };
async function saveQuote(status) {
  const saved = QUOTE.id ? await api('/api/quotes/' + QUOTE.id, 'PUT', { data: QUOTE.data, status: status || QUOTE.status }) : await api('/api/quotes', 'POST', { permit_id: QUOTE.permit_id, data: QUOTE.data });
  if (!QUOTE.id && status) return api('/api/quotes/' + saved.id, 'PUT', { status });
  return saved;
}
A['quote-save'] = async () => { const s = await saveQuote(); quoteSheet.close(); await sync(); toast(`Quote ${s.number} saved`); };
A['quote-send'] = async () => {
  if (QUOTE.status !== 'draft') return A['quote-save']();
  if (!qSum(QUOTE).sub) return toast('Add at least one price first');
  const pid = QUOTE.permit_id, s = await saveQuote('sent'); quoteSheet.close(); await sync();
  toast(`Quote ${s.number} marked sent. Lead moved to Quoted.`, { label: 'Email it', fn: () => A.email({ id: pid, tpl: 'quote' }) });
};
A['quote-del'] = async (d, el) => { if (!sure(el, 'Tap again to delete this quote')) return; await api('/api/quotes/' + QUOTE.id, 'DELETE'); quoteSheet.close(); await sync(); toast('Quote deleted'); };
A['quote-print'] = () => {
  const q = QUOTE, D = q.data, t = qSum(q);
  $('#print').innerHTML = `<header><div><h1>${esc(U.yard.name || 'Your yard')}</h1><p>${esc([ME?.name, U.yard.phone, ME?.email].filter(Boolean).join(' · '))}</p></div><div class="r"><h2>Quote ${esc(q.number || '')}</h2><p>${dstr(new Date(), { year: 'numeric', month: 'long', day: 'numeric' })}</p></div></header>
    <section class="two"><div><h3>Prepared for</h3><p><b>${esc(D.client || '')}</b>${D.attn ? `<br>Attn: ${esc(D.attn)}` : ''}</p></div><div><h3>Project</h3><p>${esc(q.p.address)}, ${esc(q.p.city || '')}<br>${esc(q.p.work)}</p></div></section>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Amount</th></tr></thead><tbody>${D.items.map(i => `<tr><td>${esc(i.desc)}</td><td>${i.qty}</td><td>${esc(i.unit)}</td><td>${cad(i.rate)}</td><td>${cad(i.qty * i.rate)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Subtotal</td><td>${cad(t.sub)}</td></tr><tr><td colspan="4">Tax (${+D.tax || 0}%)</td><td>${cad(t.tax)}</td></tr><tr class="g"><td colspan="4">Total</td><td>${cad(t.total)}</td></tr></tfoot></table>
    <h3>Terms</h3><p class="pre">${esc(D.terms || '')}</p>`;
  setTimeout(() => window.print(), 80);
};
