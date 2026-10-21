'use strict';
(() => {
  if (window.WildfireGuidedDemo) return;
  const $ = id => document.getElementById(id);
  const labels = ['เลือกจุดไฟ', 'ทดลองไฟลาม', 'ดูการตรวจจับ', 'วางแผนเดินทาง'];
  const roleNames = { EX: 'Existing Sensors', RS: 'Reference / Super Station', FU: 'Fusion Node', RW: 'Ridge / Saddle Weather', VW: 'Valley Wind', BW: 'Boundary Weather', AQ: 'AQ / Smoke' };
  const weatherRoles = new Set(['RS', 'FU', 'RW', 'VW', 'BW']);
  const guide = { active: false, step: 1, summary: false, returnHash: '#operational-3d', targetMessage: '' };
  const text = (id, value) => { const element = $(id); if (element) element.textContent = value; };
  const bind = (id, handler) => $(id)?.addEventListener('click', handler);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const format = (value, digits = 1) => finite(value) ? value.toLocaleString('th-TH', { maximumFractionDigits: digits }) : '—';
  const coord = value => value && finite(value.lat) && finite(value.lon) ? value.lat.toFixed(6) + ', ' + value.lon.toFixed(6) : null;
  const readSnapshot = (api, empty) => { try { return api?.getSnapshot?.() || empty; } catch (_) { return empty; } };
  const simulation = () => readSnapshot(window.WildfireSimulation, { scenario: null, frame: null, minute: 0, playing: false, busy: false, status: {} });
  const operational = () => readSnapshot(window.WildfireOperationalMap, { ready: false, target: null, currentRoute: null, routeStatus: {}, routingAvailable: false });
  const detections = sim => (Array.isArray(sim.scenario?.events) ? sim.scenario.events : [])
    .filter(event => event.type === 'smoke-detection' && finite(event.minute))
    .slice().sort((a, b) => a.minute - b.minute || String(a.sensorId).localeCompare(String(b.sensorId)));
  function parseHash(hash) {
    const match = /^#guide-step-([1-4])$/.exec(hash);
    return match ? { step: Number(match[1]), summary: false } : hash === '#guide-summary' ? { step: 4, summary: true } : null;
  }
  const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function stickyHeight() { return guide.active ? Math.ceil($('guided-progress')?.getBoundingClientRect?.().height || 0) : 0; }
  function updateStickyHeight() {
    document.documentElement.style.setProperty('--guide-sticky-height', stickyHeight() + 'px');
  }
  function scrollTo(element, focus = true) {
    if (!element) return;
    updateStickyHeight();
    element.style.scrollMarginTop = (stickyHeight() + 16) + 'px';
    // scrollIntoView also scrolls the operational sidebar when the card is nested there.
    element.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start', inline: 'nearest' });
    if (focus) {
      const heading = element.querySelector?.('h2, h3, h4') || element;
      heading.setAttribute('tabindex', '-1');
      heading.focus?.({ preventScroll: true });
    }
  }
  function stepTarget(sim = simulation()) {
    if (guide.summary) return $('guide-summary');
    if (guide.step === 1) return $('guide-fire-target');
    if (guide.step === 2) return $('fire-simulation');
    if (guide.step === 3) return sim.scenario && !$('sim-results')?.hidden ? $('sim-results') : $('guide-detection-empty');
    return $('guide-access-target');
  }
  function paintNavigation() {
    const sim = simulation();
    const workspace = window.WildfireWorkspace;
    document.body?.classList.toggle('guide-active', guide.active);
    if ($('guided-progress')) $('guided-progress').hidden = !guide.active && !workspace;
    if ($('guide-summary')) $('guide-summary').hidden = !guide.active || !guide.summary;
    for (let step = 1; step <= 4; step++) {
      const card = $('guide-card-' + step), section = step === 1 ? $('guide-fire-target') : step === 2 ? $('fire-simulation') : step === 3 ? $('sim-results') : $('guide-access-target');
      const active = (guide.active || !!workspace) && !guide.summary && guide.step === step;
      if (card) { card.hidden = !active; card.classList.toggle('guide-active', active); }
      section?.classList.toggle('guided-highlight', active && (step !== 3 || !!sim.scenario));
    }
    const missing = (guide.active || !!workspace) && !guide.summary && guide.step === 3 && !sim.scenario;
    if ($('guide-detection-empty')) {
      $('guide-detection-empty').hidden = !missing;
      $('guide-detection-empty').classList.toggle('guided-highlight', missing);
    }
    document.querySelectorAll('[data-guide-step]').forEach(button => {
      const active = (guide.active || !!workspace) && !guide.summary && Number(button.dataset.guideStep) === guide.step;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'step' : 'false');
    });
    text('guide-progress-label', guide.summary ? 'สรุปการสาธิต · ข้อมูลจากฉากปัจจุบัน' : 'ขั้น ' + guide.step + '/4 · ' + labels[guide.step - 1]);
    if ($('guide-back')) $('guide-back').disabled = !guide.summary && guide.step === 1;
    text('guide-next', guide.summary ? 'เริ่มคำแนะนำใหม่' : guide.step === 4 ? 'ดูสรุป' : 'ถัดไป');
    if (workspace) {
      const op = operational(), button = $('guide-next');
      const routeBusy = op.routeStatus?.state === 'loading';
      text('guide-next', guide.summary ? 'กลับไปเลือกจุดไฟ' : guide.step === 1 ? 'ใช้จุดนี้ → จำลอง' : guide.step === 2 ? (sim.busy ? 'กำลังคำนวณ…' : sim.scenario ? 'ดูการตรวจจับ →' : 'เริ่มจำลองไฟลาม') : guide.step === 3 ? 'วางแผนเข้าถึงพื้นที่ →' : routeBusy ? 'กำลังคำนวณเส้นทาง…' : op.currentRoute ? 'ดูสรุปผล →' : !op.routingAvailable ? 'ข้อมูลเส้นทางยังไม่พร้อม' : 'คำนวณเส้นทาง');
      if (button) button.disabled = !guide.summary && ((guide.step === 1 && !coord(op.target)) || (guide.step === 2 && (sim.busy || (!sim.scenario && !op.ready))) || (guide.step === 4 && (routeBusy || (!op.currentRoute && !op.routingAvailable))));
      text('guide-back', '← ย้อนกลับ');
      $('guide-skip').hidden = !guide.active;
      text('guide-restart', guide.active ? 'เริ่มคำแนะนำใหม่' : 'เริ่ม Demo');
      workspace.render(guide, sim, op);
    }
    if ($('guide-show-spread')) $('guide-show-spread').disabled = !sim.scenario;
    if ($('guide-show-route')) $('guide-show-route').disabled = !operational().currentRoute;
    updateStickyHeight();
  }
  function changeView(step, summary = false, writeHistory = true, scroll = true) {
    if (!guide.active && !parseHash(window.location.hash)) guide.returnHash = window.location.hash || '#operational-3d';
    guide.active = true; guide.step = Math.max(1, Math.min(4, step)); guide.summary = summary;
    const hash = summary ? '#guide-summary' : '#guide-step-' + guide.step;
    if (writeHistory && window.location.hash !== hash) window.history.pushState(null, '', hash);
    refresh();
    if (window.WildfireWorkspace) window.WildfireWorkspace.focusStep();
    else if (scroll) scrollTo(stepTarget());
  }
  function exit(writeHistory = true) {
    guide.active = false; guide.summary = false;
    if (writeHistory && parseHash(window.location.hash)) window.history.pushState(null, '', guide.returnHash);
    refresh();
    if (window.WildfireWorkspace) window.WildfireWorkspace.scrollToMap();
    else scrollTo($('operational-3d-map'), false);
  }
  function followHash() {
    const parsed = parseHash(window.location.hash);
    if (parsed) {
      if (!guide.active || guide.step !== parsed.step || guide.summary !== parsed.summary) changeView(parsed.step, parsed.summary, false);
    } else {
      guide.returnHash = window.location.hash || '#operational-3d';
      if (guide.active) { guide.active = false; guide.summary = false; refresh(); }
    }
  }
  function detectionText(event) {
    const signals = event.signals || {}, values = [];
    if (finite(signals.pm25UgM3)) values.push('PM2.5 ' + format(signals.pm25UgM3) + ' µg/m³');
    if (finite(signals.coPpm)) values.push('CO ' + format(signals.coPpm, 2) + ' ppm');
    if (weatherRoles.has(event.roleCode) && finite(signals.windSpeedMs)) {
      const direction = finite(signals.windFromDeg) && finite(signals.windToDeg) ? Math.round(signals.windFromDeg) + '° → ' + Math.round(signals.windToDeg) + '° · ' : '';
      values.push('ลมจำลอง ' + direction + format(signals.windSpeedMs) + ' m/s');
    }
    if (event.capabilityAssumed) values.push('Existing Sensor: สมมติการรองรับ PM สำหรับเดโม');
    return values.length ? values.join(' · ') : 'ไม่มีค่ารายช่องในผลฉากนี้';
  }
  function renderDetections(sim) {
    const container = $('guide-detection-summary'); if (!container) return;
    container.replaceChildren();
    const all = detections(sim);
    let message, state;
    if (sim.busy) { message = sim.status?.message || 'กำลังคำนวณฉาก · ยังไม่มีผลการตรวจจับ'; state = 'loading'; }
    else if (!sim.scenario) { message = sim.status?.state === 'error' ? sim.status.message : (sim.status?.message ? sim.status.message + ' · ' : '') + 'ยังไม่มีฉากไฟลาม · ไปขั้น 2 แล้วกดทดลองเพื่อดูการตรวจจับจริงจากผลฉาก'; state = sim.status?.state === 'error' ? 'error' : 'empty'; }
    else if (!all.length) { message = 'ฉากนี้ไม่มีสถานีพบสัญญาณควันจำลองภายใน 120 นาที · อาจเป็นช่องว่างการตรวจจับหรือลมพัดออกจากเครือข่าย · การไม่มีสัญญาณไม่ยืนยันว่าพื้นที่ไม่มีไฟ'; state = 'no-detection'; }
    else { const seen = all.filter(event => event.minute <= sim.minute).length; message = 'T+' + sim.minute + ' นาที · พบแล้ว ' + seen + ' / ' + all.length + ' สถานีในฉาก · แสดงผลคาดพบสูงสุด 3 รายการแรก (ข้อมูลจำลอง)'; state = 'ready'; }
    text('guide-detection-state', message);
    if ($('guide-detection-state')) $('guide-detection-state').dataset.state = state;
    const placeholder = $('guide-detection-empty');
    if (placeholder && !sim.scenario) {
      placeholder.dataset.state = state;
      const explanation = placeholder.querySelector('p');
      if (explanation) explanation.textContent = message + (sim.busy ? '' : ' · กลับไปขั้น 2 เพื่อทดลองฉาก');
    }
    if (!sim.scenario || sim.busy) return;
    for (const event of all.slice(0, 3)) {
      const card = document.createElement('article'); card.className = 'guide-detection-item'; card.dataset.sensorId = String(event.sensorId || '');
      card.dataset.roleCode = event.roleCode || '';
      const title = document.createElement('strong'); title.textContent = String(event.sensorId || 'สถานี') + ' · T+' + event.minute + ' นาที';
      const role = document.createElement('p'); role.className = 'guide-detection-role'; role.textContent = roleNames[event.roleCode] || event.roleCode || 'ไม่ระบุประเภทสถานี';
      const stage = document.createElement('small'); stage.textContent = event.minute <= sim.minute ? 'ถึงเวลาตรวจจับในฉากแล้ว · จำลอง' : 'ผลคาดพบในฉาก · ยังไม่ถึงเวลานี้';
      const detail = document.createElement('p'); detail.textContent = detectionText(event);
      card.append(title, role, stage, detail); container.append(card);
    }
  }
  function renderRoute(op) {
    const container = $('guide-route-summary'), status = op.routeStatus || {}, route = op.currentRoute;
    if (!container) return;
    container.replaceChildren();
    const unavailable = window.WildfireWorkspace && !route && !op.routingAvailable && status.state !== 'error';
    const message = unavailable ? 'ข้อมูลถนน/ทางเดินสำหรับรูปแบบนี้ยังไม่พร้อม · ลองเลือกรูปแบบการเดินทางอื่น หรือรอข้อมูล OSM พร้อมก่อนคำนวณ' : status.message || (!op.ready ? 'แผนที่กำลังเตรียมข้อมูล' : !op.routingAvailable ? 'ยังไม่มี OSM graph ที่ใช้คำนวณเส้นทางได้' : route ? 'แสดงเส้นทางที่คำนวณแล้วจากข้อมูลปัจจุบัน' : 'ยังไม่ได้คำนวณเส้นทาง · เลือกจุดเริ่มและรูปแบบการเดินทางแล้วกดคำนวณ');
    text('guide-route-state', message);
    if ($('guide-route-state')) $('guide-route-state').dataset.state = status.state || (route ? 'ready' : 'empty');
    if (!route) return;
    const add = value => { const row = document.createElement('p'); row.textContent = value; container.append(row); };
    add('เส้นทาง ' + (status.profile || route.profile || '—') + ' · ระยะ ' + (status.distance || '—') + ' · เข้า ' + (status.time || '—') + ' · ออก ' + (status.egressTime || '—'));
    add('ความสูงสะสม ' + (status.elevationGain || '—') + ' · grade สูงสุด ' + (status.maxGrade || '—'));
    const journey = route.journey;
    if (journey) {
      if (journey.profile !== 'foot' && finite(journey.driveKm)) add('ขับรถ ' + format(journey.driveKm) + ' กม.' + (finite(journey.driveMin) ? ' · ' + Math.round(journey.driveMin) + ' นาที' : ''));
      if (finite(journey.walkKm)) add('เดินเท้า ' + format(journey.walkKm) + ' กม.' + (finite(journey.walkMin) ? ' · ' + Math.round(journey.walkMin) + ' นาที' : ''));
      if (finite(journey.mappedWalkKm)) add('เดินตามทาง OSM ' + format(journey.mappedWalkKm) + ' กม.' + (finite(journey.mappedWalkMin) ? ' · ' + Math.round(journey.mappedWalkMin) + ' นาที' : ''));
      if (journey.profile !== 'foot' && Array.isArray(journey.handoff) && journey.handoff.length >= 2 && journey.handoff.every(finite)) add('จุดลงเดิน (Latitude, Longitude) ' + journey.handoff[0].toFixed(6) + ', ' + journey.handoff[1].toFixed(6));
    }
    add('ช่วงนอกทาง ' + (status.offroadDistance || '—') + ' · เส้นเชื่อมประมาณ ต้องตรวจสอบภาคสนาม');
  }
  function renderSummary(sim, op) {
    const container = $('guide-summary-values'); if (!container) return;
    container.replaceChildren();
    const add = (name, value, note) => {
      const item = document.createElement('div'); item.className = 'guide-summary-item';
      const label = document.createElement('span'), actual = document.createElement('strong'); label.textContent = name; actual.textContent = value;
      item.append(label, actual);
      if (note) { const small = document.createElement('small'); small.textContent = note; item.append(small); }
      container.append(item);
    };
    const target = op.target;
    add('จุดไฟที่เลือก', coord(target) ? (target.id ? target.id + ' · ' : '') + coord(target) : 'ยังไม่มีพิกัดที่เลือก', 'Latitude, Longitude · การนำทางในคำแนะนำไม่เปลี่ยนจุดนี้');
    const scene = sim.scenario;
    add('ฉากไฟลาม', sim.busy ? 'กำลังคำนวณ' : scene ? 'T+' + sim.minute + ' นาที · ' + (sim.playing ? 'กำลังเล่น' : 'พัก / ดูตามเวลา') : 'ยังไม่มีผลฉาก', scene ? String(scene.members || '—') + ' ฉาก · สัดส่วนที่ลามถึงแบบมีเงื่อนไข ไม่ใช่โอกาสเกิดไฟ' : sim.status?.message || 'กดทดลองเองในขั้น 2');
    if (scene && finite(sim.frame?.areaHa)) add('พื้นที่ฉากตัวอย่าง', format(sim.frame.areaHa) + ' เฮกตาร์', 'พื้นที่ representative scene ณ เวลาที่เลือก · จำลอง');
    if (scene && finite(sim.frame?.windSpeedMs)) {
      const from = finite(sim.frame.windFromDeg) ? Math.round(sim.frame.windFromDeg) + '°' : '—';
      const to = finite(sim.frame.headingToDeg) ? Math.round(sim.frame.headingToDeg) + '°' : '—';
      add('ลมของฉาก ณ เวลาที่เลือก', from + ' → ' + to + ' · ' + format(sim.frame.windSpeedMs) + ' m/s', 'ลมสังเคราะห์ ไม่ใช่ค่าตรวจวัด');
    }
    const first = detections(sim)[0];
    add('คาดพบควันครั้งแรกในฉาก', !scene ? 'ยังไม่มีผล' : first ? first.sensorId + ' · T+' + first.minute + ' นาที' : 'ไม่พบภายใน 120 นาที', first ? detectionText(first) : 'ผลจำลอง ไม่ใช่ alarm จากอุปกรณ์');
    const route = op.currentRoute, rs = op.routeStatus || {};
    add('Access / Egress', route ? (rs.distance || '—') + ' · เข้า ' + (rs.time || '—') + ' · ออก ' + (rs.egressTime || '—') : 'ยังไม่มีเส้นทางที่คำนวณแล้ว', rs.message || (!op.routingAvailable ? 'OSM routing graph ยังไม่พร้อม' : 'กดคำนวณเองในขั้น 4'));
    if (route) {
      add('รูปแบบเดินทาง / ภูมิประเทศ', (rs.profile || route.profile || '—') + ' · ความสูงสะสม ' + (rs.elevationGain || '—') + ' · grade สูงสุด ' + (rs.maxGrade || '—'), 'ค่าความสูง/grade จะแสดงเมื่ออ่านข้อมูลสำเร็จ');
      const journey = route.journey;
      if (journey) {
        if (journey.profile !== 'foot' && finite(journey.driveKm)) add('ช่วงขับรถ', format(journey.driveKm) + ' กม.' + (finite(journey.driveMin) ? ' · ' + Math.round(journey.driveMin) + ' นาที' : ''));
        if (finite(journey.walkKm)) add('ช่วงเดินเท้ารวม', format(journey.walkKm) + ' กม.' + (finite(journey.walkMin) ? ' · ' + Math.round(journey.walkMin) + ' นาที' : ''));
        if (finite(journey.mappedWalkKm)) add('เดินตามทาง OSM', format(journey.mappedWalkKm) + ' กม.' + (finite(journey.mappedWalkMin) ? ' · ' + Math.round(journey.mappedWalkMin) + ' นาที' : ''));
        if (journey.profile !== 'foot' && Array.isArray(journey.handoff) && journey.handoff.length >= 2 && journey.handoff.every(finite)) add('จุดลงเดิน', journey.handoff[0].toFixed(6) + ', ' + journey.handoff[1].toFixed(6), 'Latitude, Longitude · จุดจากกราฟ ต้องยืนยันภาคสนาม');
      }
      add('ช่วงนอกทาง', rs.offroadDistance || '—', 'เส้นเชื่อมประมาณ ไม่ใช่เส้นทางเดินที่ยืนยันแล้ว');
    }
  }
  function refresh() {
    const sim = simulation(), op = operational();
    text('guide-target-current', guide.targetMessage || (coord(op.target) ? 'จุดปัจจุบัน ' + (op.target.id || '') + ' · ' + coord(op.target) + ' (Latitude, Longitude)' : 'ยังไม่มีพิกัดไฟที่เลือก · รอข้อมูลแผนที่หรือเลือกพิกัดด้วยตัวเอง'));
    text('guide-simulation-current', sim.busy ? sim.status?.message || 'กำลังคำนวณฉาก' : sim.scenario ? 'ฉากปัจจุบัน T+' + sim.minute + ' นาที · ' + (sim.playing ? 'กำลังเล่น' : 'พัก / เลื่อนเวลาได้') + ' · ค่าเซนเซอร์จำลอง' : sim.status?.message || 'ยังไม่มีฉาก · กดปุ่มทดลองเพื่อเริ่ม');
    renderDetections(sim); renderRoute(op); renderSummary(sim, op); paintNavigation();
  }
  const next = () => {
    if (window.WildfireWorkspace && !guide.summary) {
      if (guide.step === 2 && !simulation().scenario) { if (!simulation().busy) window.WildfireSimulation?.run?.(); return; }
      if (guide.step === 4 && !operational().currentRoute) { $('op-route')?.click(); return; }
    }
    if (guide.summary) changeView(1); else if (guide.step < 4) changeView(guide.step + 1); else changeView(4, true);
  };
  bind('guide-start', () => { changeView(1); window.WildfireWorkspace?.scrollToMap(); });
  bind('guide-explore', () => exit());
  bind('guide-back', () => { if (guide.summary) changeView(4); else if (guide.step > 1) changeView(guide.step - 1); });
  bind('guide-next', next); bind('guide-go-route', () => changeView(4));
  bind('workspace-summary', () => changeView(4, true));
  bind('guide-skip', () => exit()); bind('guide-restart', () => changeView(1));
  bind('guide-summary-other', () => changeView(1)); bind('guide-summary-restart', () => changeView(1)); bind('guide-summary-exit', () => exit());
  for (const id of ['guide-restart', 'guide-summary-restart']) {
    text(id, 'เริ่มคำแนะนำใหม่');
    $(id)?.setAttribute('title', 'เริ่มเฉพาะคำแนะนำใหม่ โดยเก็บพิกัด ฉากไฟลาม และเส้นทางเดิม');
    $(id)?.setAttribute('aria-label', 'เริ่มคำแนะนำใหม่ โดยเก็บฉากไฟลามและเส้นทางเดิม');
  }
  document.querySelectorAll('[data-guide-step]').forEach(button => button.addEventListener('click', () => changeView(Number(button.dataset.guideStep))));
  text('guide-use-h01', 'ใช้ H-01 เป็นตัวอย่าง · แทนจุดไฟปัจจุบัน');
  bind('guide-use-h01', () => {
    const api = window.WildfireOperationalMap;
    if (!api?.selectHistoricalTarget) { guide.targetMessage = 'ข้อมูล H-01 ยังไม่พร้อม · จุดปัจจุบันยังคงเดิม'; refresh(); return; }
    const chosen = api.selectHistoricalTarget('H-01');
    if (chosen === false || chosen === null) { guide.targetMessage = 'เลือก H-01 ไม่สำเร็จ · ตรวจสถานะข้อมูลแผนที่'; refresh(); return; }
    guide.targetMessage = ''; refresh(); api.focusTarget?.(); scrollTo($('operational-3d-map'), false);
  });
  bind('guide-show-ignition', () => { window.WildfireOperationalMap?.focusTarget?.(); scrollTo($('operational-3d-map'), false); });
  bind('guide-show-spread', () => { if (simulation().scenario) { $('sim-focus-fire')?.click(); scrollTo($('operational-3d-map'), false); } });
  bind('guide-show-route', () => { if (operational().currentRoute) scrollTo($('operational-3d-map'), false); });
  window.addEventListener('wildfire:simulation-updated', refresh);
  window.addEventListener('wildfire:route-updated', () => { guide.targetMessage = ''; refresh(); });
  window.addEventListener('wildfire:target-changed', () => { guide.targetMessage = ''; refresh(); });
  window.addEventListener('wildfire:map-ready', refresh);
  window.addEventListener('wildfire:data-updated', refresh);
  window.addEventListener('hashchange', followHash); window.addEventListener('popstate', followHash);
  window.addEventListener('resize', updateStickyHeight);
  if (window.ResizeObserver && $('guided-progress')) new window.ResizeObserver(updateStickyHeight).observe($('guided-progress'));
  window.WildfireGuidedDemo = Object.freeze({ getState: () => ({ active: guide.active, step: guide.step, summary: guide.summary }) });
  const initial = parseHash(window.location.hash);
  if (initial) changeView(initial.step, initial.summary, false, false);
  else { guide.returnHash = window.location.hash || '#operational-3d'; refresh(); }
  if (initial) (window.requestAnimationFrame || (callback => callback()))(() => window.WildfireWorkspace ? window.WildfireWorkspace.scrollToMap() : scrollTo(stepTarget()));
})();
