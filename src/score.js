// Lead score 0-100 for a building-supply seller.
// Weights: project value, type of work, freshness, and whether we can reach someone.
// work_type / use_type are the engine's canonical values (new, addition, alteration, demolition...).
// parts() is the breakdown the app shows on a lead; score() is their sum. Keep the two in step by editing only parts().
const money = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : '$' + Math.round(v / 1e3) + 'K';
function parts(p) {
  const out = [], v = p.value || 0;
  const vp = v >= 5e6 ? 35 : v >= 1e6 ? 30 : v >= 500e3 ? 24 : v >= 150e3 ? 16 : v >= 50e3 ? 8 : 2;
  out.push({ key: 'value', label: 'Project value', pts: vp, max: 35, why: p.value ? `${money(v)} declared on the permit.` : 'No value on the permit.' });

  const w = p.work_type || '';
  const wp = w === 'new' ? 30 : (w === 'addition' || w === 'alteration') ? 18 : w === 'demolition' ? 14 : 0;
  out.push({ key: 'work', label: 'Type of work', pts: wp, max: 30,
    why: w === 'new' ? 'New build: a full material package.' : w === 'addition' ? 'Addition: a framing and finishing order.'
      : w === 'alteration' ? 'Alteration: smaller, faster orders.' : w === 'demolition' ? 'Demolition: a new build usually follows.' : 'Little material in this kind of permit.' });

  let fp = 0, fw = 'No issue date on the permit.';
  if (p.issued_date) {
    const days = (Date.now() - new Date(p.issued_date)) / 864e5;
    fp = days <= 14 ? 20 : days <= 45 ? 14 : days <= 120 ? 7 : 0;
    fw = days <= 14 ? 'Issued in the last two weeks.' : days <= 45 ? 'Issued in the last six weeks.' : days <= 120 ? 'Issued in the last four months.' : 'Issued more than four months ago.';
  }
  out.push({ key: 'fresh', label: 'Freshness', pts: fp, max: 20, why: fw });

  out.push({ key: 'reach', label: 'Someone to call', pts: p.contractor ? 10 : p.applicant ? 5 : 0, max: 10,
    why: p.contractor ? 'The permit names the builder.' : p.applicant ? 'Only an applicant is named.' : 'No builder or applicant named.' });

  const res = p.use_type === 'residential' || p.use_type === 'mixed';
  out.push({ key: 'use', label: 'Wood-frame fit', pts: res ? 5 : 0, max: 5, why: res ? 'Residential or mixed use.' : 'Not residential.' });
  return out;
}
function score(p) {
  let s = parts(p).reduce((t, x) => t + x.pts, 0);
  if (p.kind === 'trade') s = Math.min(s, 15);                // electrical/plumbing/sign permits are not leads
  return Math.max(0, Math.min(100, Math.round(s)));
}

module.exports = { score, parts };
