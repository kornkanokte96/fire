'use strict';
(() => {
  const ROLE_COLOR={RS:'#584f80',FU:'#2e6f5a',RW:'#477aa0',VW:'#6c7d9c',BW:'#8b6e48',AQ:'#b65b33'};
  const matchesPoint=(kind,role)=>window.ForestWatchPointFilters?.matches(kind,role)!==false;
  const llText=coordinate=>Number(coordinate[1]).toFixed(6)+', '+Number(coordinate[0]).toFixed(6)+' (WGS84)';
  const MAJOR=new Set(['motorway','trunk','primary','secondary','tertiary']);
  const TRACK=new Set(['track']);
  const PATH=new Set(['path','footway','steps','cycleway','bridleway']);
  const MOTORABLE=new Set(['motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','living_street','track']);
  const rad=d=>d*Math.PI/180;
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
  const fmt=n=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:1}).format(n);
  function distanceKm(a,b){
    const p1=rad(a[0]),p2=rad(b[0]),dlat=rad(b[0]-a[0]),dlon=rad(b[1]-a[1]);
    const h=Math.sin(dlat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dlon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function key(p){return p[0].toFixed(6)+','+p[1].toFixed(6);}
  class MinHeap{
    constructor(){this.a=[];}
    push(v){const a=this.a;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}
    pop(){const a=this.a;if(!a.length)return null;const r=a[0],last=a.pop();if(a.length){let i=0;while(true){let l=i*2+1,rr=l+1;if(l>=a.length)break;let c=rr<a.length&&a[rr][0]<a[l][0]?rr:l;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return r;}
    get size(){return this.a.length;}
  }
  function roadKind(hw){
    if(MAJOR.has(hw))return 'major';
    if(TRACK.has(hw))return 'track';
    if(PATH.has(hw))return 'path';
    return 'road';
  }
  function accessBlocked(seg){
    const a=(seg.access||'').toLowerCase(),mv=(seg.motorVehicle||'').toLowerCase();
    return ['private','no'].includes(a)||['private','no'].includes(mv);
  }
  function profileAllows(seg,profile){
    const hw=seg.hw;
    if(profile==='foot'){
      const access=(seg.access||'').toLowerCase(),foot=(seg.foot||'').toLowerCase();
      if(['private','no'].includes(foot)||(['private','no'].includes(access)&&!['yes','designated','permissive'].includes(foot)))return false;
      return !['motorway','motorway_link'].includes(hw);
    }
    if(accessBlocked(seg))return false;
    if(profile==='4x4')return MOTORABLE.has(hw)&&!['motorway'].includes(hw);
    return ['trunk','primary','secondary','tertiary','unclassified','residential','service','living_street'].includes(hw) ||
      (hw==='track'&&(['grade1','grade2'].includes(seg.tracktype)||['paved','asphalt','concrete','compacted','fine_gravel','gravel'].includes(seg.surface)));
  }
  function speedKph(seg,profile){
    if(profile==='foot'){
      if(seg.hw==='steps')return 2.2;
      if(PATH.has(seg.hw)||seg.hw==='track')return 3.5;
      return 4.3;
    }
    const speeds={trunk:45,primary:42,secondary:36,tertiary:32,unclassified:24,residential:22,service:16,living_street:12,track:profile==='4x4'?13:9};
    let v=speeds[seg.hw]||14;
    if(['unpaved','ground','dirt','earth','mud','sand'].includes(seg.surface))v*=profile==='4x4'?.82:.55;
    if(['grade4','grade5'].includes(seg.tracktype))v*=.65;
    return Math.max(4,v);
  }
  function buildGraph(segments,profile){
    const nodes=new Map();
    const ensure=p=>{const k=key(p);if(!nodes.has(k))nodes.set(k,{key:k,coord:p,edges:[],major:false});return nodes.get(k);};
    for(const seg of segments){
      if(!profileAllows(seg,profile))continue;
      const a=ensure(seg.a),b=ensure(seg.b),km=distanceKm(seg.a,seg.b),minutes=km/speedKph(seg,profile)*60;
      if(MAJOR.has(seg.hw)){a.major=true;b.major=true;}
      const eAB={to:b.key,km,minutes,seg},eBA={to:a.key,km,minutes,seg};
      const ow=(seg.oneway||'').toLowerCase();
      if(profile==='foot'||!['yes','1','true','-1'].includes(ow)){
        a.edges.push(eAB);b.edges.push(eBA);
      }else if(ow==='-1')b.edges.push(eBA);
      else a.edges.push(eAB);
    }
    return nodes;
  }
  function nearestNode(target,graph){
    let best=null,d=Infinity;
    for(const n of graph.values()){
      const x=distanceKm(target,n.coord);
      if(x<d){d=x;best=n;}
    }
    return {node:best,distanceKm:d};
  }
  function reconstruct(targetKey,prev,graph){
    const keys=[targetKey],edges=[];let cur=targetKey,guard=0;
    while(prev.has(cur)&&guard++<100000){
      const p=prev.get(cur);edges.push(p.edge);cur=p.from;keys.push(cur);
    }
    keys.reverse();edges.reverse();
    return {coords:keys.map(k=>graph.get(k).coord),edges};
  }
  function routeFromMainRoad(graph,targetKey){
    const dist=new Map(),prev=new Map(),heap=new MinHeap();
    for(const [k,n] of graph){if(n.major){dist.set(k,0);heap.push([0,k]);}}
    while(heap.size){
      const [d,k]=heap.pop();if(d!==dist.get(k))continue;
      if(k===targetKey)return reconstruct(targetKey,prev,graph);
      for(const e of graph.get(k).edges){
        const nd=d+e.minutes;
        if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,{from:k,edge:e});heap.push([nd,e.to]);}
      }
    }
    return null;
  }
  function routeBetween(graph,startKey,targetKey){
    const dist=new Map([[startKey,0]]),prev=new Map(),heap=new MinHeap();heap.push([0,startKey]);
    while(heap.size){
      const [d,k]=heap.pop();if(d!==dist.get(k))continue;
      if(k===targetKey)return reconstruct(targetKey,prev,graph);
      for(const e of graph.get(k).edges){
        const nd=d+e.minutes;
        if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,{from:k,edge:e});heap.push([nd,e.to]);}
      }
    }
    return null;
  }
  function routeToMainRoad(graph,startKey){
    const dist=new Map([[startKey,0]]),prev=new Map(),heap=new MinHeap();heap.push([0,startKey]);
    while(heap.size){
      const [d,k]=heap.pop();if(d!==dist.get(k))continue;
      if(k!==startKey&&graph.get(k)?.major)return reconstruct(k,prev,graph);
      for(const e of graph.get(k).edges){
        const nd=d+e.minutes;
        if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,{from:k,edge:e});heap.push([nd,e.to]);}
      }
    }
    return null;
  }
  function walkingApproach(from,target,graph){
    const directKm=distanceKm(from,target),fromNode=graph.get(key(from))||nearestNode(from,graph).node;
    if(!fromNode)return {route:null,connectors:directKm>.015?[[from,target]]:[],offroadKm:directKm,mappedKm:0,mappedMin:0,end:from};
    const candidates=[...graph.values()].map(node=>({node,gap:distanceKm(node.coord,target)})).sort((a,b)=>a.gap-b.gap).slice(0,12);
    const wanted=new Set(candidates.map(candidate=>candidate.node.key)),paths=new Map(),dist=new Map([[fromNode.key,0]]),prev=new Map(),heap=new MinHeap();
    heap.push([0,fromNode.key]);
    while(heap.size&&wanted.size){
      const [minutes,k]=heap.pop();if(minutes!==dist.get(k))continue;
      if(wanted.delete(k))paths.set(k,reconstruct(k,prev,graph));
      for(const edge of graph.get(k).edges){const next=minutes+edge.minutes;if(next<(dist.get(edge.to)??Infinity)){dist.set(edge.to,next);prev.set(edge.to,{from:k,edge});heap.push([next,edge.to]);}}
    }
    let best=null;
    for(const candidate of candidates){
      const route=paths.get(candidate.node.key);if(!route)continue;
      const startGap=distanceKm(from,route.coords[0]),offroadKm=startGap+candidate.gap;
      const mappedKm=route.edges.reduce((sum,e)=>sum+e.km,0),mappedMin=route.edges.reduce((sum,e)=>sum+e.minutes,0);
      // Prefer a real mapped path when it reduces unverified connectors without a disproportionate detour.
      if(mappedKm<=.005||offroadKm>=directKm-.015||mappedKm+offroadKm>Math.max(.1,directKm*3))continue;
      const minutes=mappedMin+offroadKm/3*60;
      if(!best||minutes<best.minutes)best={route,offroadKm,mappedKm,mappedMin,minutes,end:candidate.node.coord,connectors:[...(startGap>.015?[[from,route.coords[0]]]:[]),...(candidate.gap>.015?[[candidate.node.coord,target]]:[])]};
    }
    return best||{route:null,connectors:directKm>.015?[[from,target]]:[],offroadKm:directKm,mappedKm:0,mappedMin:0,end:from};
  }
  function lineFC(segments){
    return {type:'FeatureCollection',features:segments.map((s,i)=>({
      type:'Feature',
      properties:{
        id:i,kind:roadKind(s.hw),hw:s.hw,name:s.name||'',surface:s.surface||'',tracktype:s.tracktype||'',
        access:s.access||'',smoothness:s.smoothness||'',blocked:accessBlocked(s)?1:0
      },
      geometry:{type:'LineString',coordinates:[[s.a[1],s.a[0]],[s.b[1],s.b[0]]]}
    }))};
  }
  function supportFC(points){
    return {type:'FeatureCollection',features:(points||[]).map((p,i)=>({
      type:'Feature',properties:{id:i,kind:p.kind,name:p.name||''},geometry:{type:'Point',coordinates:[p.lon,p.lat]}
    }))};
  }
  function barrierFC(points){
    return {type:'FeatureCollection',features:(points||[]).map((p,i)=>({
      type:'Feature',properties:{id:i,type:p.type,access:p.access||''},geometry:{type:'Point',coordinates:[p.lon,p.lat]}
    }))};
  }
  function nodeFC(result){
    return {type:'FeatureCollection',features:(result?.nodes||[]).filter(n=>matchesPoint('sensor',n.roleCode)).map(n=>({
      type:'Feature',properties:{id:n.id,role:n.roleLabel,roleCode:n.roleCode,phase:n.phase,pkg:n.p.pkg,terrain:n.p.terrainInterpretation,lat:n.p.lat,lon:n.p.lon,elev:n.p.elev,slope:n.p.slope,relief:n.p.relief,utility:Math.round(n.utility||0),color:ROLE_COLOR[n.roleCode]||'#355'},
      geometry:{type:'Point',coordinates:[n.p.lon,n.p.lat]}
    }))};
  }
  function gatewayFC(result){
    return {type:'FeatureCollection',features:(result?.gateways||[]).map((g,i)=>({
      type:'Feature',properties:{id:g.id||('GW-'+(i+1)),score:Math.round(g.score||0)},
      geometry:{type:'Point',coordinates:[g.p.lon,g.p.lat]}
    }))};
  }
  function hotspotFC(data){
    return {type:'FeatureCollection',features:(data.historicalHotspots||[]).filter(()=>matchesPoint('hotspot')).map(h=>({
      type:'Feature',properties:{id:h.id,frp:h.frp,time:h.time,lat:h.lat,lon:h.lon},geometry:{type:'Point',coordinates:[h.lon,h.lat]}
    }))};
  }
  function slopeFC(candidates,bounds){
    const lats=[...new Set(candidates.map(p=>p.lat))].sort((a,b)=>a-b),lons=[...new Set(candidates.map(p=>p.lon))].sort((a,b)=>a-b);
    const dLat=lats.length>1?Math.min(...lats.slice(1).map((v,i)=>v-lats[i])):((bounds.maxLat-bounds.minLat)/10);
    const dLon=lons.length>1?Math.min(...lons.slice(1).map((v,i)=>v-lons[i])):((bounds.maxLon-bounds.minLon)/10);
    return {type:'FeatureCollection',features:candidates.filter(p=>Number.isFinite(p.slope)).map((p,i)=>{
      const a=dLat*.48,b=dLon*.48;
      return {type:'Feature',properties:{id:i,slope:p.slope},geometry:{type:'Polygon',coordinates:[[
        [p.lon-b,p.lat-a],[p.lon+b,p.lat-a],[p.lon+b,p.lat+a],[p.lon-b,p.lat+a],[p.lon-b,p.lat-a]
      ]]}};
    })};
  }
  function emptyFC(){return {type:'FeatureCollection',features:[]};}
  function routeFC(coords){return {type:'FeatureCollection',features:coords?.length>=2?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords.map(p=>[p[1],p[0]])}}]:[]};}
  function connectorFC(parts){return {type:'FeatureCollection',features:parts.flatMap(coords=>routeFC(coords).features)};}
  function pointFC(points){return {type:'FeatureCollection',features:points.map(p=>({type:'Feature',properties:p.properties||{},geometry:{type:'Point',coordinates:[p.coord[1],p.coord[0]]}}))};}
  async function fetchElevations(coords){
    if(!coords.length)return [];
    const sampled=[];
    const step=Math.max(1,Math.ceil(coords.length/80));
    for(let i=0;i<coords.length;i+=step)sampled.push(coords[i]);
    if(sampled[sampled.length-1]!==coords[coords.length-1])sampled.push(coords[coords.length-1]);
    const out=[];
    for(let i=0;i<sampled.length;i+=100){
      const p=sampled.slice(i,i+100);
      const url='https://api.open-meteo.com/v1/elevation?latitude='+encodeURIComponent(p.map(x=>x[0].toFixed(6)).join(','))+'&longitude='+encodeURIComponent(p.map(x=>x[1].toFixed(6)).join(','));
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const r=await fetch(url,{cache:'force-cache',signal:controller.signal});if(!r.ok)throw new Error('elevation '+r.status);
        const j=await r.json();
        if(!Array.isArray(j.elevation)||j.elevation.length!==p.length||!j.elevation.every(Number.isFinite))throw new Error('elevation unavailable');
        out.push(...j.elevation);
      }finally{clearTimeout(timer);}
    }
    return {coords:sampled,elevation:out};
  }
  function profileStats(sample){
    if(!sample?.elevation?.length)return {gain:null,loss:null,maxGrade:null};
    let gain=0,loss=0,maxGrade=0;
    for(let i=1;i<sample.elevation.length;i++){
      const dz=sample.elevation[i]-sample.elevation[i-1],d=distanceKm(sample.coords[i-1],sample.coords[i])*1000;
      if(dz>0)gain+=dz;else loss-=dz;
      if(d>2)maxGrade=Math.max(maxGrade,Math.abs(dz/d*100));
    }
    return {gain,loss,maxGrade};
  }

  const app={map:null,state:null,graph:null,profile:'4x4',manualStart:null,customTarget:null,pickMode:null,currentRoute:null,demSource:null,routeRevision:0,initialized:false,mapReady:false,routeState:'idle',routeMessage:'ยังไม่ได้คำนวณเส้นทาง',existingMarkers:[],flatMap:null,flatLayers:new Map(),chosenBasemap:'satellite',terrainAvailable:true,lastSegments:null,journeyMarkers:[],lastTarget:null,journeyFitIdle:null};

  function setStatus(text,state='ready'){
    const el=document.getElementById('op-status');if(!el)return;el.textContent=text;el.dataset.state=state;
  }
  function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
  function getSnapshot(){
    const copy=value=>value?JSON.parse(JSON.stringify(value)):null;
    const metric=id=>document.getElementById(id)?.textContent||'—';
    const profile=document.getElementById('op-profile')?.value||app.profile;
    return {ready:app.mapReady,target:copy(currentTarget()),currentRoute:copy(app.currentRoute),
      routeStatus:{state:app.routeState,message:app.routeMessage,distance:metric('op-route-distance'),time:metric('op-route-time'),egressTime:metric('op-egress-time'),offroadDistance:metric('op-offroad-distance'),elevationGain:metric('op-elevation-gain'),maxGrade:metric('op-max-grade'),profile:metric('op-route-profile')},
      routingAvailable:!!app.state?.osmOK&&(app.state.osm.segments||[]).some(segment=>profileAllows(segment,profile))};
  }
  function publishRouteUpdate(state=app.routeState,message=app.routeMessage){
    app.routeState=state;app.routeMessage=message;
    window.dispatchEvent(new CustomEvent('wildfire:route-updated',{detail:getSnapshot()}));
  }
  function setRouteStatus(message,state){setStatus(message,state);publishRouteUpdate(state,message);}
  function sourceSet(id,data){
    const s=app.map?.getSource(id);if(s)s.setData(data);
    document.getElementById('operational-3d-map')?.setAttribute('data-'+id+'-feature-count',String(data.features?.length||0));
    if(['sensors','hotspots','route-points'].includes(id))document.getElementById('operational-3d-map')?.setAttribute('data-'+id+'-points',JSON.stringify(data.features.map(f=>({id:f.properties.id,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],roleCode:f.properties.roleCode,kind:f.properties.kind}))));
    if(app.flatMap){
      const old=app.flatLayers.get(id);if(old)app.flatMap.removeLayer(old);
      if(['roads','support','barriers','sensors','gateways','hotspots','route','walk','egress','offroad','route-points'].includes(id)){
        const colors={roads:'#85743a',support:'#4aa6b5',barriers:'#c43f35',route:'#238b54',walk:'#9760c8',egress:'#27a3ca',offroad:'#d39824',sensors:'#477aa0',gateways:'#756144',hotspots:'#d74a34','route-points':'#d74a34'};
        const layer=L.geoJSON(data,{filter:f=>id!=='roads'||(['track','path'].includes(f.properties.kind)?document.getElementById('op-tracks')?.checked!==false:document.getElementById('op-roads')?.checked!==false),style:f=>({color:f.properties.blocked?'#cc3f37':colors[id],weight:id==='roads'?2:4,dashArray:id==='walk'?'3 4':id==='egress'||id==='offroad'||['track','path'].includes(f.properties.kind)?'6 5':null}),pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:7,color:'#fff',weight:2,fillColor:f.properties.color||colors[id],fillOpacity:1}),onEachFeature:(f,layer)=>{if(['sensors','hotspots'].includes(id)){const detail=document.createElement('div');detail.textContent=[f.properties.id,f.properties.role,f.properties.terrain,f.properties.pkg,llText(f.geometry.coordinates)].filter(Boolean).join(' · ');layer.bindPopup(detail);}}});
        const on=['sensors','gateways'].includes(id)?document.getElementById('op-assets')?.checked!==false:['support','barriers'].includes(id)?document.getElementById('op-support')?.checked===true:['route','walk','egress','offroad','route-points'].includes(id)?document.getElementById('op-route-layer')?.checked!==false:true;
        if(on)layer.addTo(app.flatMap);
        app.flatLayers.set(id,layer);
      }
    }
  }
  function visible(id,on){if(app.map?.getLayer(id))app.map.setLayoutProperty(id,'visibility',on?'visible':'none');}
  function clearCoordinateError(kind){
    const error=document.getElementById('op-'+kind+'-coordinate-error');
    if(error){error.textContent='';error.hidden=true;}
    ['lat','lon'].forEach(axis=>document.getElementById('op-'+kind+'-'+axis)?.removeAttribute('aria-invalid'));
  }
  function writeCoordinates(kind,coord){
    ['lat','lon'].forEach((axis,i)=>{
      const field=document.getElementById('op-'+kind+'-'+axis);
      if(field)field.value=coord?String(Number(coord[i].toFixed(6))):'';
    });
    clearCoordinateError(kind);
  }
  function readCoordinates(kind){
    const fields=['lat','lon'].map(axis=>document.getElementById('op-'+kind+'-'+axis));
    const values=fields.map(f=>f.value.trim()===''?NaN:Number(f.value));
    const invalid=values.map((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i===0?90:180));
    clearCoordinateError(kind);
    if(invalid.some(Boolean)){
      const error=document.getElementById('op-'+kind+'-coordinate-error');
      error.textContent='กรอกพิกัดให้ครบ: Latitude −90 ถึง 90 และ Longitude −180 ถึง 180 เป็นองศาทศนิยม';error.hidden=false;
      fields.forEach((f,i)=>{if(invalid[i])f.setAttribute('aria-invalid','true');});
      fields[invalid.indexOf(true)].focus();return null;
    }
    return values;
  }
  function clearRoute(){
    app.routeRevision++;app.currentRoute=null;
    if(app.journeyFitIdle){app.map?.off?.('idle',app.journeyFitIdle);app.journeyFitIdle=null;}
    ['route','walk','egress','offroad','route-points'].forEach(id=>sourceSet(id,emptyFC()));
    app.journeyMarkers.forEach(item=>item.marker.remove());app.journeyMarkers=[];
    const journey=document.getElementById('op-journey');if(journey){journey.replaceChildren();journey.hidden=true;}
    ['op-route-distance','op-route-time','op-egress-time','op-offroad-distance','op-elevation-gain','op-max-grade','op-route-profile','op-route-surface'].forEach(id=>setText(id,'—'));
    publishRouteUpdate('idle','ยังไม่ได้คำนวณเส้นทาง');
  }
  function showChosenPoints(){
    const target=currentTarget(),points=[];
    if(app.manualStart)points.push({coord:app.manualStart,properties:{kind:'start'}});
    if(target)points.push({coord:[target.lat,target.lon],properties:{kind:'target'}});
    sourceSet('route-points',pointFC(points));
    syncLayerToggles();
  }
  function setCoordinatePoint(kind,coord){
    if(!Array.isArray(coord)||coord.length!==2||!coord.every(Number.isFinite)||Math.abs(coord[0])>90||Math.abs(coord[1])>180)return false;
    app.pickMode=null;writeCoordinates(kind,coord);
    if(kind==='start'){
      app.manualStart=coord;
      setText('op-start-mode','จุดเริ่มต้นการเดินทาง · '+coord[0].toFixed(6)+', '+coord[1].toFixed(6));
    }else{
      app.customTarget=coord;document.getElementById('op-target').value='CUSTOM';
    }
    clearRoute();
    showChosenPoints();
    if(kind==='target')notifyTargetChanged();
    setStatus(kind==='start'?'กำหนดพิกัดจุดเริ่มแล้ว · กดคำนวณเส้นทาง':'กำหนดพิกัดจุดไฟแล้ว · กดคำนวณเส้นทาง','ready');
    return true;
  }
  function notifyTargetChanged(){
    const target=currentTarget(),previous=app.lastTarget;
    if(previous?.id===target?.id&&previous?.lat===target?.lat&&previous?.lon===target?.lon&&previous?.type===target?.type)return;
    app.lastTarget=target?{...target}:null;
    window.dispatchEvent(new CustomEvent('wildfire:target-changed',{detail:{target:app.lastTarget,coordinate:target?[target.lat,target.lon]:null}}));
  }
  const journeySVG={
    car:'<svg viewBox="0 0 32 24" aria-hidden="true"><path d="m6 9 3-6h14l3 6 3 2v7H3v-7Z"/><path d="M8 9h16M7 14h3m12 0h3"/><circle cx="8" cy="19" r="3"/><circle cx="24" cy="19" r="3"/></svg>',
    person:'<svg viewBox="0 0 24 32" aria-hidden="true"><circle cx="13" cy="5" r="3"/><path d="m8 12 5-3 4 6 4 1M13 10l-2 10 6 10m-6-10-6 10M8 12l-4 7"/></svg>'
  };
  function journeyViewPadding(){
    const container=app.map?.getContainer?.()||document.getElementById('operational-3d-map');
    const width=container?.clientWidth||800,height=container?.clientHeight||680;
    const legend=document.querySelector?.('#operational-3d .op-map-key');
    const legendHeight=legend?.getBoundingClientRect?.().height||legend?.offsetHeight||84;
    return {width,height,padding:{top:Math.min(105,height*.20),right:Math.min(72,width*.18),bottom:Math.min(legendHeight+55,height*.35),left:Math.min(72,width*.18)}};
  }
  function groundedJump(options){
    const map=app.map;if(!map)return;
    map.setCenterClampedToGround?.(true);
    const elevation=map.queryTerrainElevation?.(options.center);
    const camera={...options,padding:{top:0,right:0,bottom:0,left:0},...(Number.isFinite(elevation)?{elevation}:{})};
    if(map.jumpTo)map.jumpTo(camera);else map.easeTo({...camera,duration:0});
  }
  function fitJourneyView(coords,focusCoord=null){
    const points=coords.filter(p=>Array.isArray(p)&&p.every(Number.isFinite));if(!points.length)return;
    const view=journeyViewPadding();
    const flatPoints=focusCoord?[...points,...points.map(p=>[2*focusCoord[0]-p[0],2*focusCoord[1]-p[1]])]:points;
    if(app.flatMap)app.flatMap.fitBounds(L.latLngBounds(flatPoints),{paddingTopLeft:[view.padding.left,view.padding.top],paddingBottomRight:[view.padding.right,view.padding.bottom],maxZoom:14});
    const map=app.map;if(!map)return;
    const bounds=[[Math.min(...points.map(p=>p[1])),Math.min(...points.map(p=>p[0]))],[Math.max(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0]))]];
    map.stop?.();map.setPadding?.({top:0,right:0,bottom:0,left:0});
    const camera=map.cameraForBounds?.(bounds,{padding:view.padding,maxZoom:13,bearing:0});
    if(!camera){map.fitBounds(bounds,{padding:view.padding,maxZoom:12.25,pitch:35,bearing:0,duration:0});return;}
    if(focusCoord)camera.center=[focusCoord[1],focusCoord[0]];
    // MapLibre 5.6.2 fits a flat Mercator box; leave extra room before applying pitch and terrain.
    let zoom=Math.min(13,camera.zoom-.75),pitch=40;
    const frame=()=>groundedJump({center:camera.center,zoom,pitch,bearing:0});
    const fits=()=>!map.project||points.every(coord=>{
      const p=map.project([coord[1],coord[0]]);
      return Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=view.padding.left&&p.x<=view.width-view.padding.right&&p.y>=view.padding.top&&p.y<=view.height-view.padding.bottom;
    });
    const verify=()=>{
      for(let attempt=0;attempt<4&&!fits();attempt++){zoom=Math.max(map.getMinZoom?.()||0,zoom-.5);if(attempt>=2)pitch=25;frame();}
      if(!fits()){pitch=0;frame();for(let attempt=0;attempt<2&&!fits();attempt++){zoom=Math.max(map.getMinZoom?.()||0,zoom-.5);frame();}}
      document.getElementById('operational-3d-map')?.setAttribute('data-route-camera-verified',String(fits()));
    };
    frame();verify();
    if(app.journeyFitIdle)map.off?.('idle',app.journeyFitIdle);
    const revision=app.routeRevision,center=map.getCenter?.(),framedZoom=map.getZoom?.();
    app.journeyFitIdle=()=>{
      map.off?.('idle',app.journeyFitIdle);app.journeyFitIdle=null;
      const current=map.getCenter?.();
      if(revision!==app.routeRevision||map.isMoving?.()||!center||!current||distanceKm([center.lat,center.lng],[current.lat,current.lng])>.3||Math.abs((map.getZoom?.()||0)-framedZoom)>.35)return;
      verify();
    };
    map.once?.('idle',app.journeyFitIdle);
  }
  function focusJourneyPoint(coord){
    if(app.journeyFitIdle){app.map?.off?.('idle',app.journeyFitIdle);app.journeyFitIdle=null;}
    if(app.currentRoute?.frameCoords){fitJourneyView(app.currentRoute.frameCoords,coord);return;}
    app.map?.stop?.();groundedJump({center:[coord[1],coord[0]],zoom:13,pitch:40,bearing:0});
    if(app.flatMap)app.flatMap.setView(coord,14);
  }
  function makeJourneyButton(kind,label,coord){
    const button=document.createElement('button');button.type='button';button.className='op-journey-marker op-journey-marker--'+kind;
    button.innerHTML=kind==='handoff'?journeySVG.car+journeySVG.person:journeySVG[kind==='car'?'car':'person'];
    button.setAttribute('aria-label',label+' · Latitude '+coord[0].toFixed(6)+' · Longitude '+coord[1].toFixed(6));
    button.title=label;button.dataset.journeyKind=kind;button.dataset.lat=coord[0];button.dataset.lon=coord[1];
    return button;
  }
  function showJourneyMarkers(journey){
    const points=[];
    if(journey.profile==='foot')points.push({kind:'person',label:'จุดเริ่มเดินเท้า',coord:journey.start});
    else{
      if(journey.startGap>.015)points.push({kind:'person',label:'จุดเริ่มเดินไปยังรถบนถนน',coord:journey.start});
      points.push({kind:'car',label:'จุดเริ่มขับรถบนถนน',coord:journey.startGap>.015?journey.roadStart:journey.start});
      points.push({kind:'handoff',label:'จุดจอดรถและเริ่มเดินต่อ',coord:journey.handoff});
    }
    points.push({kind:'target',label:'เป้าหมายปลายทางเดินเท้า',coord:journey.targetCoord});
    for(const point of points){
      const button=makeJourneyButton(point.kind,point.label,point.coord);
      let marker,element=button;
      if(app.map)marker=new maplibregl.Marker({element:button,anchor:'bottom'}).setLngLat([point.coord[1],point.coord[0]]).addTo(app.map);
      else if(app.flatMap){
        marker=L.marker(point.coord,{icon:L.divIcon({className:'op-journey-leaflet',html:button.outerHTML,iconSize:[point.kind==='handoff'?68:42,42],iconAnchor:[point.kind==='handoff'?34:21,42]}),keyboard:false}).addTo(app.flatMap);
        element=marker.getElement();
      }
      if(!marker)continue;
      const clickable=element===button?button:element.querySelector('button');
      clickable?.addEventListener('click',event=>{event.stopPropagation();focusJourneyPoint(point.coord);});
      app.journeyMarkers.push({marker,element});
    }
  }
  function renderJourney(journey){
    const container=document.getElementById('op-journey');if(!container)return;
    container.replaceChildren();container.hidden=false;
    const title=document.createElement('h4');title.textContent='ลำดับการเดินทาง';container.append(title);
    const summary=document.createElement('div');summary.className='op-journey-summary';
    const metric=(label,km,minutes)=>{const item=document.createElement('p'),name=document.createElement('span'),value=document.createElement('strong');name.textContent=label;value.textContent=fmt(km)+' กม. · '+Math.round(minutes)+' นาที';item.append(name,value);summary.append(item);};
    if(journey.profile!=='foot')metric('ขับรถ',journey.driveKm,journey.driveMin);
    metric('เดินเท้ารวม',journey.walkKm,journey.walkMin);container.append(summary);
    const list=document.createElement('ol');list.className='op-journey-steps';
    const step=(label,detail)=>{const li=document.createElement('li'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=label;small.textContent=detail;li.append(strong,small);list.append(li);return li;};
    if(journey.profile!=='foot'){
      if(journey.startGap>.015)step('เดินจากจุดเริ่มไปยังรถบนถนน',fmt(journey.startGap)+' กม. · เส้นเชื่อมนอกทางโดยประมาณ');
      step('ขับรถตามถนน / track ที่ใช้ได้',fmt(journey.driveKm)+' กม. · '+Math.round(journey.driveMin)+' นาที');
      const handoff=step('จอดรถและเริ่มเดินต่อ','');
      const focus=document.createElement('button');focus.type='button';focus.className='op-journey-focus';focus.textContent='Latitude '+journey.handoff[0].toFixed(6)+' · Longitude '+journey.handoff[1].toFixed(6);focus.setAttribute('aria-label','แสดงจุดจอดรถและเริ่มเดินบนแผนที่');focus.addEventListener('click',()=>focusJourneyPoint(journey.handoff));handoff.append(focus);
    }
    if(journey.mappedWalkKm>.005)step('เดินตามเส้นทางที่บันทึกใน OSM',fmt(journey.mappedWalkKm)+' กม. · '+Math.round(journey.mappedWalkMin)+' นาที');
    if(journey.targetOffroadKm>.015||journey.profile==='foot'&&journey.startGap>.015)step('เดินช่วงนอกทางไปยังเป้าหมาย',fmt(journey.targetOffroadKm+(journey.profile==='foot'?journey.startGap:0))+' กม. · เส้นเชื่อมประมาณ ไม่ใช่ทางเดินที่ยืนยันแล้ว');
    step('ถึงเป้าหมาย',journey.targetCoord[0].toFixed(6)+', '+journey.targetCoord[1].toFixed(6)+' (Latitude, Longitude)');
    container.append(list);
  }
  function randomizeFireTarget(){
    const bounds=app.state?.data?.bounds;
    if(!bounds||!['minLat','maxLat','minLon','maxLon'].every(k=>Number.isFinite(bounds[k]))||
       bounds.minLat>=bounds.maxLat||bounds.minLon>=bounds.maxLon||bounds.minLat<-90||bounds.maxLat>90||bounds.minLon<-180||bounds.maxLon>180){
      setStatus('ยังไม่มีขอบเขตพื้นที่วางแผนสำหรับสุ่มจุดไฟ','error');return null;
    }
    const latSpan=bounds.maxLat-bounds.minLat,lonSpan=bounds.maxLon-bounds.minLon;
    const latitude=Math.random(),longitude=Math.random();
    const sampleLat=fraction=>Number((bounds.minLat+latSpan*(.05+.90*fraction)).toFixed(6));
    const coord=[sampleLat(latitude),Number((bounds.minLon+lonSpan*(.05+.90*longitude)).toFixed(6))];
    if(app.customTarget?.[0]===coord[0]&&app.customTarget?.[1]===coord[1])coord[0]=sampleLat((latitude+.5)%1);
    setCoordinatePoint('target',coord);
    app.map?.easeTo?.({center:[coord[1],coord[0]],duration:550});
    app.flatMap?.panTo?.(coord);
    setStatus('สุ่มพิกัดจุดไฟสำหรับเดโมแล้ว · กดคำนวณเส้นทาง','ready');
    return coord;
  }
  function currentTarget(){
    const sel=document.getElementById('op-target')?.value||'H-01';
    if(sel==='CUSTOM')return app.customTarget?{id:'Custom fire point',lat:app.customTarget[0],lon:app.customTarget[1],type:'fire'}:null;
    if(!app.state)return null;
    if(sel.startsWith('H-')){
      const h=app.state.data.historicalHotspots.find(x=>x.id===sel);return h?{id:h.id,lat:h.lat,lon:h.lon,type:'fire'}:null;
    }
    if(sel.startsWith('N')){
      const n=app.state.result.nodes.find(n=>n.id===sel);return n?{id:n.id,lat:n.p.lat,lon:n.p.lon,type:'sensor'}:null;
    }
    return null;
  }
  function populateTargets(){
    const sel=document.getElementById('op-target');if(!sel)return;
    const old=sel.value;
    sel.innerHTML='';
    for(const h of app.state.data.historicalHotspots||[]){
      const o=document.createElement('option');o.value=h.id;o.textContent=h.id+' · Historical fire / hotspot';sel.appendChild(o);
    }
    (app.state.result.nodes||[]).forEach(n=>{
      const o=document.createElement('option');o.value=n.id;o.textContent=n.id+' · '+n.roleLabel;sel.appendChild(o);
    });
    const custom=document.createElement('option');custom.value='CUSTOM';custom.textContent='Custom fire point · กรอกพิกัดหรือคลิกบนแผนที่';sel.appendChild(custom);
    if([...sel.options].some(o=>o.value===old))sel.value=old;
    if(sel.value!==old){const target=currentTarget();writeCoordinates('target',target?[target.lat,target.lon]:null);}
  }
  function changeTarget(){
    app.pickMode=null;clearRoute();const target=currentTarget();writeCoordinates('target',target?[target.lat,target.lon]:null);showChosenPoints();
    notifyTargetChanged();
    setStatus(target?'เลือกเป้าหมายแล้ว · กดคำนวณเส้นทาง':'กรอกพิกัดจุดไฟแล้วกดใช้พิกัด หรือกดกำหนดจุดไฟบนแผนที่','ready');
  }
  function selectHistoricalTarget(id){
    const select=document.getElementById('op-target');
    if(!select||!app.state?.data.historicalHotspots?.some(point=>point.id===id)||![...select.options].some(option=>option.value===id))return false;
    select.value=id;changeTarget();return true;
  }
  function focusTarget(){
    const target=currentTarget();if(!app.mapReady||!target)return false;
    if(!app.currentRoute)showChosenPoints();
    focusJourneyPoint([target.lat,target.lon]);return true;
  }
  function updateOperationalData(state){
    const previousTarget=app.state?currentTarget():null;
    const networkChanged=app.lastSegments!==state.osm.segments;
    app.lastSegments=state.osm.segments;
    app.state=state;populateTargets();
    const target=currentTarget();
    if(previousTarget?.lat!==target?.lat || previousTarget?.lon!==target?.lon){
      clearRoute();writeCoordinates('target',target?[target.lat,target.lon]:null);showChosenPoints();
    }
    notifyTargetChanged();
    if(networkChanged&&app.currentRoute){clearRoute();showChosenPoints();setStatus('ข้อมูลถนนอัปเดตแล้ว · กดคำนวณเส้นทางใหม่','ready');}
    sourceSet('roads',lineFC(state.osm.segments||[]));
    sourceSet('support',supportFC(state.osm.support||[]));
    sourceSet('barriers',barrierFC(state.osm.barriers||[]));
    sourceSet('sensors',nodeFC(state.result));
    sourceSet('gateways',gatewayFC(state.result));
    sourceSet('hotspots',hotspotFC(state.data));
    sourceSet('slope-screen',slopeFC(state.candidates,state.data.bounds));
    if(app.map){app.existingMarkers.forEach(marker=>marker.remove());
    app.existingMarkers=(state.data.existing||[]).map(sensor=>{
      const label=document.createElement('span');label.className='map-sensor existing';label.textContent=sensor.id;label.title=sensor.note;
      const detail=document.createElement('div');detail.textContent=sensor.id+' · เซ็นเซอร์เดิม · '+sensor.note;
      label.dataset.siteId=sensor.id;label.dataset.lat=sensor.lat;label.dataset.lon=sensor.lon;label.dataset.roleCode='EX';
      label.style.display=document.getElementById('op-assets')?.checked===false||!matchesPoint('sensor','EX')?'none':'';
      return new maplibregl.Marker({element:label}).setLngLat([sensor.lon,sensor.lat]).setPopup(new maplibregl.Popup({maxWidth:'300px'}).setDOMContent(detail)).addTo(app.map);
    });}
    setText('op-road-count',(state.osm.segments||[]).length.toLocaleString('th-TH'));
    setText('op-support-count',(state.osm.support||[]).length.toLocaleString('th-TH'));
    setText('op-barrier-count',(state.osm.barriers||[]).length.toLocaleString('th-TH'));
    setText('op-route-data',state.osmOK?(['cache','snapshot'].includes(state.provenance?.roads?.source)?'OSM ที่บันทึกไว้ · '+new Date(state.provenance.roads.savedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'OSM routing graph ready'):'กำลังโหลดหรือไม่พร้อม · ยังไม่คำนวณเส้นทาง');
    syncLayerToggles();
    window.dispatchEvent(new CustomEvent('wildfire:data-updated',{detail:{state:app.state}}));
  }

  function createMap(state){
    if(!window.maplibregl){createFlatMap(state);return;}
    const el=document.getElementById('operational-3d-map');if(!el)return;
    const demUrl='https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
    let contourReady=!!window.mlcontour;
    let dem=null,terrainTiles=[demUrl],contourTiles=null;
    try { if(contourReady){
      dem=new mlcontour.DemSource({url:demUrl,encoding:'terrarium',maxzoom:13,worker:true,cacheSize:140,timeoutMs:10000});
      dem.setupMaplibre(maplibregl);app.demSource=dem;
      contourTiles=[dem.contourProtocolUrl({multiplier:1,thresholds:{10:[100,500],11:[100,500],12:[50,200],13:[25,100],14:[20,100],15:[10,50]},elevationKey:'ele',levelKey:'level',contourLayer:'contours'})];
    } } catch (err) { contourReady=false; contourTiles=null; }
    const b=state.data.bounds,c=state.data.center;
    const style={
      version:8,
      glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources:{
        satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Esri World Imagery'},
        topo:{type:'raster',tiles:['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:17,attribution:'OpenTopoMap / OpenStreetMap contributors'},
        'street-fallback':{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'OpenStreetMap contributors'},
        'terrain-dem':{type:'raster-dem',encoding:'terrarium',tiles:terrainTiles,maxzoom:13,tileSize:256},
        'hillshade-dem':{type:'raster-dem',encoding:'terrarium',tiles:[demUrl],maxzoom:13,tileSize:256},
        ...(contourReady?{contours:{type:'vector',tiles:contourTiles,maxzoom:15}}:{}),
        roads:{type:'geojson',data:lineFC(state.osm.segments||[])},
        support:{type:'geojson',data:supportFC(state.osm.support||[])},
        barriers:{type:'geojson',data:barrierFC(state.osm.barriers||[])},
        sensors:{type:'geojson',data:nodeFC(state.result)},
        gateways:{type:'geojson',data:gatewayFC(state.result)},
        hotspots:{type:'geojson',data:hotspotFC(state.data)},
        'slope-screen':{type:'geojson',data:slopeFC(state.candidates,b)},
        route:{type:'geojson',data:emptyFC()},
        walk:{type:'geojson',data:emptyFC()},
        egress:{type:'geojson',data:emptyFC()},
        offroad:{type:'geojson',data:emptyFC()},
        'route-points':{type:'geojson',data:emptyFC()}
      },
      layers:[
        {id:'background',type:'background',paint:{'background-color':'#dce8da'}},
        {id:'satellite',type:'raster',source:'satellite',paint:{'raster-saturation':-.12,'raster-contrast':.08,'raster-brightness-max':.93}},
        {id:'topo',type:'raster',source:'topo',layout:{visibility:'none'},paint:{'raster-opacity':.95}},
        {id:'street-fallback',type:'raster',source:'street-fallback',layout:{visibility:'none'}},
        {id:'hillshade',type:'hillshade',source:'hillshade-dem',paint:{'hillshade-exaggeration':.48,'hillshade-shadow-color':'#27342c','hillshade-highlight-color':'#f4eedf','hillshade-accent-color':'#566c5c'}},
        {id:'slope-screen',type:'fill',source:'slope-screen',layout:{visibility:'none'},paint:{'fill-color':['interpolate',['linear'],['get','slope'],15,'#f2e6a6',25,'#dc954d',35,'#b84a36',45,'#7d2633'],'fill-opacity':['interpolate',['linear'],['get','slope'],15,0,25,.16,35,.30,45,.42]}},
        ...(contourReady?[{id:'contour-minor',type:'line',source:'contours','source-layer':'contours',paint:{'line-color':'rgba(241,232,204,.62)','line-width':['match',['get','level'],1,1.25,.55]}}]:[]),
        {id:'roads-casing',type:'line',source:'roads',filter:['in',['get','kind'],['literal',['major','road']]],paint:{'line-color':'rgba(30,35,32,.82)','line-width':['match',['get','kind'],'major',6,4]}},
        {id:'roads',type:'line',source:'roads',filter:['in',['get','kind'],['literal',['major','road']]],paint:{'line-color':['match',['get','kind'],'major','#f7d36d','#f4f0e6'],'line-width':['match',['get','kind'],'major',3.8,2.3]}},
        {id:'tracks',type:'line',source:'roads',filter:['==',['get','kind'],'track'],paint:{'line-color':'#e4a556','line-width':2.2,'line-dasharray':[2,1.5]}},
        {id:'paths',type:'line',source:'roads',filter:['==',['get','kind'],'path'],paint:{'line-color':'#d8d1bd','line-width':1.5,'line-dasharray':[1,2]}},
        {id:'blocked-access',type:'line',source:'roads',filter:['==',['get','blocked'],1],paint:{'line-color':'#cc3f37','line-width':3,'line-dasharray':[1,1]}},
        {id:'support',type:'circle',source:'support',paint:{'circle-radius':5,'circle-color':'#4aa6b5','circle-stroke-width':2,'circle-stroke-color':'#fff'}},
        {id:'barriers',type:'circle',source:'barriers',paint:{'circle-radius':4,'circle-color':'#c43f35','circle-stroke-width':1.5,'circle-stroke-color':'#fff'}},
        {id:'hotspots',type:'circle',source:'hotspots',paint:{'circle-radius':8,'circle-color':'#d74a34','circle-stroke-width':3,'circle-stroke-color':'#ffd47a'}},
        {id:'sensors',type:'circle',source:'sensors',paint:{'circle-radius':6,'circle-color':['get','color'],'circle-stroke-width':2,'circle-stroke-color':'#fff'}},
        {id:'gateways',type:'circle',source:'gateways',paint:{'circle-radius':8,'circle-color':'#5e533b','circle-stroke-width':3,'circle-stroke-color':'#f1d187'}},
        {id:'route-casing',type:'line',source:'route',paint:{'line-color':'#171d1a','line-width':7,'line-opacity':.88}},
        {id:'route',type:'line',source:'route',paint:{'line-color':'#67e39c','line-width':4.4}},
        {id:'walk-casing',type:'line',source:'walk',paint:{'line-color':'#30283c','line-width':6,'line-opacity':.9}},
        {id:'walk',type:'line',source:'walk',paint:{'line-color':'#c291f1','line-width':3.8,'line-dasharray':[2,1]}},
        {id:'egress-casing',type:'line',source:'egress',paint:{'line-color':'#17202a','line-width':6,'line-opacity':.82}},
        {id:'egress',type:'line',source:'egress',paint:{'line-color':'#64c8e8','line-width':3.2,'line-dasharray':[2,1]}},
        {id:'offroad',type:'line',source:'offroad',paint:{'line-color':'#f7ca5d','line-width':3,'line-dasharray':[2,1.5]}},
        {id:'route-points',type:'circle',source:'route-points',paint:{'circle-radius':['match',['get','kind'],'start',7,'target',9,6],'circle-color':['match',['get','kind'],'start','#55b87b','target','#df493d','#fff'],'circle-stroke-width':3,'circle-stroke-color':'#fff'}}
      ]
    };
    const map=new maplibregl.Map({
      container:el,style,center:[c[1],c[0]],zoom:12.25,pitch:58,bearing:-26,maxPitch:82,antialias:true,hash:false
    });
    app.map=map;
    map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
    map.addControl(new maplibregl.ScaleControl({maxWidth:120,unit:'metric'}),'bottom-right');
    map.on('style.load',()=>{
      try{map.setTerrain({source:'terrain-dem',exaggeration:1.5});}catch(_){app.terrainAvailable=false;}
      setStatus(contourReady?'3D terrain พร้อม · Satellite + hillshade + contour + OSM access network':'3D terrain พร้อม · contour engine ไม่พร้อม จึงแสดง terrain + hillshade + access network แทน','ready');
      updateOperationalData(app.state);
      bindMapInteractions();
      applyMode('terrain');
      el.dataset.mapReady='true';
      app.mapReady=true;
      window.dispatchEvent(new CustomEvent('wildfire:map-ready',{detail:{map:app.map,flatMap:app.flatMap}}));
    });
    map.on('error',e=>{
      const source=e.sourceId;
      if(source==='terrain-dem'||source==='hillshade-dem'){
        app.terrainAvailable=false;map.setTerrain(null);visible('hillshade',false);visible('contour-minor',false);
        setStatus('แผนที่พร้อม · ข้อมูลความสูงไม่พร้อม จึงแสดงพื้นแผนที่และจุดเซ็นเซอร์ก่อน','ready');
      }else if(source==='contours'){
        visible('contour-minor',false);setStatus('แผนที่พร้อม · เส้นชั้นความสูงไม่พร้อม','ready');
      }else if(source===app.chosenBasemap){
        visible('satellite',false);visible('topo',false);visible('street-fallback',true);
        setStatus('แผนที่พร้อม · ใช้ OpenStreetMap ระหว่างที่ภาพพื้นแผนที่ไม่พร้อม','ready');
      }
    });
    if(window.ResizeObserver){const ro=new ResizeObserver(()=>map.resize());ro.observe(el);}
  }

  function createFlatMap(state){
    const el=document.getElementById('operational-3d-map');if(!el||!window.L)return;
    el.replaceChildren();const b=state.data.bounds;
    app.flatMap=L.map(el).fitBounds([[b.minLat,b.minLon],[b.maxLat,b.maxLon]]);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'OpenStreetMap contributors'}).addTo(app.flatMap);
    app.existingMarkers=(state.data.existing||[]).map(sensor=>{
      const label=document.createElement('span');label.className='map-sensor existing';label.textContent=sensor.id;
      label.dataset.siteId=sensor.id;label.dataset.lat=sensor.lat;label.dataset.lon=sensor.lon;label.dataset.roleCode='EX';
      return L.marker([sensor.lat,sensor.lon],{icon:L.divIcon({className:'plan-leaflet-icon',html:label.outerHTML,iconSize:[34,34],iconAnchor:[17,17]})}).addTo(app.flatMap).bindPopup(sensor.id+' · '+sensor.note+' · '+sensor.lat.toFixed(6)+', '+sensor.lon.toFixed(6));
    });
    app.flatMap.on('click',e=>{if(app.pickMode)setCoordinatePoint(app.pickMode,[e.latlng.lat,((e.latlng.lng+180)%360+360)%360-180]);});
    ['sensors','gateways','hotspots'].forEach(id=>sourceSet(id,id==='sensors'?nodeFC(state.result):id==='gateways'?gatewayFC(state.result):hotspotFC(state.data)));
    updateOperationalData(state);
    el.dataset.mapReady='fallback';
    app.mapReady=true;
    setStatus('อุปกรณ์นี้เปิด 3D ไม่ได้ · แสดงแผนที่ 2D และยังกรอกพิกัด/คำนวณเส้นทางได้','ready');
    window.dispatchEvent(new CustomEvent('wildfire:map-ready',{detail:{map:app.map,flatMap:app.flatMap}}));
  }

  function setBasemap(which){
    app.chosenBasemap=which;visible('street-fallback',false);
    visible('satellite',which==='satellite');visible('topo',which==='topo');
    document.querySelectorAll('[data-basemap]').forEach(b=>b.classList.toggle('active',b.dataset.basemap===which));
  }
  function applyMode(mode){
    document.querySelectorAll('[data-op-mode]').forEach(b=>b.classList.toggle('active',b.dataset.opMode===mode));
    const c=document.getElementById('op-contours'),h=document.getElementById('op-hillshade'),sl=document.getElementById('op-slope'),r=document.getElementById('op-roads'),t=document.getElementById('op-tracks'),sup=document.getElementById('op-support');
    if(mode==='terrain'){if(c)c.checked=true;if(h)h.checked=true;if(sl)sl.checked=false;if(r)r.checked=true;if(t)t.checked=true;if(sup)sup.checked=false;app.map?.easeTo({pitch:65,bearing:-28,duration:650});}
    if(mode==='access'){if(c)c.checked=true;if(h)h.checked=true;if(sl)sl.checked=false;if(r)r.checked=true;if(t)t.checked=true;if(sup)sup.checked=true;app.map?.easeTo({pitch:48,bearing:0,duration:650});}
    if(mode==='suppression'){if(c)c.checked=true;if(h)h.checked=true;if(sl)sl.checked=true;if(r)r.checked=true;if(t)t.checked=true;if(sup)sup.checked=true;app.map?.easeTo({pitch:57,bearing:-18,duration:650});}
    syncLayerToggles();
  }
  function syncLayerToggles(){
    if(app.state){sourceSet('sensors',nodeFC(app.state.result));sourceSet('hotspots',hotspotFC(app.state.data));}
    if(app.flatMap&&app.state)sourceSet('roads',lineFC(app.state.osm.segments||[]));
    visible('contour-minor',document.getElementById('op-contours')?.checked!==false);
    visible('hillshade',app.terrainAvailable&&document.getElementById('op-hillshade')?.checked!==false);
    visible('slope-screen',document.getElementById('op-slope')?.checked===true);
    const roads=document.getElementById('op-roads')?.checked!==false;
    visible('roads-casing',roads);visible('roads',roads);visible('blocked-access',roads);
    const tracks=document.getElementById('op-tracks')?.checked!==false;
    visible('tracks',tracks);visible('paths',tracks);
    const sup=document.getElementById('op-support')?.checked===true&&matchesPoint('support');
    visible('support',sup);visible('barriers',sup);
    const assets=document.getElementById('op-assets')?.checked!==false;
    visible('sensors',assets);visible('gateways',assets&&matchesPoint('gateway'));visible('hotspots',matchesPoint('hotspot'));
    app.existingMarkers.forEach(marker=>marker.getElement().style.display=assets&&matchesPoint('sensor','EX')?'':'none');
    const route=document.getElementById('op-route-layer')?.checked!==false;
    const chosenPoints=route&&(matchesPoint('route-point')||document.getElementById('op-target')?.value==='CUSTOM');
    visible('route-casing',route);visible('route',route);visible('walk-casing',route);visible('walk',route);visible('egress-casing',route);visible('egress',route);visible('offroad',route);visible('route-points',chosenPoints);
    app.journeyMarkers.forEach(item=>{item.element.style.display=chosenPoints?'':'none';});
    document.getElementById('operational-3d-map')?.setAttribute('data-route-points-visible',String(chosenPoints));
    if(app.flatMap){
      for(const [id,layer] of app.flatLayers){
        const on=id==='sensors'?assets:id==='gateways'?assets&&matchesPoint('gateway'):id==='hotspots'?matchesPoint('hotspot'):['support','barriers'].includes(id)?sup:id==='route-points'?chosenPoints:['route','walk','egress','offroad'].includes(id)?route:true;
        if(on&&!app.flatMap.hasLayer(layer))layer.addTo(app.flatMap);else if(!on&&app.flatMap.hasLayer(layer))app.flatMap.removeLayer(layer);
      }
    }
    if(app.state){
      const sensorCount=assets?nodeFC(app.state.result).features.length+(app.state.data.existing||[]).filter(()=>matchesPoint('sensor','EX')).length:0;
      const hotspotCount=hotspotFC(app.state.data).features.length;
      setText('op-point-count',(sensorCount+hotspotCount)+' จุด · Sensor '+sensorCount+' · Hotspot '+hotspotCount);
      document.getElementById('operational-3d-map')?.setAttribute('data-existing-visible-count',String(assets&&matchesPoint('sensor','EX')?(app.state.data.existing||[]).length:0));
    }
  }

  function popupFeature(e){
    const fs=app.map.queryRenderedFeatures(e.point,{layers:['roads','tracks','paths','blocked-access','support','barriers','hotspots','sensors','gateways']});
    if(!fs.length)return;
    const f=fs[0],p=f.properties||{},box=document.createElement('div');
    const title=document.createElement('b'),body=document.createElement('div');
    title.textContent=p.id||p.name||p.kind||p.hw||'Map feature';
    const bits=[];
    if(p.hw)bits.push('ประเภท '+p.hw);
    if(p.surface)bits.push('surface '+p.surface);
    if(p.tracktype)bits.push('track '+p.tracktype);
    if(p.access)bits.push('access '+p.access);
    if(p.role)bits.push('role '+p.role);
    if(p.terrain)bits.push(p.terrain);
    if(p.pkg)bits.push(p.pkg);
    if(Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon)))bits.push(Number(p.lat).toFixed(6)+', '+Number(p.lon).toFixed(6)+' (WGS84)');
    if(p.frp)bits.push('FRP '+p.frp);
    if(p.kind&&!p.hw)bits.push(p.kind);
    body.textContent=bits.join(' · ')||'OSM / planning feature';
    box.append(title,body);
    new maplibregl.Popup({closeButton:true,maxWidth:'300px'}).setLngLat(e.lngLat).setDOMContent(box).addTo(app.map);
  }
  function bindMapInteractions(){
    app.map.on('click',e=>{
      if(app.pickMode==='start'){
        setCoordinatePoint('start',[e.lngLat.lat,((e.lngLat.lng+180)%360+360)%360-180]);return;
      }
      if(app.pickMode==='target'){
        setCoordinatePoint('target',[e.lngLat.lat,((e.lngLat.lng+180)%360+360)%360-180]);return;
      }
      popupFeature(e);
    });
    app.map.on('mouseenter','roads',()=>app.map.getCanvas().style.cursor='pointer');
    app.map.on('mouseleave','roads',()=>app.map.getCanvas().style.cursor='');
  }

  async function calculateRoute(){
    app.pickMode=null;
    clearRoute();const revision=app.routeRevision;
    const profile=document.getElementById('op-profile')?.value||'4x4';app.profile=profile;
    setRouteStatus('กำลังคำนวณเส้นทาง access '+profile+'…','loading');
    try{await computeRoute(revision,profile);}catch(_){
      if(revision!==app.routeRevision)return;
      clearRoute();setRouteStatus('คำนวณเส้นทางไม่สำเร็จ · กรุณาลองใหม่หรือตรวจข้อมูล OSM','error');
    }
  }
  async function computeRoute(revision,profile){
    if(!app.state?.osmOK){setRouteStatus('ไม่มี OSM routing graph จึงยังคำนวณ access route ไม่ได้','error');return;}
    const target=currentTarget();if(!target){setRouteStatus('กรุณาเลือกหรือกำหนดจุดเป้าหมาย','error');return;}
    const graph=buildGraph(app.state.osm.segments||[],profile);
    if(!graph.size){setRouteStatus('ไม่พบเส้นทาง OSM ที่ใช้กับ profile นี้','error');return;}
    const nearTarget=nearestNode([target.lat,target.lon],graph);
    if(!nearTarget.node){setRouteStatus('ไม่พบ access network ใกล้เป้าหมาย','error');return;}
    let route,egress,startSnap,startGap=0;
    if(app.manualStart){
      const ns=nearestNode(app.manualStart,graph);startSnap=ns.node;startGap=ns.distanceKm;
      route=startSnap?routeBetween(graph,startSnap.key,nearTarget.node.key):null;
      egress=startSnap?routeBetween(graph,nearTarget.node.key,startSnap.key):null;
    }else{
      route=routeFromMainRoad(graph,nearTarget.node.key);
      egress=routeToMainRoad(graph,nearTarget.node.key);
      startSnap=route?.coords?.length?graph.get(key(route.coords[0])):null;
    }
    if(!route||route.coords.length<1){
      setRouteStatus('หาเส้นทางเชื่อมต่อไม่ได้สำหรับ '+profile+' · ลอง 4x4 หรือเดินเท้า และตรวจ OSM/ภาคสนาม','error');
      return;
    }
    const roadKm=route.edges.reduce((a,e)=>a+e.km,0),roadMin=route.edges.reduce((a,e)=>a+e.minutes,0);
    const last=route.coords[route.coords.length-1],targetCoord=[target.lat,target.lon];
    const approach=profile==='foot'?{route:null,mappedKm:0,mappedMin:0,offroadKm:distanceKm(last,targetCoord),connectors:distanceKm(last,targetCoord)>.015?[[last,targetCoord]]:[]}:walkingApproach(last,targetCoord,buildGraph(app.state.osm.segments||[],'foot'));
    const offroadKm=approach.offroadKm+startGap,offroadMin=offroadKm/3*60;
    const driveKm=profile==='foot'?0:roadKm,driveMin=profile==='foot'?0:roadMin;
    const mappedWalkKm=profile==='foot'?roadKm:approach.mappedKm,mappedWalkMin=profile==='foot'?roadMin:approach.mappedMin;
    const walkKm=mappedWalkKm+offroadKm,walkMin=mappedWalkMin+offroadMin;
    const startCoord=app.manualStart||route.coords[0];
    const fullCoords=[...(app.manualStart?[app.manualStart]:[]),...route.coords,...(approach.route?.coords||[]),targetCoord];
    const journey={profile,start:startCoord,roadStart:route.coords[0],handoff:last,targetCoord,startGap,driveKm,driveMin,walkKm,walkMin,mappedWalkKm,mappedWalkMin,targetOffroadKm:approach.offroadKm};
    sourceSet('route',profile==='foot'?emptyFC():routeFC(route.coords));
    sourceSet('walk',routeFC(profile==='foot'?route.coords:approach.route?.coords));
    sourceSet('egress',routeFC(egress?.coords||[]));
    sourceSet('offroad',connectorFC([...approach.connectors,...(app.manualStart&&startGap>.015?[[app.manualStart,route.coords[0]]]:[])]));
    sourceSet('route-points',pointFC([
      {coord:startCoord,properties:{kind:'start'}},...(profile==='foot'?[]:[{coord:last,properties:{kind:'handoff'}}]),{coord:targetCoord,properties:{kind:'target'}}
    ]));
    showJourneyMarkers(journey);renderJourney(journey);
    syncLayerToggles();
    const frameCoords=[...fullCoords,...(egress?.coords||[])];
    fitJourneyView(frameCoords);
    const types={};[...route.edges,...(approach.route?.edges||[])].forEach(e=>{types[e.seg.hw]=(types[e.seg.hw]||0)+e.km;});
    const surface=Object.entries(types).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([x,d])=>x+' '+fmt(d)+' km').join(' · ');
    setText('op-route-distance',fmt(driveKm+walkKm)+' กม.');
    setText('op-route-time',Math.round(driveMin+walkMin)+' นาที');
    const egressMin=(egress?.edges||[]).reduce((a,e)=>a+e.minutes,0)+(profile==='foot'?0:approach.mappedMin)+offroadMin;
    setText('op-egress-time',egress?Math.round(egressMin)+' นาที':'ไม่พบ route');
    setText('op-offroad-distance',fmt(offroadKm)+' กม.');
    setText('op-route-profile',profile==='4x4'?'4x4 / track':profile==='vehicle'?'รถทั่วไป':'เดินเท้า');
    setText('op-route-surface',surface||'—');
    setText('op-start-mode',app.manualStart?'จุดเริ่มต้นการเดินทาง · '+startCoord[0].toFixed(6)+', '+startCoord[1].toFixed(6)+' · เชื่อมถนน '+Math.round(startGap*1000)+' m':'Auto · จุดเริ่มต้นการเดินทางจากถนนหลัก');
    app.currentRoute={target,profile,route,egress,walkRoute:profile==='foot'?route:approach.route,roadKm,offroadKm,journey,frameCoords,
      metrics:{distanceKm:driveKm+walkKm,timeMin:driveMin+walkMin,egressTimeMin:egress?egressMin:null,offroadKm},elevation:{state:'loading',gain:null,loss:null,maxGrade:null}};
    setRouteStatus('เส้นทางพร้อม · กำลังอ่านความสูงเพิ่มเติม…','ready');
    try{
      const elev=await fetchElevations(fullCoords),stats=profileStats(elev);
      if(revision!==app.routeRevision)return;
      app.currentRoute.elevation={state:'ready',...stats};
      setText('op-elevation-gain',stats.gain==null?'—':Math.round(stats.gain)+' m');
      setText('op-max-grade',stats.maxGrade==null?'—':fmt(stats.maxGrade)+'%');
    }catch(err){if(revision!==app.routeRevision)return;app.currentRoute.elevation={state:'unavailable',gain:null,loss:null,maxGrade:null};setText('op-elevation-gain','—');setText('op-max-grade','—');}
    setRouteStatus('เส้นทางพร้อม · เป็น planning route จาก OSM ไม่ใช่คำสั่งเข้าดับไฟหรือการรับรองสภาพถนนจริง','ready');
  }

  function bindControls(){
    document.querySelectorAll('[data-op-mode]').forEach(b=>b.addEventListener('click',()=>applyMode(b.dataset.opMode)));
    document.querySelectorAll('[data-basemap]').forEach(b=>b.addEventListener('click',()=>setBasemap(b.dataset.basemap)));
    ['op-contours','op-hillshade','op-slope','op-roads','op-tracks','op-support','op-assets','op-route-layer'].forEach(id=>document.getElementById(id)?.addEventListener('change',syncLayerToggles));
    document.getElementById('op-exaggeration')?.addEventListener('input',e=>{
      const x=Number(e.target.value);setText('op-exag-value',x.toFixed(1)+'×');if(app.terrainAvailable&&app.map?.getSource('terrain-dem'))app.map.setTerrain({source:'terrain-dem',exaggeration:x});
    });
    document.getElementById('op-route')?.addEventListener('click',calculateRoute);
    ['start','target'].forEach(kind=>{
      document.getElementById('op-'+kind+'-coordinates')?.addEventListener('submit',e=>{
        e.preventDefault();const coord=readCoordinates(kind);if(coord)setCoordinatePoint(kind,coord);
      });
      ['lat','lon'].forEach(axis=>document.getElementById('op-'+kind+'-'+axis)?.addEventListener('input',()=>clearCoordinateError(kind)));
    });
    document.getElementById('op-pick-start')?.addEventListener('click',()=>{app.pickMode='start';setStatus('คลิกบนแผนที่เพื่อกำหนดจุดเริ่มต้นการเดินทาง','loading');});
    document.getElementById('op-auto-start')?.addEventListener('click',()=>{app.manualStart=null;app.pickMode=null;writeCoordinates('start',null);clearRoute();showChosenPoints();setText('op-start-mode','Auto · จุดเริ่มต้นการเดินทางจากถนนหลัก');setStatus('กลับไปใช้ Auto staging · กดคำนวณเส้นทาง','ready');});
    document.getElementById('op-pick-target')?.addEventListener('click',()=>{app.pickMode='target';setStatus('คลิกบนแผนที่เพื่อกำหนดจุดเหตุ / fire target','loading');});
    document.getElementById('op-auto-target')?.addEventListener('click',randomizeFireTarget);
    document.getElementById('op-target')?.addEventListener('change',changeTarget);
    document.getElementById('op-profile')?.addEventListener('change',()=>{
      if(app.currentRoute)calculateRoute();
      else{clearRoute();showChosenPoints();setStatus('เปลี่ยนรูปแบบการเดินทางแล้ว · กดคำนวณเส้นทาง','ready');}
    });
  }

  function init(state){
    app.initialized=true;app.state=state;populateTargets();
    app.lastTarget=currentTarget();
    try{createMap(state);}catch(_){if(app.map){try{app.map.remove();}catch(_){}app.map=null;}createFlatMap(state);}
  }
  function handle(state){
    if(!state)return;
    if(!app.initialized)init(state);else updateOperationalData(state);
  }
  window.WildfireOperationalMap={
    getContext:()=>({map:app.map,flatMap:app.flatMap,state:app.state,target:currentTarget()}),
    getSnapshot,selectHistoricalTarget,focusTarget,
    setTarget:coord=>setCoordinatePoint('target',coord),randomTarget:randomizeFireTarget
  };
  bindControls();
  window.ForestWatchPointFilters?.subscribe(()=>{if(app.state)syncLayerToggles();});
  if(window.ForestWatchPresentationState)handle(window.ForestWatchPresentationState);
  window.addEventListener('forestwatch:v1-ready',e=>handle(e.detail));
})();
