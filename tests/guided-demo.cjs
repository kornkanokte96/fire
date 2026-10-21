// Run with: node tests/guided-demo.cjs
// Exercise the actual guide controller against mutable, read-only engine snapshots.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const script = fs.readFileSync(path.join(__dirname, '../wildfire-v3/guided-demo.js'), 'utf8');
const ids = ['guide-start', 'guide-explore', 'guided-progress', 'guide-back', 'guide-next', 'guide-skip', 'guide-restart',
  'guide-progress-label', 'guide-fire-target', 'fire-simulation', 'sim-results', 'guide-access-target',
  'guide-card-1', 'guide-card-2', 'guide-card-3', 'guide-card-4', 'guide-use-h01', 'guide-target-current',
  'guide-simulation-current', 'guide-detection-summary', 'guide-detection-state', 'guide-route-summary', 'guide-route-state',
  'guide-go-route', 'guide-summary', 'guide-summary-values', 'guide-summary-other', 'guide-summary-restart', 'guide-summary-exit',
  'guide-detection-empty', 'guide-show-ignition', 'guide-show-spread', 'guide-show-route', 'sim-focus-fire', 'operational-3d-map', 'op-route'];
const html = fs.readFileSync(path.join(__dirname, '../wildfire-v3/index.html'), 'utf8');
for (const id of ids) assert.equal([...html.matchAll(new RegExp('\\bid="' + id + '"', 'g'))].length, 1, 'Expected one real DOM target: ' + id);
class Element {
  constructor(id = '', tagName = 'div') {
    this.id = id; this.tagName = tagName; this.dataset = {}; this.children = []; this.listeners = new Map();
    this.hidden = false; this.disabled = false; this.textContent = ''; this.attributes = {}; this.scrolled = []; this.focused = [];
    this.style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
    const classes = new Set();
    this.classList = { toggle: (name, enabled) => { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  click() { if (!this.disabled) (this.listeners.get('click') || []).forEach(callback => callback({ target: this })); }
  scrollIntoView(options) { this.scrolled.push(options); }
  focus(options) { this.focused.push(options); }
  getBoundingClientRect() { return { height: this.hidden ? 0 : this.height || 82 }; }
  querySelector(selector) { return selector === 'h2, h3, h4' ? this.children.find(child => /^h[234]$/.test(child.tagName)) || null : this.children.find(child => child.tagName === selector) || null; }
}
const flatten = element => [element.textContent, ...element.children.map(flatten)].join(' ');
function fixture({ hash = '#operational-3d', reduced = false, scenario = null, route = null, workspace = false } = {}) {
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  if (workspace) elements.set('workspace-summary', new Element('workspace-summary'));
  ['guide-fire-target', 'fire-simulation', 'sim-results', 'guide-access-target', 'guide-summary', 'guide-detection-empty'].forEach(id => elements.get(id).append(new Element('', 'h3')));
  elements.get('guide-detection-empty').append(new Element('', 'p'));
  elements.get('sim-results').hidden = !scenario;
  const nav = [1, 2, 3, 4].map(step => { const element = new Element('nav-' + step, 'button'); element.dataset.guideStep = String(step); return element; });
  const listeners = new Map(), root = new Element(), observers = [], historyStack = [hash]; let historyIndex = 0;
  const calls = { select: [], focusTarget: 0, run: 0, pause: 0, reset: 0, route: 0, spread: 0 };
  const sim = { scenario, frame: scenario ? { areaHa: 9.7, windFromDeg: 270, headingToDeg: 90, windSpeedMs: 2.5 } : null, minute: 0, playing: false, busy: false, status: { state: 'ready', message: 'พร้อมทดลอง' } };
  const op = { ready: true, target: { id: 'CUSTOM', lat: 19.42, lon: 101.07 }, currentRoute: route, routingAvailable: true,
    routeStatus: { state: route ? 'ready' : 'idle', message: route ? 'เส้นทางที่คำนวณไว้' : 'ยังไม่ได้คำนวณ', distance: route ? '2.3 กม.' : '—',
      time: route ? '17 นาที' : '—', egressTime: route ? '19 นาที' : '—', offroadDistance: route ? '0.4 กม.' : '—', profile: '4x4 / track', elevationGain: route ? '153 m' : '—', maxGrade: route ? '18%' : '—' } };
  const dispatch = (type, detail) => (listeners.get(type) || []).forEach(callback => callback({ type, detail }));
  const window = {
    location: { hash }, history: { pushState(_state, _title, value) { window.location.hash = value; historyStack.splice(++historyIndex); historyStack.push(value); } },
    matchMedia: () => ({ matches: reduced }), requestAnimationFrame: callback => callback(),
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(element) { this.element = element; } },
    WildfireSimulation: { getSnapshot: () => sim, run: () => calls.run++, pause: () => calls.pause++, reset: () => calls.reset++ },
    WildfireOperationalMap: { getSnapshot: () => op, selectHistoricalTarget(id) {
      calls.select.push(id); if (this.failSelection) return null;
      op.target = { id, lat: 19.432101, lon: 101.078901 };
      dispatch('wildfire:route-updated', op); return op.target;
    }, focusTarget: () => calls.focusTarget++, calculateRoute: () => calls.route++ }
  };
  const document = { documentElement: root, body: new Element('body'), getElementById: id => elements.get(id) || null, createElement: tag => new Element('', tag),
    querySelectorAll: selector => selector === '[data-guide-step]' ? nav : [] };
  const workspaceCalls = { focus: 0, scroll: 0, render: 0 };
  if (workspace) window.WildfireWorkspace = {
    render() { workspaceCalls.render++; }, focusStep() { workspaceCalls.focus++; }, scrollToMap() { workspaceCalls.scroll++; }
  };
  elements.get('op-route').addEventListener('click', () => calls.route++);
  elements.get('sim-focus-fire').addEventListener('click', () => calls.spread++);
  const sandbox = vm.createContext({ window, document, console });
  const load = () => vm.runInContext(script, sandbox); load();
  return { window, elements, nav, sim, op, calls, dispatch, listeners, root, observers, load, workspaceCalls,
    click: id => elements.get(id).click(), text: id => flatten(elements.get(id)),
    navigate(value) { window.location.hash = value; dispatch('hashchange'); },
    back() { if (historyIndex) window.location.hash = historyStack[--historyIndex]; dispatch('popstate'); dispatch('hashchange'); },
    getState: () => JSON.parse(JSON.stringify(window.WildfireGuidedDemo.getState())),
    get scrollCount() { return [...elements.values()].reduce((sum, element) => sum + element.scrolled.length, 0); }
  };
}
const noEngineMutation = f => { assert.equal(f.calls.run, 0); assert.equal(f.calls.pause, 0); assert.equal(f.calls.reset, 0); assert.equal(f.calls.route, 0); };
const makeScenario = () => ({ members: 24, origin: { lat: 19.42, lon: 101.07 }, events: [
  { type: 'smoke-detection', sensorId: 'N-AQ', roleCode: 'AQ', minute: 12, signals: { pm25UgM3: 61, coPpm: .61, windSpeedMs: 3, windFromDeg: 270, windToDeg: 90 } },
  { type: 'weather', sensorId: 'N-RW', roleCode: 'RW', minute: 0, signals: { windSpeedMs: 2 } },
  { type: 'smoke-detection', sensorId: 'EX-01', roleCode: 'EX', minute: 8, capabilityAssumed: true, signals: { pm25UgM3: 40, coPpm: null, windSpeedMs: 2 } },
  { type: 'smoke-detection', sensorId: 'N-RS', roleCode: 'RS', minute: 5, signals: { pm25UgM3: 35, coPpm: null, windSpeedMs: 2.5, windFromDeg: 270, windToDeg: 90 } },
  { type: 'smoke-detection', sensorId: 'N-FU', roleCode: 'FU', minute: 18, signals: { pm25UgM3: 80, coPpm: .8 } }
] });
const makeRoute = () => ({ profile: '4x4', journey: { profile: '4x4', driveKm: 1.6, driveMin: 5, walkKm: .7, walkMin: 12, mappedWalkKm: .3, mappedWalkMin: 4, handoff: [19.425678, 101.076543] } });

const manual = fixture({ hash: '#network-plan' });
assert.deepEqual(manual.getState(), { active: false, step: 1, summary: false });
assert.equal(manual.window.location.hash, '#network-plan');
assert.equal(manual.elements.get('guided-progress').hidden, true);
manual.click('guide-start'); assert.equal(manual.window.location.hash, '#guide-step-1');
assert.match(manual.elements.get('guide-use-h01').textContent, /แทนจุดไฟปัจจุบัน/);
assert.equal(manual.elements.get('guide-back').disabled, true);
manual.click('guide-next'); manual.click('guide-next');
assert.deepEqual(manual.getState(), { active: true, step: 3, summary: false });
assert.equal(manual.elements.get('guide-detection-empty').hidden, false);
assert.equal(manual.elements.get('sim-results').hidden, true, 'Guide must not fabricate/show result container');
assert.match(manual.text('guide-detection-state'), /ยังไม่มีฉาก/);
manual.click('guide-go-route'); manual.click('guide-next');
assert.equal(manual.elements.get('guide-summary').hidden, false);
assert.match(manual.text('guide-summary-values'), /ยังไม่มีผลฉาก/);
assert.match(manual.text('guide-summary-values'), /ยังไม่มีเส้นทางที่คำนวณแล้ว/);
manual.click('guide-summary-restart'); manual.click('guide-skip');
assert.equal(manual.window.location.hash, '#network-plan');
assert.equal(manual.calls.select.length, 0); noEngineMutation(manual);

const scene = makeScenario(), route = makeRoute(), live = fixture({ scenario: scene, route });
live.sim.playing = true; live.sim.minute = 10;
live.click('guide-start'); live.nav[2].click(); live.dispatch('wildfire:simulation-updated', live.sim);
const cards = live.elements.get('guide-detection-summary').children;
assert.deepEqual(cards.map(card => card.dataset.sensorId), ['N-RS', 'EX-01', 'N-AQ']);
assert.match(flatten(cards[0]), /PM2.5 35/); assert.match(flatten(cards[0]), /ลมจำลอง/); assert.doesNotMatch(flatten(cards[0]), /CO/);
assert.match(flatten(cards[0]), /Reference \/ Super Station/); assert.match(flatten(cards[1]), /Existing Sensors/); assert.match(flatten(cards[2]), /AQ \/ Smoke/);
assert.match(flatten(cards[1]), /สมมติการรองรับ PM/); assert.doesNotMatch(flatten(cards[1]), /CO|ลมจำลอง/);
assert.match(flatten(cards[2]), /CO 0[.,]61 ppm/); assert.doesNotMatch(flatten(cards[2]), /ลมจำลอง/);
assert.match(flatten(cards[2]), /ยังไม่ถึงเวลานี้/); assert.match(live.text('guide-detection-state'), /พบแล้ว 2 \/ 4/);
const beforeRefreshScrolls = live.scrollCount;
live.sim.minute = 30; live.dispatch('wildfire:simulation-updated', live.sim);
assert.match(live.text('guide-detection-state'), /พบแล้ว 4 \/ 4/);
assert.equal(live.scrollCount, beforeRefreshScrolls, 'Data updates must not pull user back to a step');
live.nav[3].click(); assert.match(live.text('guide-route-summary'), /ขับรถ 1[.,]6/);
assert.match(live.text('guide-route-summary'), /เดินเท้า 0[.,]7/);
assert.match(live.text('guide-route-summary'), /19\.425678, 101\.076543/);
assert.match(live.text('guide-route-summary'), /153 m.*18%/);
assert.match(live.text('guide-route-summary'), /เดินตามทาง OSM 0[.,]3/);
live.click('guide-next'); assert.match(live.text('guide-summary-values'), /T\+30 นาที · กำลังเล่น/);
assert.match(live.text('guide-summary-values'), /9[.,]7 เฮกตาร์/);
assert.match(live.text('guide-summary-values'), /2[.,]3 กม.*17 นาที.*19 นาที/);
assert.match(live.text('guide-summary-values'), /270° → 90° · 2[.,]5 m\/s/);
assert.match(live.text('guide-summary-values'), /4x4 \/ track.*153 m.*18%/);
assert.match(live.text('guide-summary-values'), /19\.425678, 101\.076543/);
live.click('guide-summary-other'); live.click('guide-restart'); live.click('guide-summary-exit');
assert.equal(live.sim.scenario, scene); assert.equal(live.op.currentRoute, route); assert.equal(live.sim.playing, true);
assert.equal(live.sim.minute, 30); assert.equal(live.calls.select.length, 0); noEngineMutation(live);

const empty = fixture({ scenario: { members: 24, events: [{ type: 'weather', sensorId: 'RW', minute: 0 }] } });
empty.nav[2].click(); assert.equal(empty.elements.get('guide-detection-summary').children.length, 0);
assert.equal(empty.elements.get('guide-detection-state').dataset.state, 'no-detection');
assert.match(empty.text('guide-detection-state'), /ไม่ยืนยันว่าพื้นที่ไม่มีไฟ/);
assert.match(empty.text('guide-detection-state'), /ช่องว่างการตรวจจับหรือลมพัดออก/);
empty.sim.scenario = null; empty.sim.frame = null; empty.sim.status = { state: 'error', message: 'การคำนวณล้มเหลว: worker data invalid' };
empty.op.currentRoute = null; empty.op.routingAvailable = false; empty.op.routeStatus = { state: 'error', message: 'ไม่มี OSM graph' };
empty.dispatch('wildfire:simulation-updated', empty.sim); empty.dispatch('wildfire:route-updated', empty.op);
assert.match(empty.text('guide-detection-state'), /worker data invalid/); assert.equal(empty.elements.get('guide-detection-state').dataset.state, 'error');
assert.match(empty.text('guide-detection-empty'), /worker data invalid/);
assert.match(empty.text('guide-route-state'), /ไม่มี OSM graph/); assert.equal(empty.elements.get('guide-route-state').dataset.state, 'error');
empty.sim.busy = true; empty.sim.status = { state: 'loading', message: 'กำลังคำนวณ 24 ฉาก' };
empty.dispatch('wildfire:simulation-updated', empty.sim); assert.equal(empty.elements.get('guide-detection-state').dataset.state, 'loading');
assert.equal(empty.elements.get('guide-detection-summary').children.length, 0); noEngineMutation(empty);
empty.sim.busy = false; empty.sim.status = { state: 'ready', message: 'พิกัดไฟเปลี่ยนแล้ว · คำนวณฉากใหม่' };
empty.dispatch('wildfire:simulation-updated', empty.sim); assert.match(empty.text('guide-detection-empty'), /พิกัดไฟเปลี่ยนแล้ว/);

const explicit = fixture(); explicit.click('guide-start'); explicit.click('guide-show-ignition');
assert.equal(explicit.calls.select.length, 0); assert.equal(explicit.calls.focusTarget, 1);
explicit.click('guide-use-h01'); assert.deepEqual(explicit.calls.select, ['H-01']);
assert.match(explicit.text('guide-target-current'), /19\.432101, 101\.078901/);
assert.equal(explicit.calls.focusTarget, 2); assert.ok(explicit.elements.get('operational-3d-map').scrolled.length >= 2);
explicit.window.WildfireOperationalMap.failSelection = true; explicit.click('guide-use-h01');
assert.match(explicit.text('guide-target-current'), /เลือก H-01 ไม่สำเร็จ/);
assert.equal(explicit.op.target.lat, 19.432101);
explicit.click('guide-show-spread'); assert.equal(explicit.calls.spread, 0);
explicit.sim.scenario = makeScenario(); explicit.dispatch('wildfire:simulation-updated', explicit.sim);
explicit.click('guide-show-spread'); assert.equal(explicit.calls.spread, 1); noEngineMutation(explicit);
const routeView = fixture({ scenario: makeScenario(), route: makeRoute() });
routeView.sim.minute = 120; routeView.sim.playing = false;
routeView.click('guide-start'); routeView.nav[3].click();
const routeBeforeView = routeView.op.currentRoute, sceneBeforeView = routeView.sim.scenario;
const routeMapScrolls = routeView.elements.get('operational-3d-map').scrolled.length;
assert.equal(routeView.elements.get('guide-show-route').disabled, false); routeView.click('guide-show-route');
assert.equal(routeView.elements.get('operational-3d-map').scrolled.length, routeMapScrolls + 1);
assert.equal(routeView.op.currentRoute, routeBeforeView); assert.equal(routeView.sim.scenario, sceneBeforeView);
assert.equal(routeView.sim.minute, 120); assert.equal(routeView.calls.focusTarget, 0); assert.equal(routeView.calls.spread, 0); noEngineMutation(routeView);
routeView.op.currentRoute = null; routeView.dispatch('wildfire:route-updated', routeView.op);
assert.equal(routeView.elements.get('guide-show-route').disabled, true);
routeView.click('guide-show-route'); assert.equal(routeView.elements.get('operational-3d-map').scrolled.length, routeMapScrolls + 1);

const direct = fixture({ hash: '#guide-step-3', reduced: true });
assert.equal(direct.getState().step, 3); assert.equal(direct.elements.get('guide-detection-empty').scrolled[0].behavior, 'auto');
assert.equal(direct.elements.get('guide-detection-empty').children[0].attributes.tabindex, '-1');
assert.equal(direct.elements.get('guide-detection-empty').children[0].focused[0].preventScroll, true);
direct.nav[3].click(); direct.click('guide-next');
assert.equal(direct.window.location.hash, '#guide-summary');
direct.back(); assert.equal(direct.getState().step, 4); assert.equal(direct.getState().summary, false);
const beforeDuplicateHash = direct.scrollCount;
direct.dispatch('hashchange'); assert.equal(direct.scrollCount, beforeDuplicateHash);
direct.navigate('#network-plan'); assert.equal(direct.getState().active, false); assert.equal(direct.window.location.hash, '#network-plan');
direct.navigate('#guide-summary'); assert.equal(direct.getState().summary, true);
direct.click('guide-summary-exit'); assert.equal(direct.window.location.hash, '#network-plan');
const reload = fixture({ hash: '#guide-summary', scenario: makeScenario() });
assert.equal(reload.getState().summary, true); assert.equal(reload.elements.get('guide-summary').hidden, false);
reload.click('guide-summary-exit'); assert.equal(reload.window.location.hash, '#operational-3d');

const once = fixture(); once.load(); assert.equal(once.elements.get('guide-start').listeners.get('click').length, 1);
assert.equal(once.listeners.get('wildfire:simulation-updated').length, 1); assert.equal(once.observers.length, 1);
once.click('guide-start'); assert.equal(once.root.style.values['--guide-sticky-height'], '82px');
once.elements.get('guided-progress').height = 116; once.observers[0].callback();
assert.equal(once.root.style.values['--guide-sticky-height'], '116px');
once.click('guide-explore'); assert.equal(once.root.style.values['--guide-sticky-height'], '0px');
noEngineMutation(once);
const explore = fixture(); explore.click('guide-explore'); assert.equal(explore.elements.get('operational-3d-map').scrolled.length, 1);
console.log('PASS: guide-only navigation/restart/skip preserve engine; real snapshot updates and first detections; capability-safe signals; empty/busy/failure states; explicit-only H-01/focus; direct/reload/back/manual hashes; reduced-motion focus/sticky sizing; single initialization');

const workspace = fixture({ workspace: true });
assert.equal(workspace.elements.get('guided-progress').hidden, false, 'Tools remain reachable in explore mode');
workspace.click('guide-start');
assert.equal(workspace.workspaceCalls.scroll, 1, 'Only entering the workspace scrolls the page');
workspace.click('guide-next');
assert.equal(workspace.getState().step, 2);
assert.match(workspace.text('guide-next'), /เริ่มจำลอง/);
workspace.click('guide-next'); assert.equal(workspace.calls.run, 1);
assert.equal(workspace.getState().step, 2, 'Stay on simulation until the engine returns a scenario');
workspace.sim.busy = true; workspace.dispatch('wildfire:simulation-updated');
assert.equal(workspace.elements.get('guide-next').disabled, true);
workspace.click('guide-next'); assert.equal(workspace.calls.run, 1);
workspace.sim.busy = false; workspace.sim.scenario = makeScenario(); workspace.sim.minute = 47;
workspace.dispatch('wildfire:simulation-updated'); workspace.click('guide-next');
assert.equal(workspace.getState().step, 3); assert.match(workspace.text('guide-detection-state'), /T\+47/);
workspace.click('guide-next'); workspace.click('guide-next');
assert.equal(workspace.calls.route, 1, 'The footer uses the original route control');
assert.equal(workspace.getState().step, 4, 'Do not show success/summary before a route exists');
workspace.op.routingAvailable = false; workspace.dispatch('wildfire:route-updated');
assert.equal(workspace.elements.get('guide-next').disabled, true);
workspace.op.routingAvailable = true; workspace.dispatch('wildfire:data-updated');
assert.equal(workspace.elements.get('guide-next').disabled, false, 'Roads arriving after map initialization must enable routing without changing the target');
workspace.op.routingAvailable = false; workspace.dispatch('wildfire:data-updated');
assert.equal(workspace.elements.get('guide-next').disabled, true, 'Unavailable/restricted replacement data must disable routing again');
workspace.click('workspace-summary'); assert.equal(workspace.getState().summary, true);
assert.match(workspace.text('guide-summary-values'), /ยังไม่มีเส้นทางที่คำนวณแล้ว/);
assert.equal(workspace.calls.route, 1, 'The partial summary must not invent or calculate a route');
workspace.click('guide-back');
workspace.op.currentRoute = makeRoute(); workspace.op.routingAvailable = true; workspace.dispatch('wildfire:route-updated');
workspace.click('guide-next'); assert.equal(workspace.getState().summary, true);
assert.equal(workspace.scrollCount, 0, 'Changing steps must never scroll to scattered controls');
assert.equal(workspace.workspaceCalls.scroll, 1);
workspace.click('guide-restart'); workspace.click('guide-skip');
assert.equal(workspace.sim.minute, 47); assert.ok(workspace.sim.scenario); assert.ok(workspace.op.currentRoute);
assert.equal(workspace.calls.pause, 0); assert.equal(workspace.calls.reset, 0);
assert.equal(workspace.elements.get('guided-progress').hidden, false);
console.log('PASS: one workspace preserves state across four steps; explicit engine actions, busy/unavailable guards and no inter-step page scrolling.');
