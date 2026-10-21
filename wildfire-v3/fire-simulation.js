'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const empty=()=>({type:'FeatureCollection',features:[]});
  const roleName={EX:'Existing Sensors',RS:'Reference / Super Station',FU:'Fusion Node',RW:'Ridge Weather',VW:'Valley Wind',BW:'Boundary Weather',AQ:'AQ / Smoke'};
  const sim={scenario:null,minute:0,playing:false,busy:false,worker:null,job:0,timer:null,clock:0,map:null,flatMap:null,flatLayers:[],markers:[],windMarker:null,originMarker:null,popup:null,lastToast:null,planKey:null,frame:null};
  let currentStatus={state:$('sim-status').dataset.state||'ready',message:$('sim-status').textContent};
  // Scenario/frame are the engine's computed objects, exposed read-only by contract.
  // Reading a snapshot never recalculates, seeks, pauses or resets the simulation.
  function getSnapshot(){return {scenario:sim.scenario,frame:sim.frame,minute:sim.minute,playing:sim.playing,busy:sim.busy,status:{...currentStatus}};}
  function publish(){window.dispatchEvent(new CustomEvent('wildfire:simulation-updated',{detail:getSnapshot()}));}
  const status=(message,state='ready',notify=true)=>{currentStatus={state,message};$('sim-status').textContent=message;$('sim-status').dataset.state=state;if(notify)publish();};
  const text=(id,value)=>{$(id).textContent=value;};
  const context=()=>window.WildfireOperationalMap?.getContext();
  const coordinate=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<85&&Math.abs(p.lon)<179.8;
  const coordinateText=p=>p.lat.toFixed(6)+', '+p.lon.toFixed(6);
  const finite=n=>Number.isFinite(n)?n:0;
  const fmt=(n,d=1)=>finite(n).toLocaleString('th-TH',{maximumFractionDigits:d});
  const planKey=ctx=>JSON.stringify({nodes:(ctx?.state?.result?.nodes||[]).map(n=>[n.id,n.p.lat,n.p.lon,n.roleCode,n.p.elev,n.p.pkg]),existing:(ctx?.state?.data?.existing||[]).map(p=>[p.id,p.lat,p.lon,p.pkg]),terrain:(ctx?.state?.candidates||[]).map(p=>[p.lat,p.lon,p.elev,p.slope])});
  function controls(){
    $('sim-run').disabled=sim.busy||sim.playing;
    $('sim-run').textContent=sim.busy?'กำลังคำนวณ…':sim.scenario&&sim.minute<120?'เล่นต่อ':'ทดลองหากเกิดไฟป่า';
    $('sim-pause').disabled=!sim.playing;
    $('sim-reset').disabled=sim.busy||!sim.scenario;
    $('sim-new-wind').disabled=sim.busy||!sim.scenario;
    $('sim-minute').disabled=sim.busy||!sim.scenario;
  }
  function pause(message,notify=true){
    sim.playing=false;clearInterval(sim.timer);sim.timer=null;controls();
    if(sim.scenario)$('operational-3d-map').dataset.simulationState='paused';
    if(message)status(message,'ready',false);
    if(notify)publish();
  }
  function clearMarkers(){sim.markers.forEach(m=>m.remove?m.remove():sim.flatMap?.removeLayer(m));sim.markers=[];}
  function removeOrigin(){[sim.windMarker,sim.originMarker].forEach(m=>{if(m?.remove)m.remove();else if(m)sim.flatMap?.removeLayer(m);});sim.windMarker=null;sim.originMarker=null;}
  function clearVisuals(){
    clearMarkers();removeOrigin();sim.popup?.remove();sim.popup=null;
    if(sim.map)for(const id of ['sim-probability','sim-fire','sim-front','sim-smoke'])sim.map.getSource(id)?.setData(empty());
    sim.flatLayers.forEach(l=>sim.flatMap?.removeLayer(l));sim.flatLayers=[];
    $('sim-toast').hidden=true;$('sim-map-legend').hidden=true;$('sim-results').hidden=true;
    const el=$('operational-3d-map');el.dataset.simulationState='idle';el.dataset.simulationMinute='0';el.dataset.simulationDetections='[]';
    for(const name of ['simulationFireCount','simulationFrontCount','simulationSmokeCount','simulationProbabilityCount'])el.dataset[name]='0';
  }
  function invalidate(message){
    sim.job++;sim.worker?.terminate();sim.worker=null;sim.busy=false;pause(undefined,false);clearVisuals();sim.scenario=null;sim.frame=null;sim.minute=0;sim.lastToast=null;
    $('sim-minute').value='0';text('sim-time-label','T+0 นาที');['sim-area','sim-wind','sim-detected','sim-first'].forEach(id=>text(id,'—'));controls();
    status(message||'พิกัดไฟเปลี่ยนแล้ว · กดทดลองเพื่อคำนวณฉากใหม่');
  }
  function installLayers(){
    const ctx=context();if(!ctx)return false;
    sim.map=ctx.map;sim.flatMap=ctx.flatMap;
    if(sim.map){
      if($('operational-3d-map').dataset.mapReady!=='true')return false;
      for(const id of ['sim-probability','sim-fire','sim-front','sim-smoke'])if(!sim.map.getSource(id))sim.map.addSource(id,{type:'geojson',data:empty()});
      const layers=[
        {id:'sim-probability',type:'fill',source:'sim-probability',paint:{'fill-color':['step',['get','probability'],'#f4d878',.5,'#f39938',.8,'#d74530'],'fill-opacity':.27}},
        {id:'sim-fire',type:'fill',source:'sim-fire',paint:{'fill-color':'#c33b1e','fill-opacity':.56}},
        {id:'sim-fire-outline',type:'line',source:'sim-fire',paint:{'line-color':'#ffad39','line-width':1.1,'line-opacity':.7}},
        {id:'sim-front',type:'fill-extrusion',source:'sim-front',paint:{'fill-extrusion-color':'#ffa126','fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':.95,'fill-extrusion-vertical-gradient':true}},
        {id:'sim-smoke',type:'fill-extrusion',source:'sim-smoke',paint:{'fill-extrusion-color':'#a3a8aa','fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':.24}}
      ];
      for(const layer of layers)if(!sim.map.getLayer(layer.id))sim.map.addLayer(layer,sim.map.getLayer('roads-casing')?'roads-casing':undefined);
    }
    return !!(sim.map||sim.flatMap);
  }
  function setLayerVisibility(){
    if(sim.map){
      if(sim.map.getLayer('sim-probability'))sim.map.setLayoutProperty('sim-probability','visibility',$('sim-probability').checked?'visible':'none');
      if(sim.map.getLayer('sim-smoke'))sim.map.setLayoutProperty('sim-smoke','visibility',$('sim-smoke').checked?'visible':'none');
    }
    if(sim.flatMap&&sim.scenario)drawFlat(sim.frame);
  }
  function drawFlat(frame){
    if(!frame||!window.L)return;
    sim.flatLayers.forEach(l=>sim.flatMap.removeLayer(l));sim.flatLayers=[];
    const entries=[[$('sim-probability').checked?frame.probabilityFC:null,'#edb452',.25], [frame.fireFC,'#d54c28',.55],[$('sim-smoke').checked?frame.smokeFC:null,'#adb3b5',.18]];
    for(const [fc,color,opacity] of entries)if(fc){const layer=L.geoJSON(fc,{style:f=>({color:Number.isFinite(f.properties?.probability)?(f.properties.probability>=.8?'#d74530':f.properties.probability>=.5?'#f39938':'#f4d878'):color,weight:.7,fillOpacity:opacity})}).addTo(sim.flatMap);sim.flatLayers.push(layer);}
  }
  function makeMarker(element,p,options={}){
    if(sim.map)return new maplibregl.Marker({element,...options}).setLngLat([p.lon,p.lat]).addTo(sim.map);
    if(sim.flatMap&&window.L)return L.marker([p.lat,p.lon],{icon:L.divIcon({className:'sim-leaflet-icon',html:element.outerHTML,iconSize:[34,34],iconAnchor:[17,17]})}).addTo(sim.flatMap);
    return null;
  }
  function addOrigin(){
    removeOrigin();const p=sim.scenario.origin;
    const flame=document.createElement('div');flame.className='sim-fire-origin';flame.title='จุดเริ่มไฟจำลอง';flame.innerHTML='<svg viewBox="0 0 36 48" aria-hidden="true"><path fill="#ff571f" d="M18 1C22 15 35 19 32 33C30 45 13 49 5 39C-2 29 6 17 12 14C9 23 17 25 18 1Z"/><path fill="#ffca42" d="M18 23C26 29 25 38 20 42C10 44 8 35 13 29C13 35 17 33 18 23Z"/></svg>';
    sim.originMarker=makeMarker(flame,p,{anchor:'bottom'});
    const arrow=document.createElement('div');arrow.className='sim-wind-arrow';arrow.title='ทิศที่ลมพัดไป (จำลอง)';arrow.innerHTML='<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M22 2L37 22H27V42H17V22H7Z" fill="currentColor" stroke="#245360" stroke-width="1.5"/></svg>';
    sim.windMarker=makeMarker(arrow,p,{offset:[55,-10],rotationAlignment:'map',pitchAlignment:'map'});
  }
  function focusPoint(p){
    if(sim.map){const center=[p.lon,p.lat],elevation=sim.map.queryTerrainElevation?.(center);sim.map.setCenterClampedToGround?.(true);sim.map.easeTo({center,zoom:13,pitch:45,duration:650,...(Number.isFinite(elevation)?{elevation}:{})});}
    else sim.flatMap?.setView([p.lat,p.lon],14);
  }
  function focusFire({overview=false}={}){
    if(!sim.scenario)return;
    // Initial playback keeps the forecast overview. Explicit focus follows the fire already
    // reached at the selected minute, without seeking or recalculating the scenario.
    const o=sim.scenario.origin,frame=overview?window.WildfireSimulationModel.getFrame(sim.scenario,120):sim.frame;
    const points=[o];
    const collect=coordinates=>{
      if(!Array.isArray(coordinates))return;
      if(coordinates.length>=2&&Number.isFinite(coordinates[0])&&Number.isFinite(coordinates[1])){
        const point={lon:coordinates[0],lat:coordinates[1]};if(coordinate(point))points.push(point);
      }else coordinates.forEach(collect);
    };
    for(const feature of (overview?frame?.probabilityFC:frame?.fireFC)?.features||[])collect(feature.geometry?.coordinates);
    const margin=overview ? .012 : .0003;
    points.push({lat:o.lat-margin,lon:o.lon-margin},{lat:o.lat+margin,lon:o.lon+margin});
    const container=$('operational-3d-map'),width=container.clientWidth||800,height=container.clientHeight||500;
    const padding=overview?85:{top:Math.min(90,height*.22),right:Math.min(48,width*.14),bottom:Math.min(85,height*.24),left:Math.min(48,width*.14)};
    const maxZoom=overview?13:16,pitch=overview?45:40;
    if(sim.map){
      const b=new maplibregl.LngLatBounds();points.forEach(p=>b.extend([p.lon,p.lat]));
      const camera=sim.map.cameraForBounds?.(b,{padding,maxZoom,bearing:-25});
      if(camera){const elevation=sim.map.queryTerrainElevation?.(camera.center);sim.map.stop?.();sim.map.setCenterClampedToGround?.(true);sim.map.jumpTo({...camera,zoom:Math.min(maxZoom,camera.zoom-(overview ? .5 : .25)),pitch,padding:{top:0,right:0,bottom:0,left:0},...(Number.isFinite(elevation)?{elevation}:{})});}
      else sim.map.fitBounds(b,{padding,maxZoom,pitch,bearing:-25,duration:650});
    }else if(sim.flatMap&&window.L)sim.flatMap.fitBounds(points.map(p=>[p.lat,p.lon]),overview?{padding:[40,40],maxZoom:14}:{paddingTopLeft:[padding.left,padding.top],paddingBottomRight:[padding.right,padding.bottom],maxZoom});
    if(!overview&&window.innerWidth<=800)window.WildfireWorkspace?.scrollToMap?.();
  }
  function signalsText(event){
    const s=event.signals||{};
    if(event.type==='smoke-detection')return 'PM2.5 '+fmt(s.pm25UgM3)+' µg/m³ (Δ'+fmt(s.deltaPm25UgM3)+')'+(Number.isFinite(s.coPpm)?' · CO '+fmt(s.coPpm,2)+' ppm (Δ'+fmt(s.deltaCoPpm,2)+')':' · PM เท่านั้น ไม่มีค่า CO')+(event.capabilityAssumed?' · สมมติการรองรับ PM ของ Existing Sensor สำหรับเดโม':'');
    return 'ลม '+fmt(s.windSpeedMs)+' m/s · '+Math.round(finite(s.windFromDeg))+'° → '+Math.round(finite(s.windToDeg))+'° · '+fmt(s.temperatureC)+'°C / RH '+fmt(s.relativeHumidityPct)+'%';
  }
  function showToast(event){
    if(!event||event.type!=='smoke-detection')return;
    sim.lastToast=event;
    text('sim-toast-title','T+'+event.minute+' นาที · '+event.sensorId+' พบสัญญาณควัน (จำลอง)');
    text('sim-toast-message',signalsText(event)+' · ลมพัดไป '+Math.round(finite(event.signals?.windToDeg))+'° — ควรตรวจสอบ ไม่ใช่ยืนยันไฟจริง');
    $('sim-toast').hidden=false;
  }
  function showEvent(event){
    focusPoint(event);sim.popup?.remove();
    const node=document.createElement('div');const h=document.createElement('b');h.textContent=event.sensorId+' · T+'+event.minute+' นาที (จำลอง)';node.append(h);
    const p=document.createElement('p');p.textContent=signalsText(event)+' · '+coordinateText(event);node.append(p);
    if(sim.map)sim.popup=new maplibregl.Popup({maxWidth:'310px',offset:18}).setLngLat([event.lon,event.lat]).setDOMContent(node).addTo(sim.map);
    else if(sim.flatMap)sim.popup=L.popup().setLatLng([event.lat,event.lon]).setContent(node).openOn(sim.flatMap);
  }
  function updateAlertMarkers(events){
    const smoke=events.filter(e=>e.type==='smoke-detection'&&$('op-assets').checked&&window.ForestWatchPointFilters?.matches('sensor',e.roleCode)!==false);
    const key=smoke.map(e=>e.id).join('|');if(key===sim.markerKey)return;sim.markerKey=key;
    clearMarkers();
    smoke.forEach(event=>{
      const el=document.createElement('button');el.className='sim-sensor-alert';el.type='button';el.textContent=event.sensorId;el.title=event.sensorId+' · พบควันจำลอง T+'+event.minute+' นาที';el.setAttribute('aria-label',el.title);el.dataset.sensorId=event.sensorId;el.addEventListener('click',e=>{e.stopPropagation();showEvent(event);});
      const marker=makeMarker(el,event);if(marker){if(sim.flatMap)marker.on('click',e=>{if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);showEvent(event);});sim.markers.push(marker);}
    });
  }
  function renderTimeline(){
    const events=sim.scenario.events.filter(e=>e.type==='smoke-detection'||e.minute===0).sort((a,b)=>(a.type==='smoke-detection'?0:1)-(b.type==='smoke-detection'?0:1)||a.minute-b.minute);$('sim-events').replaceChildren();
    const detection=events.filter(e=>e.type==='smoke-detection');
    if(!detection.length){const no=document.createElement('p');no.className='sim-no-coverage';no.textContent='ฉากนี้ยังไม่มีสถานี PM2.5 / CO พบควันภายใน 120 นาที อาจเป็นช่องว่างการตรวจจับหรือลมพัดออกจากเครือข่าย การไม่มีสัญญาณไม่ยืนยันว่าพื้นที่ไม่มีไฟ';$('sim-events').append(no);}
    for(const event of events){
      const card=document.createElement('article');card.className='sim-event future'+(event.type==='weather'?' weather':'');card.dataset.eventId=event.id;card.dataset.minute=event.minute;
      const header=document.createElement('header'),button=document.createElement('button'),time=document.createElement('b');button.type='button';button.textContent=event.sensorId;button.addEventListener('click',()=>showEvent(event));time.textContent='T+'+event.minute+' นาที';header.append(button,time);card.append(header);
      const role=document.createElement('span');role.className='sim-event-role';role.textContent=(roleName[event.roleCode]||event.roleCode)+' · '+(event.type==='weather'?'ค่าลม / อุณหภูมิ / RH จำลอง':'สัญญาณควันจำลอง');card.append(role);
      const detail=document.createElement('p');detail.textContent=signalsText(event);card.append(detail);
      const explanation=document.createElement('p');explanation.textContent=event.type==='smoke-detection'?(event.detectionBasis==='pm25-only'?'PM2.5 เพิ่มเป็นครั้งแรกในฉาก':'PM2.5 และ CO เพิ่มพร้อมกันเป็นครั้งแรกในฉาก')+' · ลมพัดไป '+Math.round(finite(event.signals?.windToDeg))+'°':'ข้อมูลลมตั้งต้นของฉาก · ไม่มีการจำลอง PM2.5 / CO สำหรับ Weather อย่างเดียว';if(['RS','FU'].includes(event.roleCode)&&event.type==='weather')explanation.textContent='ข้อมูลลมตั้งต้นของฉาก · จำลอง '+(event.roleCode==='RS'?'PM2.5 ตามชุดสถานีอ้างอิง':'PM2.5 / CO ตามชุด Fusion')+' แยกในลำดับเหตุการณ์';card.append(explanation);
      const coord=document.createElement('small');coord.textContent=coordinateText(event)+' · ข้อมูลจำลอง';card.append(coord);$('sim-events').append(card);
    }
    const terrain=sim.scenario.metadata.terrainStatus;
    text('sim-method-note','ฉาก '+sim.scenario.seed+' · '+sim.scenario.members+' การทดลอง · ภูมิประเทศ: '+terrain+' · ระยะกริด '+sim.scenario.metadata.cellSizeM+' เมตร · คำนวณเซนเซอร์ทุกจุด แม้กรองซ่อนบนแผนที่');
    $('sim-results').hidden=false;
  }
  function renderStations(){
    $('sim-stations').replaceChildren();
    for(const station of sim.scenario.windStations){
      const reading=[...station.readings].reverse().find(r=>r.minute<=sim.minute)||station.readings[0];
      const tr=document.createElement('tr');
      [station.id,roleName[station.roleCode]||station.roleCode,Math.round(reading.windFromDeg)+'° → '+Math.round(reading.windToDeg)+'°',fmt(reading.windSpeedMs)+' m/s',fmt(reading.temperatureC)+'°C / '+fmt(reading.relativeHumidityPct)+'%'].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});$('sim-stations').append(tr);
    }
  }
  function render(minute,notify=false){
    if(!sim.scenario)return;
    const previous=sim.minute;sim.minute=Math.max(0,Math.min(120,Math.floor(minute)));
    const frame=window.WildfireSimulationModel.getFrame(sim.scenario,sim.minute);sim.frame=frame;
    if(sim.map){
      for(const [id,data] of [['sim-probability',frame.probabilityFC],['sim-fire',frame.fireFC],['sim-front',frame.frontFC],['sim-smoke',frame.smokeFC]])sim.map.getSource(id)?.setData(data);
    }
    setLayerVisibility();
    sim.windMarker?.setRotation?.(frame.headingToDeg);
    $('sim-minute').value=String(sim.minute);text('sim-time-label','T+'+sim.minute+' นาที');text('sim-map-time','T+'+sim.minute+' นาที · DEMO');
    text('sim-wind',Math.round(frame.windFromDeg)+'° → '+Math.round(frame.headingToDeg)+'° · '+fmt(frame.windSpeedMs)+' m/s');
    text('sim-area',fmt(frame.areaHa)+' เฮกตาร์');
    const seen=frame.eventsSoFar.filter(e=>e.type==='smoke-detection'),all=sim.scenario.events.filter(e=>e.type==='smoke-detection');
    text('sim-detected',seen.length+' / '+all.length+' จุด');text('sim-first',all[0]?all[0].sensorId+' · T+'+all[0].minute+' นาที':'ยังไม่พบใน 120 นาที');
    text('sim-timeline-summary','T+'+sim.minute+' นาที · '+seen.length+' สถานีพบสัญญาณควันจำลอง · ลมพัดไป '+Math.round(frame.headingToDeg)+'° · เซนเซอร์ Weather แสดงลม / อุณหภูมิ / RH');
    $('sim-events').querySelectorAll('[data-minute]').forEach(card=>{const past=Number(card.dataset.minute)<=sim.minute;card.classList.toggle('future',!past);card.classList.toggle('detected',past&&!card.classList.contains('weather'));});
    updateAlertMarkers(frame.eventsSoFar);renderStations();
    if(sim.minute<previous){$('sim-toast').hidden=true;sim.lastToast=null;}
    if(notify){const fresh=seen.filter(e=>e.minute>previous&&e.minute<=sim.minute);if(fresh.length)showToast(fresh[fresh.length-1]);}
    const el=$('operational-3d-map');el.dataset.simulationMinute=String(sim.minute);el.dataset.simulationState=sim.playing?'playing':'paused';el.dataset.simulationFireCount=String(frame.fireFC.features.length);el.dataset.simulationFrontCount=String(frame.frontFC.features.length);el.dataset.simulationSmokeCount=String(frame.smokeFC.features.length);el.dataset.simulationProbabilityCount=String(frame.probabilityFC.features.length);el.dataset.simulationDetections=JSON.stringify(seen.map(e=>({id:e.sensorId,minute:e.minute,type:e.type})));
    publish();
  }
  function play(){
    if(!sim.scenario)return;if(sim.minute>=120)render(0);
    pause(undefined,false);sim.playing=true;sim.clock=performance.now();controls();status('กำลังเล่นไฟลามและการตรวจจับ · ลม / ค่าเซนเซอร์จำลอง','ready',false);
    sim.timer=setInterval(()=>{
      if(document.hidden)return;
      const now=performance.now(),elapsed=(now-sim.clock)/1000;sim.clock=now;
      const speed=Number($('sim-speed').value)||4;sim.accumulator=(sim.accumulator||0)+elapsed*speed;
      if(sim.accumulator>=1){const next=sim.minute+Math.floor(sim.accumulator);sim.accumulator%=1;render(next,true);}
      if(sim.minute>=120)pause('ครบ 120 นาทีแล้ว · เลื่อนเวลาเพื่อเทียบแนวลามและสัญญาณเซนเซอร์');
    },250);
    publish();
  }
  function runWorker(input,job){
    return new Promise((resolve,reject)=>{
      if(!window.Worker){setTimeout(()=>{try{if(job===sim.job)resolve(window.WildfireSimulationModel.createScenario(input));else reject(new Error('cancelled'));}catch(e){reject(e);}},0);return;}
      let worker;
      try{worker=new Worker('fire-worker.js?v=wildfire-v02');}catch(_){setTimeout(()=>{try{if(job===sim.job)resolve(window.WildfireSimulationModel.createScenario(input));else reject(new Error('cancelled'));}catch(e){reject(e);}},0);return;}sim.worker=worker;
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('คำนวณเกินเวลาที่กำหนด'));},20000);
      const done=()=>{clearTimeout(timer);worker.terminate();if(sim.worker===worker)sim.worker=null;};
      worker.onmessage=event=>{if(event.data.requestId!==job)return;done();event.data.type==='result'?resolve(event.data.scenario):reject(new Error(event.data.message||event.data.error||'คำนวณไม่สำเร็จ'));};
      worker.onerror=()=>{done();try{resolve(window.WildfireSimulationModel.createScenario(input));}catch(e){reject(e);}};
      worker.postMessage({type:'run',requestId:job,input});
    });
  }
  async function experiment(newWind=false){
    if(sim.busy)return;
    const ctx=context(),target=ctx?.target;
    if(!coordinate(target)){status('เลือกพิกัดไฟในพื้นที่ก่อนเริ่มทดลอง','error');return;}
    if(!installLayers()){status('แผนที่กำลังโหลด · ลองกดทดลองอีกครั้งเมื่อแผนที่พร้อม','error');return;}
    if(!window.WildfireSimulationModel){status('โหลดแบบจำลองไม่สำเร็จ · รีเฟรชหน้าเว็บ','error');return;}
    if(sim.scenario&&!newWind&&sim.minute<120){play();return;}
    invalidate('กำลังคำนวณ 24 ฉากไฟลามและการตรวจจับใน 120 นาที…');sim.busy=true;controls();
    status(currentStatus.message,'loading');
    const job=++sim.job,snapshot=planKey(ctx);sim.planKey=snapshot;
    const sensors=[...(ctx.state.result.nodes||[]).map(n=>({id:n.id,lat:n.p.lat,lon:n.p.lon,roleCode:n.roleCode,elev:n.p.elev,pkg:n.p.pkg})),...(ctx.state.data.existing||[]).map(p=>({...p,roleCode:'EX'}))];
    const input={origin:{lat:target.lat,lon:target.lon},wind:{fromDeg:Math.random()*360,speedMs:.8+Math.random()*4.2},sensors,terrain:ctx.state.candidates||[],seed:Math.floor(Math.random()*4294967295),members:24};
    try{
      const scenario=await runWorker(input,job);
      if(job!==sim.job)return;
      if(planKey(context())!==snapshot){invalidate('เครือข่ายเซนเซอร์อัปเดตแล้ว · กดทดลองด้วยข้อมูลล่าสุด');return;}
      sim.scenario=scenario;sim.busy=false;sim.markerKey=null;sim.accumulator=0;addOrigin();renderTimeline();render(0);$('sim-map-legend').hidden=false;focusFire({overview:true});play();
    }catch(error){if(job===sim.job){sim.busy=false;controls();status('ทดลองไม่สำเร็จ: '+error.message,'error');}}
  }
  $('sim-run').addEventListener('click',()=>experiment());
  $('sim-new-wind').addEventListener('click',()=>experiment(true));
  $('sim-pause').addEventListener('click',()=>pause('พักที่ T+'+sim.minute+' นาที · เล่นต่อหรือเลื่อนเวลาได้'));
  $('sim-reset').addEventListener('click',()=>{pause();sim.accumulator=0;render(0);$('sim-toast').hidden=true;status('เริ่มเวลาใหม่ในฉากเดิม · กดเล่นต่อ');});
  $('sim-minute').addEventListener('input',()=>{pause();render(Number($('sim-minute').value),true);status('ดูฉากที่ T+'+sim.minute+' นาที');});
  $('sim-probability').addEventListener('change',setLayerVisibility);$('sim-smoke').addEventListener('change',setLayerVisibility);
  $('op-assets').addEventListener('change',()=>{if(sim.frame)updateAlertMarkers(sim.frame.eventsSoFar);});
  window.ForestWatchPointFilters?.subscribe(()=>{if(sim.frame)updateAlertMarkers(sim.frame.eventsSoFar);});
  $('sim-toast-close').addEventListener('click',()=>{$('sim-toast').hidden=true;});
  $('sim-toast-focus').addEventListener('click',()=>{if(sim.lastToast)showEvent(sim.lastToast);});
  $('sim-focus-fire').addEventListener('click',focusFire);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&sim.playing)pause('พักเมื่อออกจากหน้านี้ · กดเล่นต่อเพื่อดูเหตุการณ์');});
  window.addEventListener('pagehide',()=>{pause();sim.worker?.terminate();});
  window.addEventListener('wildfire:target-changed',()=>invalidate());
  window.addEventListener('wildfire:data-updated',()=>{if((sim.scenario||sim.busy)&&sim.planKey!==planKey(context()))invalidate('ตำแหน่งหรือบทบาทเซนเซอร์อัปเดตแล้ว · กดทดลองฉากใหม่');});
  window.addEventListener('wildfire:map-ready',()=>{installLayers();controls();});
  window.WildfireSimulation=Object.freeze({getSnapshot,run:()=>experiment(),pause:()=>pause('พักที่ T+'+sim.minute+' นาที · เล่นต่อหรือเลื่อนเวลาได้')});
  installLayers();controls();
  publish();
})();
