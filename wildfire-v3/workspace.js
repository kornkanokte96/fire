'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const section = $('operational-3d'), layout = section?.querySelector('.op-layout');
  const command = layout?.querySelector('.op-command'), mapCard = layout?.querySelector('.op-map-card');
  if (!command || !mapCard || window.WildfireWorkspace) return;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const details = (label, ...nodes) => {
    const element = make('details', 'workspace-details');
    element.append(make('summary', '', label), ...nodes.filter(Boolean));
    return element;
  };
  const wrapDetails = (node, label) => {
    const wrapper = details(label); node.before(wrapper); wrapper.append(node); return wrapper;
  };
  layout.id = 'demo-workspace';
  section.querySelector('.op-head').after($('guided-progress'));
  const viewport = make('div', 'workspace-map-viewport');
  viewport.append(...Array.from(mapCard.children));
  const mapTools = details('ชั้นแผนที่และตัวกรอง', section.querySelector('.point-filterbar'), section.querySelector('.op-toolbar'), section.querySelector('.op-mode-buttons'));
  const dataDetails = details('แหล่งข้อมูลและสถานะแผนที่', $('v1-data-status'), $('v1-site-provenance'));
  mapTools.append(dataDetails);
  const mapHead = make('div', 'workspace-map-head');
  mapHead.append(make('b', '', 'แผนที่ภูมิประเทศ 3D'), mapTools);
  const mapStatus = make('div', 'workspace-map-status');
  mapStatus.append($('op-status'));
  const playback = make('div', 'workspace-playback');
  playback.id = 'workspace-playback';
  const playbackActions = make('div', 'workspace-playback-actions');
  const play = make('button', '', 'เล่นต่อ'); play.id = 'workspace-play'; play.type = 'button'; play.disabled = true;
  play.addEventListener('click', () => $('sim-run').click());
  playbackActions.append(play, $('sim-pause'), $('sim-speed').parentElement);
  playback.append($('fire-simulation').querySelector('.sim-time'), playbackActions);
  mapCard.append(mapHead, mapStatus, viewport, playback);

  const heading = make('header', 'workspace-command-head');
  const kicker = make('span', 'workspace-step-number'); kicker.id = 'workspace-step-number';
  const title = make('h3'); title.id = 'workspace-step-title'; title.tabIndex = -1;
  kicker.textContent = 'ขั้นที่ 1 / 4'; title.textContent = 'เลือกจุดเกิดไฟ';
  heading.append(kicker, title);
  const body = make('div', 'workspace-command-body'); body.id = 'workspace-command-body';
  body.setAttribute('role', 'region'); body.setAttribute('aria-labelledby', title.id);
  const panels = new Map();
  const panel = (step, ...nodes) => {
    const element = make('section', 'workspace-step'); element.dataset.workspaceStep = String(step); element.hidden = step !== 1;
    element.setAttribute('aria-label', ['เลือกจุดเกิดไฟ', 'จำลองการลุกลาม', 'Sensor Detection', 'Access Route', 'สรุปผล'][step - 1]);
    element.append(...nodes.filter(Boolean)); body.append(element); panels.set(step, element);
  };
  panel(1, $('guide-fire-target'));
  panel(2, $('fire-simulation'));
  panel(3, $('guide-detection-empty'), $('sim-results'));
  panel(4, $('guide-access-target'));
  panel(5, $('guide-summary'));
  const navigation = $('guide-next').parentElement;
  navigation.classList.add('workspace-command-footer');
  command.replaceChildren(heading, body, navigation);
  $('guide-next').disabled = true; $('guide-next').textContent = 'กำลังเตรียมแผนที่…';
  // Move the actual controls, retaining their engine listeners, values and IDs.
  for (const kind of ['target', 'start']) {
    const form = $('op-' + kind + '-coordinates');
    wrapDetails(form, 'กรอก Latitude / Longitude');
  }
  const simActions = $('fire-simulation').querySelector('.sim-actions');
  simActions.after(details('ตัวเลือกการจำลอง', $('sim-reset'), $('sim-new-wind'), ...Array.from(simActions.querySelectorAll('.sim-layer-option'))));
  const results = $('sim-results');
  const fullTimeline = details('ดูรายการตรวจจับทั้งหมดและสมมติฐาน', results.querySelector('.sim-results-head'), $('sim-events'), results.querySelector('.sim-method'));
  results.append(fullTimeline);
  const route = $('guide-access-target');
  const routeDetails = details('รายละเอียดเส้นทางและข้อจำกัด', route.querySelector('.op-route-detail'), route.querySelector('.op-safety-note'));
  route.append(routeDetails);
  const partialSummary = make('button', 'workspace-partial-summary', 'ดูสรุปข้อมูลที่มี →');
  partialSummary.id = 'workspace-summary'; partialSummary.type = 'button'; route.append(partialSummary);
  const notes = section.querySelector('.op-notes');
  wrapDetails(notes, 'เกี่ยวกับภูมิประเทศและชั้นข้อมูล');
  document.body.classList.add('workspace-ready');
  // Layout changes only resize the current camera; they never fit or recalculate it.
  const resizeMap = () => {
    const context = window.WildfireOperationalMap?.getContext?.();
    context?.map?.resize?.(); context?.flatMap?.invalidateSize?.({ pan: false });
  };
  if (window.ResizeObserver) new ResizeObserver(resizeMap).observe(viewport);
  resizeMap();
  const titles = ['เลือกจุดเกิดไฟ', 'จำลองการลุกลาม', 'ดู Sensor Detection', 'วางแผน Access Route', 'สรุปฉากปัจจุบัน'];
  let shown = 0;
  window.WildfireWorkspace = Object.freeze({
    render(guide, simulation, operational) {
      const step = guide.summary ? 5 : guide.step;
      panels.forEach((element, number) => { element.hidden = number !== step; });
      if (shown !== step) { body.scrollTop = 0; shown = step; }
      kicker.textContent = guide.summary ? 'สรุปผลจากระบบ' : 'ขั้นที่ ' + guide.step + ' / 4';
      title.textContent = titles[step - 1];
      mapHead.firstElementChild.textContent = $('operational-3d-map').classList.contains('leaflet-container') ? 'แผนที่สำรอง 2D' : 'แผนที่ภูมิประเทศ 3D';
      play.disabled = !simulation.scenario || simulation.busy || simulation.playing;
      command.querySelector('.op-route-metrics').hidden = !operational.currentRoute;
      $('op-journey').hidden = !operational.currentRoute;
      partialSummary.hidden = operational.routingAvailable || !!operational.currentRoute;
      $('guided-progress').setAttribute('aria-label', guide.active ? 'ความคืบหน้า Guided Demo' : 'เครื่องมือวางแผน 4 ขั้น');
    },
    focusStep() { title.focus({ preventScroll: true }); },
    scrollToMap() { $('guided-progress').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  });
})();
