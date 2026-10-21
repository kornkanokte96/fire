// Run with: node tests/v3-isolation.cjs (standalone Node.js; no package install or Git subprocess).
// Compare working files, rather than HEAD/index alone, against the published V2 baseline.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const baseline = 'd34d37694d45dd122a21c77f7d787320bfa8f3f0';
const v2Tree = '064cace891a21bcac17f8de05a3f99eb41a3d923';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// Frozen from `git ls-tree -r` at the baseline above. Never regenerate from the working tree.
const tree = new Map(`
2773414dcbc7687f2ffaa10a955d66c6494de999 app.js
050c2ec98a40b7fd0cd3f1fb4c90321e6a2b168b data.js
13869331b8e95b1d1b72f153ac806e54bb0c1212 index.html
e2f2a53ee2a85d6d05815f93e064683a9d23c610 optimizer.js
0706b8d2036ad9ee01bb9856447a7bbcc667e305 plan.js
77f7c496603dd9b9c0ef04cb6cac5305487dcf6d style.css
779c46bb1be30ffb73623442d7ffbaeaaab00950 terrain3d.js
014eea469b47919f058673d0085917c1f74d5893 vendor/contour/LICENSE
c54b8c89eec37cf57226c735fbf89ca32e0181a8 vendor/contour/index.min.js
bcb3ba1aca095155857556d96e3193a50fe1bd11 vendor/leaflet/LICENSE
200c333dca9652ac4cba004d609e5af4eee168c1 vendor/leaflet/images/layers-2x.png
1a72e5784b2b456eac5d7670738db80697af3377 vendor/leaflet/images/layers.png
88f9e501888c9c6cb29ad340d9a888627dd1b6d8 vendor/leaflet/images/marker-icon-2x.png
950edf24677ded147df13b26f91baa2b0fa70513 vendor/leaflet/images/marker-icon.png
9fd2979532a19a15b824ce763c76e04a8dafadfb vendor/leaflet/images/marker-shadow.png
2961b7618a57617d1015d31d2094c425c3d86ce9 vendor/leaflet/leaflet.css
a3bf693d0fcaff885cc5f21b3a699aaa567b3533 vendor/leaflet/leaflet.js
1e8acbb54fa7baddc844377507cc5a79353174fb vendor/maplibre/LICENSE.txt
3f867477d52e734e9f9c3b93826e629b5ebbb744 vendor/maplibre/maplibre-gl.css
462833a36cd0c6c5dfad2511f8883f4407f99ece vendor/maplibre/maplibre-gl.js
306a9b46e3a933662de908175077857151337932 wildfire-v2/README.md
41a22453519220e8af36b64c214e16c09815303a wildfire-v2/fire-model.js
b3e05f958184d3effcc3fed4d5d6590ffce7c232 wildfire-v2/fire-simulation.css
468e2af43cc7ab1e3790bfac8631955746ea4b35 wildfire-v2/fire-simulation.js
259fff3e2e7cfc287eb6ab862cdc6d4a01ec79af wildfire-v2/fire-worker.js
7451fad5599c4249b1eb30d93827b3a99dec4a5d wildfire-v2/index.html
4d611f2061d938486c443724267fd07cf600796a wildfire-v2/journey.css
6ff61fa8dd93e0ac1d0bba72ec1777822cbe8cd0 wildfire-v2/network-plan.js
11c142ca6ef8828d636df70219ff0b4c60318f4c wildfire-v2/point-filters.js
b0c9e5a096d0be9c06f3c29d47e2fb0fdb98b69a wildfire-v2/presentation-data.js
d7a6796175b314d06a3e153a597cff1c1eaae89e wildfire-v2/presentation.css
a2e66af56ca379883c827418e7fb6a5f8e5be669 wildfire-v2/terrain3d.js
`.trim().split('\n').map(line => { const [hash, file] = line.split(' '); return [file, hash]; }));
const objectHash = (type, content) => createHash('sha1').update(Buffer.from(type + ' ' + content.length + '\0')).update(content).digest('hex');
const fileHash = (file, source = file) => {
  const bytes = fs.readFileSync(path.join(root, file));
  const raw = objectHash('blob', bytes); if (raw === tree.get(source)) return raw;
  // Match Git's text normalization for Windows checkouts; binary images remain byte-for-byte.
  const content = bytes.includes(0) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
  return objectHash('blob', content);
};
const walk = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
  const file = directory + '/' + entry.name;
  assert.ok(!entry.isSymbolicLink(), 'Version assets must not redirect via symlinks: ' + file);
  return entry.isDirectory() ? walk(file) : [file];
});
const assertBaseline = (file, source = file) => {
  assert.ok(tree.has(source), 'Asset is absent from the preservation baseline: ' + source);
  assert.ok(fs.existsSync(path.join(root, file)), 'Preserved asset is missing: ' + file);
  const hash = fileHash(file, source);
  assert.equal(hash, tree.get(source), 'Preserved asset changed: ' + file);
};

const v2Files = [...tree.keys()].filter(file => file.startsWith('wildfire-v2/')).sort();
assert.deepEqual(walk('wildfire-v2').sort(), v2Files, 'V2 must not gain, lose, or rename files');
v2Files.forEach(file => assertBaseline(file));
const actualV2Tree = Buffer.concat(v2Files.map(file => Buffer.concat([Buffer.from('100644 ' + path.basename(file) + '\0'), Buffer.from(fileHash(file), 'hex')])));
assert.equal(objectHash('tree', actualV2Tree), v2Tree, 'The complete V2 working tree must match baseline commit ' + baseline);
const shared = [...tree.keys()].filter(file => file.startsWith('vendor/') || (!file.includes('/') && /\.(?:js|css|html)$/.test(file)));
shared.forEach(file => assertBaseline(file));
console.log('PASS: the V2 working tree and shared root/runtime/vendor assets match the published baseline.');

for (const file of ['fire-model.js', 'fire-worker.js', 'network-plan.js', 'point-filters.js']) {
  assertBaseline('wildfire-v3/' + file, 'wildfire-v2/' + file);
}
// The preserved root blob has mixed CRLF/LF. Git normalizes the new V3 copy when committed;
// compare its text to the root file already validated above, allowing only CRLF → LF.
assert.equal(read('wildfire-v3/style.css').replace(/\r\n/g, '\n'), read('style.css').replace(/\r\n/g, '\n'), 'V3 base style must match the preserved root style apart from checkout line endings');
console.log('PASS: V3 keeps the original model, worker protocol, Network Plan, filters, and base style; its road loader has an independent fallback.');

const dependencies = new Set();
const resolveAsset = (from, reference) => {
  const value = reference.trim();
  if (!value || /^(?:data:|blob:|#)/i.test(value)) return null;
  assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value), 'Static runtime assets must stay repository-local: ' + from + ' → ' + value);
  const pathname = decodeURIComponent(value.split(/[?#]/)[0]);
  const absolute = path.resolve(root, path.dirname(from), pathname);
  const file = path.relative(root, absolute).replaceAll(path.sep, '/');
  assert.ok(file.startsWith('wildfire-v3/') || file.startsWith('vendor/'), 'V3 asset must resolve inside V3 or shared vendor: ' + from + ' → ' + value);
  assert.ok(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), 'Local dependency is missing: ' + from + ' → ' + value);
  assert.equal(fs.realpathSync(absolute), absolute, 'Local dependency must not redirect outside its version: ' + file);
  if (file.startsWith('vendor/')) assertBaseline(file);
  dependencies.add(file); return file;
};
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(['"])(.*?)\2/gs)].map(match => [match[1].toLowerCase(), match[3]]));
const html = read('wildfire-v3/index.html');
for (const match of html.matchAll(/<(script|link|img|source|iframe|audio|video)\b[^>]*>/gi)) {
  const tag = match[1].toLowerCase(), attrs = attributes(match[0]);
  const reference = tag === 'link' ? attrs.href : attrs.src;
  if (!reference) continue;
  if (tag === 'script' || (tag === 'link' && /stylesheet/i.test(attrs.rel || ''))) {
    assert.ok(!/^(?:https?:|\/\/)/i.test(reference), 'V3 code and styles must load from repository assets: ' + reference);
  }
  resolveAsset('wildfire-v3/index.html', reference);
}
for (const file of walk('wildfire-v3').filter(file => file.endsWith('.js'))) {
  const source = read(file);
  // These import sites, including the nested worker's model, must use their own version folder.
  for (const match of source.matchAll(/\b(?:new\s+(?:Worker|SharedWorker)|importScripts|import)\s*\(\s*(['"])(.*?)\1/g)) resolveAsset(file, match[2]);
  for (const match of source.matchAll(/\b(?:import|export)\b[^;\n]*\bfrom\s*(['"])(.*?)\1/g)) resolveAsset(file, match[2]);
  assert.ok(!/(?:\.\.\/|\/|\.\.\\)wildfire-v2(?:[\/\\]|\b)/i.test(source), 'V3 JavaScript must not import a V2 runtime: ' + file);
}
const styles = new Set([...walk('wildfire-v3').filter(file => file.endsWith('.css')), ...[...dependencies].filter(file => file.endsWith('.css'))]);
for (const file of styles) {
  const source = read(file);
  for (const match of source.matchAll(/url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gs)) {
    const dependency = resolveAsset(file, match[2] || match[3]);
    if (dependency?.endsWith('.css')) styles.add(dependency);
  }
  for (const match of source.matchAll(/@import\s+(['"])(.*?)\1/g)) {
    const dependency = resolveAsset(file, match[2]); if (dependency) styles.add(dependency);
  }
}
assert.ok(dependencies.has('wildfire-v3/fire-worker.js') && dependencies.has('wildfire-v3/fire-model.js'), 'The simulation worker and model must resolve within V3');
assert.ok(dependencies.has('wildfire-v3/guided-demo.js'), 'V3 must load its own guide controller');
console.log('PASS: HTML, worker/model imports, and CSS resources resolve within V3 or unchanged shared vendor assets.');
