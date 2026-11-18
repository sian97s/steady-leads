'use strict';
/* The leads map.
   A lead on its own is a pill showing its value, with a dot for how hot it is. Leads that would overlap become one
   count bubble, which splits apart as you zoom in. Markers are plain elements, so they animate, follow dark mode,
   and can be highlighted from the list. */
let markers = new Map(), clusters = [], clusterZoom = null, extraId = null, autoMove = 0, pendingFit = false, areaDirty = false, cardId = null, hlId = null;
const CELL_X = 60, CELL_Y = 34;                       // px: a pill is about this big, so closer leads share a bubble
const HOVER = matchMedia('(hover: hover)').matches;
const WORK_SHORT = { new: 'New', addition: 'Addn', alteration: 'Alt', demolition: 'Demo', repair: 'Repair' };

function initMap() {
  if (map || !window.L) return;
  const v = U.mapView && U.mapView.z >= 6 ? U.mapView : null;
  map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 19, wheelPxPerZoomLevel: 90, wheelDebounceTime: 30 }).setView(v ? v.c : [49.2, -122.9], v ? v.z : 10);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', maxZoom: 19, keepBuffer: 4 }).addTo(map);
  dotLayer = L.layerGroup().addTo(map); routeLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => {
    if (!map.getSize().x) return;
    const c = map.getCenter(); U.mapView = { c: [c.lat, c.lng], z: map.getZoom() }; saveU();
    if (autoMove) autoMove = 0; else if (leadsLoaded) areaDirty = true;     // only a move the rep made offers "Search this area"
    renderMarkers(); mapChrome();
  });
  map.on('click', hideCard);
  // The map can be hidden (phone list mode) when results arrive. Fit it the first time it actually has a size.
  if (window.ResizeObserver) new ResizeObserver(() => { map.invalidateSize({ animate: false }); if (map.getSize().x) { if (pendingFit) { pendingFit = false; fitLeads(); } else renderMarkers(); } }).observe($('#map'));
}
const auto = fn => { autoMove = 1; fn(); setTimeout(() => { autoMove = 0; }, 1500); };

/* ---- grouping ---- */
function buildClusters() {
  const z = map.getZoom(), grid = new Map(), pts = LEADS.filter(p => p.lat != null && p.lng != null);
  if (extraId && leadData && leadData.id === extraId) pts.unshift(leadData);
  clusterZoom = z; clusters = [];
  for (const p of pts) {                              // results arrive best-first, so the best lead anchors each group
    const pt = map.project([p.lat, p.lng], z), gx = Math.floor(pt.x / CELL_X), gy = Math.floor(pt.y / CELL_Y);
    let hit = null;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++)
      for (const c of grid.get((gx + dx) + ':' + (gy + dy)) || []) if (Math.abs(c.x - pt.x) < CELL_X && Math.abs(c.y - pt.y) < CELL_Y) { hit = c; break; }
    if (hit) hit.items.push(p);
    else { const c = { x: pt.x, y: pt.y, items: [p] }, k = gx + ':' + gy; clusters.push(c); grid.has(k) ? grid.get(k).push(c) : grid.set(k, [c]); }
  }
  for (const c of clusters) {
    const n = c.items.length;
    c.lat = c.items.reduce((s, p) => s + p.lat, 0) / n; c.lng = c.items.reduce((s, p) => s + p.lng, 0) / n;
    c.key = n === 1 ? 'p:' + c.items[0].id : `c:${z}:${c.items[0].id}:${n}`;
  }
}
const pillHTML = p => `<div class="pillm ${tierOf(p.score)}"><i></i>${p.value ? money(p.value) : WORK_SHORT[p.work_type] || 'Lead'}</div>`;
const bubbleHTML = c => { const n = c.items.length; return `<div class="bub${c.items.some(p => p.score >= 70) ? ' hot' : ''}" style="--s:${Math.round(32 + Math.min(20, Math.sqrt(n) * 3.2))}px">${n}</div>`; };
function tipHTML(c) {
  if (c.items.length === 1) { const p = c.items[0], b = bname(p); return `<b>${esc(addr(p))}</b>${b ? `<br>${esc(b)}` : ''}<br><span>${p.value ? money(p.value) + ' · ' : ''}${esc(workLabel(p))} · ${issuedAgo(p)}</span>`; }
  const hot = c.items.filter(p => p.score >= 70).length, top = Math.max(...c.items.map(p => p.value || 0));
  return `<b>${plural(c.items.length, 'lead')}</b><br><span>${hot ? `${hot} hot · ` : ''}${top ? 'up to ' + money(top) : 'click to zoom in'}</span>`;
}
function addMarker(c) {
  const single = c.items.length === 1, p = c.items[0];
  const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'mk', html: single ? pillHTML(p) : bubbleHTML(c), iconSize: [0, 0] }), keyboard: false, riseOnHover: true, zIndexOffset: single ? p.score * 4 : 500 + c.items.length });
  m._c = c;
  m.on('click', () => { const g = m._c; g.items.length === 1 ? pickLead(g.items[0]) : openCluster(g); });
  if (HOVER) {
    m.bindTooltip(() => tipHTML(m._c), { direction: 'top', offset: [0, -16], className: 'tip', opacity: 1 });
    m.on('mouseover', () => { if (m._c.items.length === 1) $(`.lead[data-id="${CSS.escape(m._c.items[0].id)}"]`)?.classList.add('hl'); });
    m.on('mouseout', () => $$('.lead.hl').forEach(l => l.classList.remove('hl')));
  }
  return m.addTo(dotLayer);
}
function renderMarkers() {
  if (!map || !map.getSize().x) return;
  if (clusterZoom !== map.getZoom()) buildClusters();
  const b = map.getBounds().pad(.35), want = new Map();
  for (const c of clusters) if (b.contains([c.lat, c.lng])) want.set(c.key, c);
  for (const [k, m] of markers) if (!want.has(k)) {
    markers.delete(k); const el = m.getElement()?.firstElementChild;
    if (el) { el.classList.add('out'); setTimeout(() => dotLayer.removeLayer(m), 150); } else dotLayer.removeLayer(m);
  }
  for (const [k, c] of want) markers.has(k) ? (markers.get(k)._c = c) : markers.set(k, addMarker(c));
  syncMarkers();
}
// Selected, saved, on-route and hovered states. Cheap, so it runs after every change.
function syncMarkers() {
  const sel = leadId || cardId;
  for (const m of markers.values()) {
    const el = m.getElement()?.firstElementChild; if (!el) continue;
    const it = m._c.items, one = it.length === 1 ? it[0] : null, has = id => !!id && it.some(p => p.id === id);
    el.classList.toggle('sel', has(sel)); el.classList.toggle('hl', has(hlId));
    if (one) { const st = stageOf(one.id) || one.stage || ''; el.className = `pillm ${st ? 'own s-' + st : tierOf(one.score)}${el.classList.contains('out') ? ' out' : ''}`; el.classList.toggle('stop', inRoute(one.id)); }
    el.classList.toggle('sel', has(sel)); el.classList.toggle('hl', has(hlId));
    m.setZIndexOffset(has(sel) ? 5000 : has(hlId) ? 4000 : one ? one.score * 4 : 500 + it.length);
  }
}
// Called when the results change.
function drawMap() {
  initMap(); if (!map) return;
  clusterZoom = null; areaDirty = false; hideCard();
  renderMarkers(); drawOverlay(); mapChrome();
}
// Route line and numbered stops, plus marker states: follows every change.
function drawOverlay() {
  if (!map) { initMap(); if (!map) return; }
  routeLayer.clearLayers();
  if (U.route.length > 1) L.polyline(U.route.map(s => [s.lat, s.lng]), { color: cssVar('--tint'), weight: 4, opacity: .85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
  for (const [i, s] of U.route.entries()) L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'mk', html: `<div class="stopn onmap">${i + 1}</div>`, iconSize: [0, 0] }), interactive: false, zIndexOffset: 6000 }).addTo(routeLayer);
  markSelected();
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// A lead opened from another screen may not be among the results; give it a pill of its own so it can still be seen.
function markSelected() {
  if (!map) return;
  const need = leadData && leadData.lat != null && !LEADS.some(p => p.id === leadData.id) ? leadData.id : null;
  if (need !== extraId) { extraId = need; clusterZoom = null; renderMarkers(); } else syncMarkers();
}
function mapChrome() {
  const located = LEADS.reduce((n, p) => n + (p.lat != null), 0), lg = $('#maplegend'), ab = $('#areabtn');
  lg.hidden = !leadsLoaded;
  lg.innerHTML = `<span><i class="hot"></i>Hot</span><span><i class="warm"></i>Warm</span><span><i class="cool"></i>Low</span><span><i class="own"></i>In pipeline</span>${leadsLoaded && located < LEADS.length ? `<em>${located.toLocaleString()} of ${LEADS.length.toLocaleString()} on the map</em>` : ''}`;
  ab.hidden = !areaDirty; ab.innerHTML = ic('search') + 'Search this area';
}

/* ---- interaction ---- */
function pickLead(p) { if (innerWidth < 700) showCard(p); else A.lead({ id: p.id }); }
function openCluster(c) {
  const lats = c.items.map(p => p.lat), lngs = c.items.map(p => p.lng), tight = Math.max(...lats) - Math.min(...lats) < 2e-4 && Math.max(...lngs) - Math.min(...lngs) < 3e-4;
  if (tight || map.getZoom() >= 18)                    // same building or block: zooming cannot separate them, so list them
    return sheet({ title: plural(c.items.length, 'lead') + ' here', html: `<div class="group">${c.items.map(miniLead).join('')}</div>` });
  auto(() => map.flyToBounds(L.latLngBounds(c.items.map(p => [p.lat, p.lng])).pad(.4), { duration: .5, maxZoom: 18 }));
}
// Phones: tapping a pill shows a preview card over the map; tapping the card opens the lead.
function showCard(p) {
  cardId = p.id; const el = $('#mapcard'), b = bname(p), st = stageOf(p.id) || p.stage;
  el.innerHTML = `<button class="mc-main" data-act="lead" data-id="${esc(p.id)}">${scOf(p)}<span class="lead-main"><span class="l1"><b>${esc(addr(p))}</b><i>${money(p.value)}</i></span>
    <span class="l2">${esc(p.city || '')} · ${esc(workLabel(p))} · ${issuedAgo(p)}</span><span class="l3"><span class="nm">${b ? esc(b) : 'No builder named'}</span>${st ? `<em class="st ${st}">${STAGE_LABEL[st]}</em>` : ''}</span></span>${ic('chev')}</button>
    <button class="ib sm" data-act="card-close" aria-label="Close preview">${ic('x')}</button>`;
  el.hidden = false; syncMarkers();
  auto(() => map.panInside([p.lat, p.lng], { paddingTopLeft: [40, 60], paddingBottomRight: [40, 150] }));
}
function hideCard() { if (!cardId) return; cardId = null; $('#mapcard').hidden = true; syncMarkers(); }
A['card-close'] = hideCard;
// Bring the open lead into the part of the map the side panel does not cover.
function focusLeadOnMap() {
  markSelected();
  if (!map || !leadData || leadData.lat == null || cur !== 'leads' || !map.getSize().x || innerWidth < 700) return;
  const ll = L.latLng(leadData.lat, leadData.lng), panel = 448, z = Math.max(map.getZoom(), 14);
  if (map.getZoom() >= 13 && map.getBounds().contains(ll))
    return auto(() => map.panInside(ll, { paddingTopLeft: [70, 90], paddingBottomRight: [panel + 70, 90] }));
  const centre = map.unproject(map.project(ll, z).add([panel / 2, 0]), z);   // offset so the pill lands left of the panel
  auto(() => map.flyTo(centre, z, { duration: .65 }));
}
function fitLeads() {
  if (!map) return;
  if (!map.getSize().x) { pendingFit = true; return; }
  const pts = LEADS.filter(p => p.lat != null).map(p => [p.lat, p.lng]);
  if (pts.length) auto(() => map.fitBounds(L.latLngBounds(pts).pad(.08), { maxZoom: 15, animate: false }));
}
A['fit-leads'] = () => { const pts = LEADS.filter(p => p.lat != null).map(p => [p.lat, p.lng]); if (pts.length) auto(() => map.flyToBounds(L.latLngBounds(pts).pad(.08), { maxZoom: 15, duration: .6 })); };
A.zoom = d => map && (+d.d > 0 ? map.zoomIn() : map.zoomOut());
A['area-search'] = () => { const b = map.getBounds(); U.F.area = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => +n.toFixed(5)); areaDirty = false; mapChrome(); return loadLeads(false); };
A.locate = () => {
  if (!navigator.geolocation) return toast('Location is not available on this device');
  navigator.geolocation.getCurrentPosition(pos => {
    mePos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (meDot) map.removeLayer(meDot);
    meDot = L.marker([mePos.lat, mePos.lng], { icon: L.divIcon({ className: 'mk', html: '<div class="medot"></div>', iconSize: [0, 0] }), interactive: false, zIndexOffset: 7000 }).addTo(map);
    map.flyTo([mePos.lat, mePos.lng], Math.max(map.getZoom(), 13), { duration: .6 });
  }, () => toast('Could not get your location. Check the browser permission.'), { timeout: 8000 });
};
// Hovering a row in the list lights up its pill (or the bubble it is in), so the two read as one thing.
if (HOVER) {
  $('#list').addEventListener('mouseover', e => { const id = e.target.closest('.lead')?.dataset.id || null; if (id !== hlId) { hlId = id; syncMarkers(); } });
  $('#list').addEventListener('mouseleave', () => { if (hlId) { hlId = null; syncMarkers(); } });
}
$('#mapfit').innerHTML = ic('fit'); $('#zin').innerHTML = ic('plus'); $('#zout').innerHTML = ic('minus');
