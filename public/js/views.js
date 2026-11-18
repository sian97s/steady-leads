'use strict';
/* Today, Pipeline, Builders, Lead Agent, Sources, Team, Settings. */
const vhead = (title, sub = '', right = '', back = '') => `<header class="bar"><div class="bar-row">${back ? `<button class="ib only-m" data-act="go" data-v="${back}" aria-label="Back">${ic('back')}</button>` : ''}<div class="bar-t"><h1>${title}</h1>${sub ? `<p class="bar-sub">${sub}</p>` : ''}</div><span class="grow"></span>${right}<button class="me only-m" data-act="settings" aria-label="Account">${esc(initials(ME?.name || ME?.email))}</button></div></header>`;
const miniLead = p => `<button class="cell nav" data-act="lead" data-id="${esc(p.id)}">${scOf(p)}<span class="cell-main"><b>${esc(addr(p))}</b><small>${esc(p.city || '')} · ${esc(workLabel(p))} · ${issuedAgo(p)}${bname(p) ? ' · ' + esc(bname(p)) : ''}</small></span><i class="fig-r">${money(p.value)}</i>${ic('chev')}</button>`;

/* ---------- Scoreboard: this week's points per rep ---------- */
let BOARD = null;
const toUTC = d => d.toISOString().slice(0, 19).replace('T', ' ');
function weekStart(back = 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7); return d; }
async function loadBoard() { BOARD = await api(`/api/scoreboard?from=${enc(toUTC(weekStart()))}&prev=${enc(toUTC(weekStart(1)))}`); }
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
// Working days in a row with at least one call or email, counting back from today (or yesterday, if today has none yet).
function streak(touches) {
  const days = new Set((touches || []).map(t => ymd(utc(t)))), d = new Date(); d.setHours(12, 0, 0, 0);
  if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  for (let i = 0; i < 60; i++) {
    if (d.getDay() % 6) { if (!days.has(ymd(d))) break; n++; }
    d.setDate(d.getDate() - 1);
  }
  return n;
}
function standing() {
  if (!BOARD) return null;
  const reps = BOARD.reps, i = reps.findIndex(r => r.id === BOARD.me), me = reps[i] || { points: 0, last_week: 0 };
  const ahead = i > 0 ? reps[i - 1] : null, goal = U.goal || 60;
  return { reps, i, me, rank: i + 1, ahead, gap: ahead ? ahead.points - me.points + 1 : 0, lead: i === 0 && reps[1] ? me.points - reps[1].points : 0, goal, streak: streak(BOARD.touches) };
}
function raceHTML() {
  const S = standing(); if (!S) return `<div class="race"><div class="skel short" style="opacity:.2;margin:0"></div></div>`;
  const { reps, me, goal } = S, scale = Math.max(goal * 1.15, ...reps.map(r => r.points), 1);
  let show = reps.slice(0, 5); if (S.i >= 5) show = [...reps.slice(0, 4), me];
  const line = !me.points ? 'Log a call or save a lead to get on the board.'
    : S.rank === 1 ? (S.lead ? `You lead by <b>${plural(S.lead, 'point')}</b>.` : `You're level at the top.`)
      : `<b>${plural(S.gap, 'point')}</b> to pass ${esc(String(S.ahead.name).split(' ')[0])}. A reached call is 3, a quote 5.`;
  return `<section class="race" aria-label="This week's scoreboard"><header><b>This week</b><span>${reps.length > 1 ? `${ord(S.rank)} of ${reps.length}` : 'Points from calls, quotes and wins'}</span><button class="lnk" data-act="points-help">How points work</button></header>
    <ol>${show.map(r => `<li class="${r.id === BOARD.me ? 'mine' : ''}"><span class="rk">${reps.indexOf(r) + 1}</span><span class="nm">${r.id === BOARD.me ? 'You' : esc(r.name)}</span><span class="track" style="--goal:${Math.min(100, goal / scale * 100)}%"><i style="width:${r.points / scale * 100}%"></i></span><b>${r.points}</b></li>`).join('')}</ol>
    <footer><span>${line}</span><span>${ic('today')}<b>${S.streak}</b> ${S.streak === 1 ? 'day' : 'days'} in a row</span><span>Goal <b>${goal}</b> · last week <b>${me.last_week}</b></span></footer></section>`;
}
A['points-help'] = () => sheet({ title: 'How points work', render: () => { const P = BOARD?.points || {}; return `<div class="group rules">${[['Call that reached someone', P.reached], ['Call or email', P.call], ['Lead saved to the pipeline', P.save], ['Follow-up done', P.followup], ['Quote sent', P.quote], ['Order won', P.win]].map(([t, n]) => `<div class="cell"><span>${t}</span><b>+${n}</b></div>`).join('')}</div>
  <p class="foot-note">Points reset every Monday. Everyone on the team sees the board, so the scores come straight from what is logged in the app.</p>
  <div class="group"><label class="cell"><span>My weekly goal</span><select data-on="goal" data-ev="change">${[30, 45, 60, 80, 100, 150].map(v => `<option value="${v}" ${(U.goal || 60) === v ? 'selected' : ''}>${v} points</option>`).join('')}</select></label></div>`; } });
I.goal = el => { U.goal = +el.value; saveU(); refresh(); };
// The single most useful thing to do next: an overdue follow-up, then a lead going cold, then the best fresh permit.
function nextMove() {
  const now = Date.now(), od = TASKS.filter(t => !t.done_at && local(t.due_at) < now && t.permit_id).sort((a, b) => local(a.due_at) - local(b.due_at))[0];
  if (od) return { id: od.permit_id, title: od.body, why: `Overdue since ${dstr(local(od.due_at))}${od.address ? ' · ' + tcase(String(od.address).split(',')[0]) : ''}`, act: 'call', cta: 'Call', pts: 3 };
  const w = PIPE.map(r => ({ r, n: nextStep(r) })).filter(x => x.n.tone === 'warn').sort((a, b) => b.r.score - a.r.score)[0];
  if (w) return { id: w.r.id, title: w.n.text, why: `${addr(w.r)}${bname(w.r) ? ' · ' + bname(w.r) : ''}`, act: w.n.act, cta: { call: 'Call', email: 'Email', find: 'Find', 'quote-new': 'Quote' }[w.n.act] || 'Open', pts: w.n.act === 'quote-new' ? 5 : w.n.act === 'call' ? 3 : 1 };
  const h = TODAY?.hot?.[0];
  if (h) return { id: h.id, title: `New hot permit: ${addr(h)}`, why: `${money(h.value)} · ${workLabel(h)}${bname(h) ? ' · ' + bname(h) : ''}`, act: 'lead-save', cta: 'Save', pts: 1 };
  return null;
}
function moveHTML() {
  const m = nextMove(); if (!m) return '';
  const can = m.act && A[m.act];
  return `<section class="move" aria-label="Next move">${sc(PIPE.find(r => r.id === m.id)?.score ?? TODAY?.hot?.find(h => h.id === m.id)?.score ?? 0, PIPE.some(r => r.id === m.id) ? 'new' : null)}<div><small>Your next move${m.pts ? ` · <span class="pts">+${m.pts} pts</span>` : ''}</small><b>${esc(m.title)}</b><small>${esc(m.why)}</small></div>
    <button class="btn sm" data-act="${can ? m.act : 'lead'}" data-id="${esc(m.id)}">${can ? m.cta : 'Open'}</button></section>`;
}

/* ---------- Today ---------- */
let TODAY = null;
function briefHTML(due, nudges, active) {
  const todo = due.length + nudges.length, late = due.filter(t => local(t.due_at) < Date.now()).length, S = standing();
  const hot = `<a class="hotlink" data-act="agent-apply" data-f='${esc(JSON.stringify({ ...blankF(), score: 70, days: 7, untouched: true }))}'>${plural(TODAY.week, 'hot permit')}</a>`;
  const a = todo ? `You have <a data-act="go" data-v="pipeline">${plural(todo, 'thing')} to do</a>${late ? `, ${late} overdue` : ''}.` : 'Nothing is overdue.';
  const b = `${hot} came in this week.`;
  const c = S && S.reps.length > 1 && S.me.points ? `You're <a data-act="go" data-v="pipeline">${ord(S.rank)} on the board</a> with ${S.me.points} points${S.ahead ? `, ${S.gap} behind ${esc(String(S.ahead.name).split(' ')[0])}` : ''}.` : active.length ? `${plural(active.length, 'lead')} open in the pipeline.` : '';
  return `${a} ${b} ${c}`;
}
function renderToday() {
  const now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 999);
  const open = TASKS.filter(t => !t.done_at), due = open.filter(t => local(t.due_at) <= end), later = open.filter(t => local(t.due_at) > end && local(t.due_at) - now < 8 * DAY);
  const dueIds = new Set(due.map(t => t.permit_id));
  const nudges = PIPE.filter(r => !dueIds.has(r.id)).map(r => ({ r, n: nextStep(r) })).filter(x => x.n.tone === 'warn');
  const active = PIPE.filter(r => !['won', 'lost'].includes(r.stage));
  const h = new Date().getHours(), first = (ME?.name || '').split(' ')[0];
  const tRow = t => `<div class="cell task"><button class="chk" data-act="task-done" data-a="${t.id}" data-done="1" aria-label="Mark done">${ic('check')}</button>
    <button class="cell-main" ${t.permit_id ? `data-act="lead" data-id="${esc(t.permit_id)}"` : ''}><b>${esc(t.body)}</b><small class="${local(t.due_at) < now ? 'late' : ''}">${local(t.due_at) < now ? 'Overdue · ' : ''}${dstr(local(t.due_at))} at ${t12(local(t.due_at))}${t.address ? ' · ' + esc(tcase(String(t.address).split(',')[0])) : ''}</small></button></div>`;
  const body = !TODAY ? `<div class="skel"></div>` : `
    <p class="brief">${briefHTML(due, nudges, active)}</p>
    ${moveHTML()}
    <h2>Do next</h2>
    <div class="group">${due.length || nudges.length ? due.map(tRow).join('') + nudges.map(({ r, n }) => `<button class="cell nav" data-act="lead" data-id="${esc(r.id)}">${ic('warn', 'warn-t')}<span class="cell-main"><b>${esc(n.text)}</b><small>${esc(addr(r))}${bname(r) ? ' · ' + esc(bname(r)) : ''}</small></span>${ic('chev')}</button>`).join('')
      : `<div class="cell"><span class="mutedc">You are caught up. Nothing is overdue.</span></div>`}
      <button class="cell act" data-act="task">${ic('plus')}Add a reminder</button></div>
    <h2>New and hot</h2>
    <div class="group">${TODAY.hot.length ? TODAY.hot.map(miniLead).join('') : `<div class="cell"><span class="mutedc">No unsaved leads scored 70 or higher in the last 10 days.</span></div>`}</div>
    ${WATCH.length ? `<h2>From builders you watch</h2><div class="group">${TODAY.watched.length ? TODAY.watched.map(miniLead).join('') : `<div class="cell"><span class="mutedc">No new permits from your ${plural(WATCH.length, 'watched builder').replace(/^\d+ /, '')} in the last 45 days.</span></div>`}</div>` : ''}
    ${later.length ? `<h2>Coming up</h2><div class="group">${later.map(tRow).join('')}</div>` : ''}
    <p class="foot-note">${META ? `${META.total.toLocaleString()} permits from ${META.cities.length} cities${META.lastImport?.finished_at ? ` · updated ${ago(utc(META.lastImport.finished_at))}` : ''}${META.alerts ? ` · ${plural(META.alerts, 'source alert')}` : ''}` : ''}</p>`;
  return vhead(`${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${first ? ', ' + esc(first) : ''}`, dstr(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })) + `<div class="scroll page">${body}</div>`;
}

/* ---------- Pipeline ---------- */
let pipeStage = 'new';
function renderPipeline() {
  const active = PIPE.filter(r => !['won', 'lost'].includes(r.stage)), won = PIPE.filter(r => r.stage === 'won').length, lost = PIPE.filter(r => r.stage === 'lost').length;
  if (!PIPE.some(r => r.stage === pipeStage)) pipeStage = STAGES.find(s => PIPE.some(r => r.stage === s)) || 'new';
  const order = { warn: 0, info: 1, ok: 2, muted: 3 };
  const card = r => { const n = nextStep(r); return `<button class="pcard" draggable="true" data-act="lead" data-id="${esc(r.id)}"><span class="l1">${scOf(r)}<b>${esc(addr(r))}</b></span><span class="l2">${esc(bname(r) || r.city || '')}</span><span class="l2">${money(r.value)} · ${esc(r.city || '')}</span><span class="step ${n.tone}"><span>${esc(n.text)}</span>${n.tone === 'warn' ? `<span class="pts">+${n.act === 'call' ? 3 : n.act === 'quote-new' ? 5 : 1}</span>` : ''}</span></button>`; };
  const sub = PIPE.length ? `${active.length} open · ${money(active.reduce((s, r) => s + (r.value || 0), 0))} in projects${won + lost ? ` · ${Math.round(won / (won + lost) * 100)}% won` : ''}` : 'Shared with your team';
  return vhead('Pipeline', sub, PIPE.length ? `<button class="ib" data-act="pipe-csv" aria-label="Export the pipeline as a spreadsheet" title="Export as CSV">${ic('share')}</button>` : '') + (PIPE.length ? `
    <div class="pipe-scroll scroll">${raceHTML()}${moveHTML()}
    <div class="bar-under only-m"><div class="seg full" role="tablist">${STAGES.map(s => `<button class="${s === pipeStage ? 'on' : ''}" data-act="pipe-stage" data-s="${s}" role="tab" aria-selected="${s === pipeStage}">${STAGE_LABEL[s]}</button>`).join('')}</div></div>
    <div class="board" data-stage="${pipeStage}">${STAGES.map(s => { const l = PIPE.filter(r => r.stage === s).sort((a, b) => order[nextStep(a).tone] - order[nextStep(b).tone] || b.score - a.score);
      return `<section class="col" data-s="${s}"><h3><i class="dot ${s}"></i>${STAGE_LABEL[s]}<small>${l.length}</small></h3>${l.map(card).join('') || `<p class="col-empty">${{ new: 'Saved leads start here', contacted: 'After the first call or email', quoted: 'When a quote goes out', won: 'Orders you won', lost: 'Closed, with the reason' }[s]}</p>`}</section>`; }).join('')}</div></div>`
    : `<div class="pipe-scroll scroll">${raceHTML()}${moveHTML()}<div class="page">${empty('pipeline', 'No leads saved yet', 'Save a lead and it lands here. Calls, emails and quotes then move it along for you.', `<button class="btn" data-act="go" data-v="leads">Browse leads</button>`)}</div></div>`);
}
A['pipe-stage'] = d => { pipeStage = d.s; refresh(); };
A['pipe-csv'] = () => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, rows = [['Address', 'City', 'Stage', 'Builder', 'Contact', 'Phone', 'Email', 'Project value', 'Work', 'Issued', 'Lead score', 'Next step', 'Last contact', 'Quote']];
  for (const r of PIPE) rows.push([addr(r), r.city, STAGE_LABEL[r.stage], bname(r), r.contact?.person, phonesOf(r)[0], emailsOf(r)[0], r.value, workLabel(r), r.issued_date, r.score, nextStep(r).text, r.last_touch ? r.last_touch.slice(0, 10) : '', r.quote_total ?? '']);
  download(`steady-leads-pipeline-${ymd(new Date())}.csv`, '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv'); toast(`Exported ${plural(PIPE.length, 'lead')}`);
};
let dragId = null;
document.addEventListener('dragstart', e => { const c = e.target.closest?.('.pcard'); if (c) { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } });
document.addEventListener('dragover', e => { const col = e.target.closest?.('.col'); if (col && dragId) { e.preventDefault(); $$('.col.over').forEach(c => c !== col && c.classList.remove('over')); col.classList.add('over'); } });
document.addEventListener('dragend', () => { dragId = null; $$('.col.over').forEach(c => c.classList.remove('over')); });
document.addEventListener('drop', e => { const col = e.target.closest?.('.col'); if (!col || !dragId) return; e.preventDefault(); const id = dragId; dragId = null; col.classList.remove('over'); run(A['stage-set'], { id, s: col.dataset.s }); });

/* ---------- Builders ---------- */
let BUILDERS = null, builderQ = '';
async function loadBuilders() { BUILDERS = await api('/api/builders' + (builderQ ? '?q=' + enc(builderQ) : '')); if (cur === 'builders') $('#blist').innerHTML = builderList(); }
function builderList() {
  if (!BUILDERS) return `<div class="skel"></div>`;
  const row = b => `<button class="cell nav" data-act="builder" data-k="${esc(b.k)}"><span class="av">${initials(tcase(b.name))}</span><span class="cell-main"><b>${esc(tcase(b.name))}</b><small>${b.permits != null ? `${plural(b.permits, 'permit')} this year · ${money(b.total_value)} · last ${dlong(b.last_permit)}` : b.recent ? `${plural(b.recent, 'new permit')} this month` : 'No new permits this month'}</small></span>${b.contact?.phone || b.contact?.email ? `<em class="reach">${ic('phone')}</em>` : ''}${isWatched(b.k) ? ic('star', 'starred') : ''}${ic('chev')}</button>`;
  return `${WATCH.length && !builderQ ? `<h2>Watching</h2><div class="group">${WATCH.map(row).join('')}</div>` : ''}
    <h2>${builderQ ? 'Results' : 'Most active, last 12 months'}</h2>
    ${BUILDERS.length ? `<div class="group">${BUILDERS.slice(0, 120).map(row).join('')}</div>` : empty('search', 'No builder matches', 'Search uses the name on permits from the last 12 months.')}`;
}
const renderBuilders = () => { if (!BUILDERS) run(loadBuilders); return vhead('Builders', 'Who is pulling permits') + `<div class="bar-under"><label class="search"><span class="search-ic">${ic('search')}</span><input type="search" data-on="builder-q" value="${esc(builderQ)}" placeholder="Search builders" aria-label="Search builders"></label></div><div class="scroll page" id="blist">${builderList()}</div>`; };
I['builder-q'] = debounce(el => { builderQ = el.value.trim(); run(loadBuilders); }, 260);
async function openBuilder(k) {
  if (!k) return;
  const b = await api('/api/builders/' + enc(k)), c = b.contact, name = tcase(b.name), phones = [...new Set([c?.phone, c?.alt_phone].filter(Boolean))], ems = emailsOf({ contact: c });
  sheet({
    title: 'Builder', tall: true,
    html: `<div class="bhead"><span class="av lg">${initials(name)}</span><h1>${esc(name)}</h1><p class="sub">${esc([c?.trade, c?.city].filter(Boolean).join(' · ') || 'From permit records')}</p></div>
      <div class="acts">${phones[0] ? `<a class="act-b" href="tel:${esc(phones[0].replace(/[^\d+]/g, ''))}">${ic('phone')}<span>Call</span></a>` : `<span class="act-b" aria-disabled="true">${ic('phone')}<span>Call</span></span>`}
        ${ems[0] ? `<a class="act-b" href="mailto:${esc(ems[0])}">${ic('mail')}<span>Email</span></a>` : `<span class="act-b" aria-disabled="true">${ic('mail')}<span>Email</span></span>`}
        <button class="act-b" data-act="builder-leads" data-k="${esc(k)}" data-name="${esc(name)}">${ic('leads')}<span>On map</span></button>
        <a class="act-b" target="_blank" rel="noopener" href="https://www.google.com/search?q=${enc(b.name + ' BC contractor')}">${ic('globe')}<span>Web</span></a></div>
      <div class="tiles"><div class="tile"><b>${b.year || 0}</b><span>permits this year</span></div><div class="tile"><b>${money(b.total_value || null)}</b><span>all-time value</span></div><div class="tile"><b>${b.cities || 0}</b><span>${b.cities === 1 ? 'city' : 'cities'}</span></div></div>
      <div class="group">${c ? `${cell('Contact', esc(c.person || ''))}${phones.map(p => `<a class="cell tap" href="tel:${esc(p.replace(/[^\d+]/g, ''))}"><span>Phone</span><b>${esc(p)}</b></a>`).join('')}${ems.map(e => `<a class="cell tap" href="mailto:${esc(e)}"><span>Email</span><b>${esc(e)}</b></a>`).join('')}${cell('Address', esc([c.address, c.city].filter(Boolean).join(', ')))}${cell('Licence', esc([c.status, c.licence].filter(Boolean).join(' · ')))}` : `<div class="cell"><span class="mutedc">Not in your contractor list, so there is no phone or email on file.</span></div>`}
        <label class="cell switch"><span>Watch this builder<small>New permits appear on Today</small></span><input type="checkbox" data-on="watch" data-ev="change" data-k="${esc(k)}" data-name="${esc(name)}" ${b.watched ? 'checked' : ''}><i></i></label></div>
      <h2>Permits</h2><div class="group">${b.permits.map(p => `<button class="cell nav" data-act="lead" data-id="${esc(p.id)}">${scOf(p)}<span class="cell-main"><b>${esc(addr(p))}</b><small>${esc(p.city || '')} · ${esc(workLabel(p))} · ${dlong(p.issued_date)}</small></span><i class="fig-r">${money(p.value)}</i>${ic('chev')}</button>`).join('') || `<div class="cell"><span class="mutedc">No building permits on record.</span></div>`}</div>`
  });
}

/* ---------- Lead Agent: plain-language requests, answered from the permit database and your pipeline ---------- */
function agentParse(raw) {
  const t = ' ' + raw.toLowerCase().replace(/[?!,]/g, ' ').replace(/\s+/g, ' ') + ' ', F = blankF(), said = [];
  if (/\bhot\b|best|top leads/.test(t)) { F.score = 70; said.push('scoring 70 or higher'); } else if (/\bwarm\b/.test(t)) { F.score = 45; said.push('scoring 45 or higher'); }
  for (const [k, re, l] of [['new', /\bnew (build|home|house|construction)s?\b|\bnew\b(?! this| today| leads)/, 'new builds'], ['addition', /\badditions?\b/, 'additions'], ['alteration', /\b(alterations?|renos?|renovations?)\b/, 'alterations'], ['demolition', /\b(demolitions?|demos?|teardowns?)\b/, 'demolitions']]) if (!F.type && re.test(t)) { F.type = k; said.push(l); }
  for (const [k, re] of [['residential', /\b(residential|houses?|homes?|single.?family|duplex|townho\w+)\b/], ['commercial', /\b(commercial|retail|office)\b/], ['industrial', /\b(industrial|warehouses?)\b/], ['institutional', /\b(institutional|schools?|hospitals?)\b/], ['mixed', /\bmixed.?use\b/]]) if (!F.use && re.test(t)) { F.use = k; said.push(k); }
  const city = [...(META?.cities || [])].sort((a, b) => b.city.length - a.city.length).find(c => c.city && t.includes(' ' + c.city.toLowerCase() + ' '));
  if (city) { F.city = city.city; said.push('in ' + city.city); }
  const num = (n, u) => +n * (/^m/.test(u || '') ? 1e6 : /^(k|t)/.test(u || '') ? 1e3 : +n < 100 ? 1e6 : +n < 1000 ? 1e3 : 1);
  let m = t.match(/(?:over|above|more than|at least|>)\s*\$?\s*([\d.]+)\s*(k|m|million|thousand)?/); if (m) { F.min = num(m[1], m[2]); said.push('over ' + money(F.min)); }
  m = t.match(/(?:last|past)\s+(\d+)\s+days?/);
  if (m) F.days = +m[1]; else if (/this week|today|fresh|newest|latest|just issued/.test(t)) F.days = 7; else if (/this month/.test(t)) F.days = 30; else if (/this year|12 months/.test(t)) F.days = 365;
  if (F.days !== 90) said.push(`issued in the last ${plural(F.days, 'day')}`);
  if (/with (a |an )?(phone|contact|email|number)|can call|reachable/.test(t)) { F.contact = true; said.push('with a phone or email on file'); }
  if (/\b(saved|my leads)\b/.test(t)) { F.saved = true; F.days = 0; said.push('saved'); }
  if (/largest|biggest|highest value/.test(t)) F.sort = 'value'; else if (/newest|latest|most recent/.test(t)) F.sort = 'fresh';
  m = raw.match(/\b(?:by|from|builder|for|to)\s+([A-Z0-9][\w&.' -]{2,40})$/); const who = m && !city ? m[1].trim() : '';
  let intent = null;
  if (/\b(draft|write|compose)\b|\bemail (to|for)\b/.test(t)) intent = 'draft';
  else if (/who.*(call|chase|contact)|call list|plan my day|my day|what should i|where do i start|\btoday\b/.test(t) && said.length <= 1) intent = 'plan';
  else if (/follow.?ups?|overdue|quiet|slipping|reminders?/.test(t)) intent = 'followups';
  else if (/pipeline|forecast|win rate|how am i doing|how are we doing/.test(t)) intent = 'pipeline';
  else if (/\b(route|drive|visit plan)\b/.test(t)) intent = 'route';
  else if (/\bhelp\b|what can you|how do (i|you)/.test(t)) intent = 'help';
  return { F, said: said.filter((s, i) => !(intent === 'plan' && /last 7/.test(s))), intent, who };
}
const slim = p => ({ id: p.id, address: p.address, city: p.city, value: p.value, score: p.score, work_type: p.work_type, use_type: p.use_type, issued_date: p.issued_date, contractor: p.contractor, applicant: p.applicant });
async function agentAnswer(raw) {
  const r = agentParse(raw), active = PIPE.filter(x => !['won', 'lost'].includes(x.stage)), warn = PIPE.filter(x => nextStep(x).tone === 'warn');
  const openTasks = TASKS.filter(t => !t.done_at), overdue = openTasks.filter(t => local(t.due_at) < Date.now());
  if (r.intent === 'plan') {
    const t = TODAY || (TODAY = await api('/api/today')), fresh = t.hot.slice(0, Math.max(2, 5 - warn.length));
    return { text: `${overdue.length ? `${plural(overdue.length, 'follow-up')} overdue. ` : ''}${warn.length ? `Start with the ${plural(warn.length, 'saved lead').replace(/^1 /, 'one ')} that ${warn.length === 1 ? 'needs' : 'need'} a nudge${fresh.length ? ', then work the newest hot permits below.' : '.'}` : `Your saved leads are all up to date.${fresh.length ? ' Work the newest hot permits below.' : ''}`}`, leads: [...warn.slice(0, 4), ...fresh].map(slim), acts: [{ label: 'Open Today', act: 'go', v: 'today' }] };
  }
  if (r.intent === 'followups') return openTasks.length || warn.length ? { text: `${plural(overdue.length, 'follow-up')} overdue and ${openTasks.length - overdue.length} still to come.${warn.length ? ` ${plural(warn.length, 'lead')} with no recent contact:` : ''}\n${warn.slice(0, 6).map(x => `• ${addr(x)}: ${nextStep(x).text}`).join('\n')}`.trim(), leads: warn.slice(0, 5).map(slim), acts: [{ label: 'Open Today', act: 'go', v: 'today' }] } : { text: 'Nothing is overdue, and every saved lead has a recent touch or a follow-up booked.' };
  if (r.intent === 'pipeline') {
    if (!PIPE.length) return { text: 'The pipeline is empty. Save a lead and I will keep track of its next step.', acts: [{ label: 'Show hot leads', act: 'agent-apply', f: { ...blankF(), score: 70 } }] };
    const won = PIPE.filter(x => x.stage === 'won').length, lost = PIPE.filter(x => x.stage === 'lost').length, by = s => PIPE.filter(x => x.stage === s).length, big = [...active].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    return { text: `${plural(active.length, 'open lead')}: ${by('new')} new, ${by('contacted')} contacted, ${by('quoted')} quoted. ${won} won and ${lost} lost${won + lost ? `, a ${Math.round(won / (won + lost) * 100)}% win rate` : ''}.${big ? ` The largest open project is ${addr(big)} at ${money(big.value)}.` : ''}${warn.length ? ` ${plural(warn.length, 'lead')} ${warn.length === 1 ? 'needs' : 'need'} attention.` : ''}`, leads: big ? [slim(big)] : [], acts: [{ label: 'Open Pipeline', act: 'go', v: 'pipeline' }] };
  }
  if (r.intent === 'route') {
    const pool = (r.said.length ? await api('/api/permits?' + leadParams(r.F, 40)) : active).filter(p => p.lat != null).slice(0, 8);
    if (pool.length < 2) return { text: 'I need at least two leads with a map location. Save a few, or ask for something like “route hot leads in Surrey”.' };
    U.route = pool.filter(p => km(pool[0], p) < 60).map(p => ({ id: p.id, address: addr(p), city: p.city, lat: p.lat, lng: p.lng })); shortestRoute();
    return { text: `Built a ${U.route.length}-stop route in the shortest order, about ${Math.round(routeLen() * 1.3)} km of driving.`, acts: [{ label: 'Open route', act: 'route-open' }] };
  }
  if (r.intent === 'draft') {
    let p = r.who ? (await api('/api/permits?' + leadParams({ ...blankF(), q: r.who, days: 365 }, 1)))[0] : active.sort((a, b) => b.score - a.score)[0];
    if (!p) return { text: r.who ? `I could not find a recent permit for “${r.who}”.` : 'Tell me who, for example “draft an email to Vanwell Homes”.' };
    return { text: `Ready to write to ${bname(p) || 'the builder'} about ${addr(p)}.${emailsOf(p).length ? '' : ' There is no email on file, so you will need to add the address.'}`, leads: [slim(p)], acts: [{ label: 'Open the draft', act: 'email', id: p.id }] };
  }
  if (r.intent === 'help') return { text: 'Ask in plain words. For example:\n• hot new builds in Surrey over $1M\n• additions this week with a phone number\n• who should I call today\n• what is overdue\n• how is the pipeline\n• route hot leads in Burnaby\n• draft an email to Vanwell Homes\n\nI answer from the permit database and your team’s pipeline. I do not search the web.' };
  const F = r.said.length ? r.F : { ...blankF(), q: (r.who || raw).replace(/[^\w\s&'.-]/g, ' ').trim(), days: 365 };
  if (r.who && r.said.length) F.q = r.who;
  if (!r.said.length && F.q.length < 3) return { text: 'Tell me a city, a kind of work, a value, or a builder. Say “help” for examples.' };
  const rows = await api('/api/permits?' + leadParams(F));
  const what = r.said.length ? r.said.join(', ') + (F.q ? `, matching “${F.q}”` : '') : `matching “${F.q}”`;
  return rows.length ? { text: `${rows.length >= LIMIT ? `More than ${LIMIT} leads` : plural(rows.length, 'lead')} ${what}. Best first.`, leads: rows.slice(0, 5).map(slim), acts: [{ label: `Open ${rows.length >= LIMIT ? 'them' : rows.length === 1 ? 'it' : 'all ' + rows.length} in Leads`, act: 'agent-apply', f: F }] }
    : { text: `Nothing ${what}. Try a wider area or a longer period.` };
}
let agentBusy = false;
async function agentAsk(text) {
  text = String(text || '').trim(); if (!text || agentBusy) return;
  U.chat.push({ me: 1, text }); agentBusy = true; refresh(); scrollChat();
  let a; try { a = await agentAnswer(text); } catch (e) { a = { text: e.message }; }
  agentBusy = false; U.chat.push(a); U.chat = U.chat.slice(-30); saveU(); refresh(); scrollChat();
}
const scrollChat = () => requestAnimationFrame(() => { const el = $('#chat'); if (el) el.scrollTop = el.scrollHeight; });
function renderAgent() {
  const tips = ['Who should I call today?', 'Hot new builds this week', 'Additions over $150K with a phone number', 'What is overdue?', 'How is the pipeline?'];
  return vhead('Lead Agent', 'Ask about permits and your pipeline', U.chat.length ? `<button class="tb" data-act="agent-clear">Clear</button>` : '') + `
    <div class="scroll page chat" id="chat">${U.chat.length ? U.chat.map(m => m.me ? `<div class="msg mine">${esc(m.text)}</div>` : `<div class="msg"><p>${esc(m.text)}</p>${(m.leads || []).length ? `<div class="group">${m.leads.map(miniLead).join('')}</div>` : ''}${(m.acts || []).length ? `<div class="chips">${m.acts.map(a => `<button class="chip tint" data-act="${a.act}" ${a.id ? `data-id="${esc(a.id)}"` : ''} ${a.v ? `data-v="${a.v}"` : ''} ${a.f ? `data-f='${esc(JSON.stringify(a.f))}'` : ''}>${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`).join('') + (agentBusy ? `<div class="msg"><p class="dots"><i></i><i></i><i></i></p></div>` : '')
      : `<div class="empty">${ic('agent')}<h3>What are you looking for?</h3><p>Describe the leads you want, or ask what to do next.</p></div>`}
      <div class="chips ${U.chat.length ? 'line' : 'center'}">${tips.map(s => `<button class="chip" data-act="agent-say" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
    <form class="composer" id="agentform" autocomplete="off"><input id="agentq" placeholder="Ask Lead Agent" aria-label="Ask Lead Agent" enterkeyhint="send"><button type="button" class="ib sm" data-act="dictate" data-for="agentq" aria-label="Dictate">${ic('mic')}</button><button class="ib send" aria-label="Send">${ic('up')}</button></form>`;
}
document.addEventListener('submit', e => { e.preventDefault(); if (e.target.id === 'agentform') { const i = $('#agentq'), v = i.value; i.value = ''; run(agentAsk, v); } if (e.target.id === 'useradd') run(A['user-add']); if (e.target.id === 'pwform') run(A['pw-save']); });
A['agent-say'] = d => agentAsk(d.v);
A['agent-clear'] = () => { U.chat = []; saveU(); refresh(); };
A['agent-apply'] = d => { U.F = { ...blankF(), ...JSON.parse(d.f) }; $('#q').value = U.F.q; go('leads'); run(loadLeads, true); };

/* ---------- Sources ---------- */
let SOURCES = null;
function renderSources() {
  if (!SOURCES) run(async () => { SOURCES = await api('/api/sources'); if (cur === 'sources') refresh(); });
  const all = SOURCES ? [...SOURCES.sources, ...SOURCES.neverLoaded] : [];
  const st = r => r.alerts.length ? `<em class="pill bad">${esc(r.alerts[0].kind.replace('_', ' '))}</em>` : r.run ? (r.run.status === 'ok' ? `<em class="pill good">OK</em>` : `<em class="pill bad">${esc(r.run.status || 'running')}</em>`) : `<em class="pill">History only</em>`;
  return vhead('Data sources', 'One feed per city, refreshed daily', '', 'today') + `<div class="scroll page">${!SOURCES ? `<div class="skel"></div>` : `<div class="group">${all.map(r => `<div class="cell src"><span class="cell-main"><b>${esc(r.city || r.source)}</b><small>${r.total ? `${r.total.toLocaleString()} permits · newest ${dlong(r.newest)} · ${r.week || 0} this week · ${Math.round(100 * (r.with_contractor || 0) / r.total)}% name a builder` : 'No permits loaded yet'}</small>
      ${r.alerts.map(a => `<small class="late">${esc(a.message)}</small>`).join('')}${r.run?.error ? `<small class="late">${esc(r.run.error)}</small>` : ''}</span>${st(r)}</div>`).join('')}</div>
      <p class="foot-note">The ingestion engine runs on the server each morning. This page only reports on it.</p>`}</div>`;
}

/* ---------- Team (admins) ---------- */
let USERS = null, userMsg = '';
function renderTeam() {
  if (!USERS) run(async () => { USERS = await api('/api/users'); if (cur === 'team') refresh(); });
  return vhead('Team', 'Accounts that can sign in', '', 'today') + `<div class="scroll page">
    ${userMsg ? `<div class="group pad notice"><p class="eyebrow">Shown once</p><p class="desc">${esc(userMsg)}</p></div>` : ''}
    <form id="useradd"><div class="group"><label class="cell"><span>Email</span><input name="email" type="email" required placeholder="rep@yourcompany.com"></label><label class="cell"><span>Name</span><input name="name" placeholder="Optional"></label>
      <label class="cell"><span>Role</span><select name="role"><option value="user">Sales rep</option><option value="admin">Admin</option></select></label><button class="cell act">${ic('plus')}Add account</button></div></form>
    ${!USERS ? `<div class="skel"></div>` : `<div class="group">${USERS.map(x => `<div class="cell src"><span class="av">${initials(x.name || x.email)}</span><span class="cell-main"><b>${esc(x.name || x.email)}</b><small>${esc(x.email)} · ${x.role === 'admin' ? 'Admin' : 'Sales rep'} · ${x.disabled ? 'disabled' : x.must_change ? 'temporary password' : x.last_login ? 'last in ' + ago(utc(x.last_login)) : 'never signed in'}</small></span><button class="ib sm" data-act="user-menu" data-u="${x.id}" aria-label="Manage ${esc(x.email)}">${ic('more')}</button></div>`).join('')}</div>`}</div>`;
}
A['user-add'] = async () => { const f = formOf($('#useradd')), j = await api('/api/users', 'POST', f); userMsg = `Account created for ${j.email}. Temporary password to pass on: ${j.temp_password}`; USERS = null; refresh(); };
A['user-menu'] = d => {
  const x = USERS.find(u => String(u.id) === d.u), b = (a, l, cls = 'plain') => `<button class="cell act ${cls}" data-act="user-do" data-u="${x.id}" data-a="${a}" data-close="1">${l}</button>`;
  sheet({ title: x.name || x.email, sub: x.email, cancel: 'Cancel', html: `<div class="group">${b('reset', 'Reset password')}${b(x.disabled ? 'enable' : 'disable', x.disabled ? 'Enable account' : 'Disable account')}${b(x.role === 'admin' ? 'user' : 'admin', x.role === 'admin' ? 'Make a sales rep' : 'Make an admin')}${x.id === ME.id ? '' : `<button class="cell act danger" data-act="user-do" data-u="${x.id}" data-a="remove">Remove account</button>`}</div>` });
};
A['user-do'] = async (d, el) => {
  if (d.a === 'remove') { if (!sure(el, 'Tap again to remove this account')) return; sheetOf(el)?.close(); }
  const a = d.a, j = a === 'remove' ? await api('/api/users/' + d.u, 'DELETE') : await api('/api/users/' + d.u, 'PUT', a === 'reset' ? { reset_password: true } : a === 'admin' || a === 'user' ? { role: a } : { disabled: a === 'disable' });
  userMsg = j.temp_password ? `New temporary password to pass on: ${j.temp_password}` : ''; USERS = null; refresh(); if (!j.temp_password) toast('Updated');
};

/* ---------- Settings ---------- */
A.settings = () => sheet({
  title: 'Settings', tall: true, onClose: () => { saveU(); refresh(); },
  html: `<div class="bhead"><span class="av lg">${esc(initials(ME.name || ME.email))}</span><h1>${esc(ME.name || 'Your account')}</h1><p class="sub">${esc(ME.email)} · ${ME.role === 'admin' ? 'Admin' : 'Sales rep'}</p></div>
    <h2>On your quotes and emails</h2><div class="group"><label class="cell"><span>Yard name</span><input data-on="yard" data-k="name" value="${esc(U.yard.name)}" placeholder="Your company"></label><label class="cell"><span>Your phone</span><input type="tel" data-on="yard" data-k="phone" value="${esc(U.yard.phone)}" placeholder="604-555-0100"></label><label class="cell"><span>Tax on quotes, %</span><input type="number" inputmode="decimal" min="0" step="any" data-on="yard" data-k="tax" value="${U.yard.tax}"></label></div>
    <p class="foot-note">Kept on this device. 12% is GST plus PST in BC.</p>
    <div class="group"><button class="cell nav" data-act="templates"><span class="cell-main"><b>Email templates</b></span>${ic('chev')}</button><button class="cell nav" data-act="go" data-v="sources" data-close="1"><span class="cell-main"><b>Data sources</b></span>${META?.alerts ? `<em class="pill bad">${META.alerts}</em>` : ''}${ic('chev')}</button>${ME.role === 'admin' ? `<button class="cell nav" data-act="go" data-v="team" data-close="1"><span class="cell-main"><b>Team</b></span>${ic('chev')}</button>` : ''}</div>
    <div class="group"><button class="cell act plain" data-act="pw">Change password</button><button class="cell act danger" data-act="signout">Sign out</button></div>`
});
I.yard = el => { U.yard[el.dataset.k] = el.type === 'number' ? +el.value : el.value; saveU(); };
A.templates = () => sheet({ title: 'Email templates', render: () => `<div class="group">${U.tpl.map(t => `<button class="cell nav" data-act="tpl" data-t="${t.id}"><span class="cell-main"><b>${esc(t.name)}</b><small>${esc(t.subject)}</small></span>${ic('chev')}</button>`).join('')}<button class="cell act" data-act="tpl" data-t="">${ic('plus')}New template</button></div><p class="foot-note">Templates are kept on this device.</p>` });
A.tpl = d => {
  const t = U.tpl.find(x => x.id === d.t) || { id: '', name: '', subject: '', body: '' };
  sheet({ title: t.id ? 'Edit template' : 'New template', tall: true, cancel: 'Cancel', action: `<button class="tb strong" data-act="tpl-save" data-t="${t.id}">Save</button>`,
    html: `<div id="tplform"><div class="group"><label class="cell"><span>Name</span><input name="name" value="${esc(t.name)}"></label><label class="cell"><span>Subject</span><input name="subject" value="${esc(t.subject)}"></label></div><div class="group ta"><textarea name="body" rows="12" aria-label="Message">${esc(t.body)}</textarea></div>
      <p class="foot-note">Filled in for you: {{first}} {{builder}} {{address}} {{city}} {{me}} {{yard}} {{phone}}</p>${t.id && U.tpl.length > 1 ? `<div class="group"><button class="cell act danger" data-act="tpl-del" data-t="${t.id}">Delete template</button></div>` : ''}</div>` });
};
A['tpl-save'] = (d, el) => { const sh = sheetOf(el), f = formOf($('#tplform', sh.el)); if (!f.name) return $('[name=name]', sh.el).focus(); const t = U.tpl.find(x => x.id === d.t); t ? Object.assign(t, f) : U.tpl.push({ id: 't' + Date.now(), ...f }); saveU(); sh.close(); for (const s of sheets) s.update(); };
A['tpl-del'] = (d, el) => { U.tpl = U.tpl.filter(x => x.id !== d.t); saveU(); sheetOf(el).close(); for (const s of sheets) s.update(); };
A.signout = async () => { await api('/auth/logout', 'POST', {}); location.href = '/login'; };
function askPassword(forced) {
  if ($('#pwform')) return;
  sheet({ title: forced ? 'Set your own password' : 'Change password', locked: !!forced, cancel: forced ? '' : 'Cancel',
    html: `<form id="pwform">${forced ? `<p class="foot-note top">You signed in with a temporary password. Choose your own to continue.</p>` : ''}<div class="group"><label class="cell"><span>Current</span><input name="current" type="password" autocomplete="current-password" required autofocus></label><label class="cell"><span>New</span><input name="next" type="password" autocomplete="new-password" minlength="10" required placeholder="10 characters or more"></label></div>
      <p class="foot-note late" id="pwerr" role="alert"></p><button class="btn wide">Save password</button><p class="foot-note">You will be asked to sign in again.</p></form>` });
}
A.pw = () => askPassword(false);
A['pw-save'] = async () => { try { await api('/auth/password', 'POST', formOf($('#pwform'))); location.href = '/login'; } catch (e) { $('#pwerr').textContent = e.message; } };
