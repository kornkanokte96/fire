// Run with: node tests/v3-road-data.cjs
// Exercise the V3 data loader with failed, delayed, cached and refreshed OSM services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'wildfire-v3/presentation-data.js'),'utf8');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'wildfire-v3/data/osm-roads.json'),'utf8'));
const bounds={minLat:19.38084,minLon:101.00819,maxLat:19.46964,maxLon:101.1141};
const data={bounds,selected:[],candidates:[]};
const settle=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=json=>({ok:true,json:async()=>json});
const live={elements:[{type:'way',id:1,tags:{highway:'track',access:'private',motor_vehicle:'no',oneway:'yes',surface:'ground'},geometry:[{lat:19.4,lon:101.05},{lat:19.41,lon:101.05}]}]};
function fixture({snapshotResponse=response(snapshot),roadFetch=async()=>{throw Error('OSM unavailable');},cache=null}={}){
 const handlers=new Map(),events=[],calls=[];
 const storage=new Map();
 const cacheKey='forestwatch:v1:osm:roads:'+['minLat','minLon','maxLat','maxLon'].map(k=>bounds[k].toFixed(6)).join(',');
 if(cache)storage.set(cacheKey,JSON.stringify(cache));
 const window={addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},dispatchEvent(e){events.push(e);for(const fn of handlers.get(e.type)||[])fn(e);}};
 vm.runInNewContext(source,{window,document:{getElementById(){return null;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail;}},AbortController,setTimeout:()=>1,clearTimeout(){},fetch:async(url,opts)=>{calls.push(url);if(url==='data/osm-roads.json')return await snapshotResponse;if(!opts.body.includes('highway'))throw Error('Support unavailable');return roadFetch(url,opts);}});
 return {window,calls,events,send:d=>window.dispatchEvent({type:'forestwatch:v4-ready',detail:d}),get state(){return window.ForestWatchPresentationState;}};
}
(async()=>{
 assert.equal(snapshot.copyright,'OpenStreetMap contributors');assert.match(snapshot.source,/api.openstreetmap.org/);assert.match(snapshot.license,/openstreetmap.org/);
 const offline=fixture();offline.send(data);await settle();
 assert.equal(offline.state.osmOK,true);assert.equal(offline.state.provenance.roads.source,'snapshot');assert.equal(offline.state.provenance.roads.status,'unavailable');
 assert.equal(offline.state.osm.segments.length,snapshot.elements.reduce((n,w)=>n+w.geometry.length-1,0));
 for(const segment of offline.state.osm.segments)assert.ok(segment.a.every(Number.isFinite)&&segment.b.every(Number.isFinite));
 const geometry=offline.state.osm.segments;
 assert.equal(offline.window.ForestWatchRoadData.retry(),true);assert.equal(offline.window.ForestWatchRoadData.retry(),false,'Do not duplicate pending retries');await settle();
 assert.equal(offline.state.osm.segments,geometry,'Failed refresh must retain usable geometry');
 const delayed=deferred();const fast=fixture({roadFetch:()=>delayed.promise});fast.send(data);await settle();
 assert.equal(fast.state.osmOK,true,'Snapshot must be usable while Overpass is pending');assert.equal(fast.state.provenance.roads.status,'loading');
 delayed.resolve(response(live));await settle();assert.equal(fast.state.provenance.roads.source,'live');assert.equal(fast.state.osm.segments.length,1);
 assert.equal(fast.state.osm.segments[0].access,'private');assert.equal(fast.state.osm.segments[0].motorVehicle,'no');assert.equal(fast.state.osm.segments[0].oneway,'yes');
 const sameGeometry=fast.state.osm.segments;fast.window.ForestWatchRoadData.retry();await settle();assert.equal(fast.state.osm.segments,sameGeometry,'Identical live refresh must not discard a route');
 const snapLate=deferred(),latest=fixture({snapshotResponse:snapLate.promise,roadFetch:async()=>response(live)});latest.send(data);await settle();snapLate.resolve(response(snapshot));await settle();assert.equal(latest.state.provenance.roads.source,'live','Late snapshot must never replace current live roads');
 const cachedGeometry=[{a:[19.4,101.05],b:[19.41,101.05],hw:'primary'}];
 const cached=fixture({cache:{version:1,savedAt:Date.now(),data:{segments:cachedGeometry}}});cached.send(data);await settle();assert.equal(cached.state.provenance.roads.source,'cache');assert.equal(cached.state.osm.segments.length,1);assert.ok(!cached.calls.includes('data/osm-roads.json'),'Keep more recent cached roads');
 const outside=fixture();outside.send({...data,bounds:{...bounds,minLat:18}});await settle();assert.equal(outside.state.osmOK,false,'Never use a snapshot outside its covered area');
 const invalid=fixture({snapshotResponse:response({...snapshot,elements:[]})});invalid.send(data);await settle();assert.equal(invalid.state.osmOK,false,'No invented roads on malformed/empty snapshot');
 const old=deferred(),stale=fixture({snapshotResponse:old.promise});stale.send(data);stale.send({...data,bounds:{...bounds,minLat:18}});old.resolve(response(snapshot));await settle();assert.equal(stale.state.osmOK,false,'Late results for old bounds cannot enable a different area');
 console.log('PASS: real OSM snapshot cold start; live/cache precedence; metadata/restrictions; failed/delayed refresh; retry coalescing; geometry identity; invalid/out-of-area/stale snapshot rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});

