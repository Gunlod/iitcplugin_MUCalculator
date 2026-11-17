'use strict';
// Integration harness: real Chromium, Leaflet and IITC dialogs; hooks/native bridge and API are fixtures.
// It does not simulate an authenticated Intel map or an Android WebView.
const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const source = fs.readFileSync(path.join(__dirname,'../iitc-plugin-mu-calculator.user.js'),'utf8');
const mobileTail = "script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));\n(document.body || document.head || document.documentElement).appendChild(script);";
let server,browser,origin;
before(async()=>{
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/leaflet.css"><link rel="stylesheet" href="/jquery-ui.css"><link rel="stylesheet" href="/iitc-dialog.css"><style>
    :root{--color-bg-trans:#102329;--color-bg-border:#20a8b1;--color-primary:#ffc400;--color-secondary:#fff}body{margin:0;background:#071b23;color:white;font-family:sans-serif}#map{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 39px,#ffffff08 40px),repeating-linear-gradient(90deg,#15323b,#15323b 39px,#ffffff10 40px)}#toolbox_component{position:absolute;right:8px;top:8px;z-index:1000;background:#102329;padding:12px}a{color:#ffc36b;cursor:pointer}.ui-dialog .ui-dialog-titlebar{background:#073f4b;border:0;border-radius:0}.ui-dialog-titlebar-button .ui-icon,.ui-dialog-titlebar-button .ui-button-icon-space{display:none}.leaflet-container{font-family:sans-serif}
    </style></head><body><div id="map"></div><div id="toolbox_component"></div><div id="toolbox"></div><script src="/leaflet.js"></script><script src="/jquery.js"></script><script src="/jquery-ui.js"></script><script>
    const params=new URLSearchParams(location.search), isMobile=params.has('mobile');
    window.hooks={};window.addHook=(name,fn)=>(hooks[name] ||= []).push(fn);window.runHooks=(name,data)=>(hooks[name]||[]).forEach(fn=>fn(data));
    window.currentPane='map';window.show=p=>{currentPane=p;runHooks('paneChanged',p)};
    window.map=L.map('map',{zoomControl:false}).setView([35.09,135.05],11);
    window.portals={};window.exports=[];window.overlays=[];window.dialogCalls=0;
    window.IITC={utils:{isSmartphone:()=>isMobile,exportFile:(text,name,type)=>exports.push({text,name,type})},toolbox:{addButton:({id,label,action})=>{const a=document.createElement('a');a.id=id;a.textContent=label;a.onclick=action;document.getElementById('toolbox_component').append(a)}}};
    window.addLayerGroup=(name,layer,enabled)=>{overlays.push(layer);if(enabled)layer.addTo(map)};
    window.log={debug(){},error:console.error};window.convertTextToTableMagic=text=>text;
    window.plugin=function(){};window.iitcLoaded=true;
    const points=[['a',35,135,'ポータル A'],['b',35.1,135.1,'ポータル B'],['c',35.2,135,'<img src=x onerror=alert(1)>'],['d',35.22,135,'ポータル D'],['e',35.24,135,'ポータル E'],['f',35.26,135,'ポータル F'],['g',35.28,135,'ポータル G']];
    for(const [guid,lat,lng,title] of points){const marker=L.circleMarker([lat,lng],{radius:8,color:'#bdf',fillOpacity:1}).addTo(map);marker.options.data={title};marker.on('click',event=>runHooks('portalSelected',{selectedPortalGuid:guid,event}));portals[guid]=marker;}
    if(!params.has('noDraw')){const drawnItems=L.featureGroup();drawnItems.addLayer(L.polygon([[35,135],[35.1,135.1],[35.2,135]]));drawnItems.addLayer(L.polygon([[35,135],[35.1,135.1],[35.3,135],[35.4,135.2]]));for(const line of [[[35,135],[35.1,135.1]],[[35.1,135.1],[35.22,135]],[[35.22,135],[35,135]]])drawnItems.addLayer(L.polyline(line));plugin.drawTools={drawnItems};}
    </script><script src="/iitc-dialog.js"></script><script>setupDialogs();window.DIALOG_SLIDE_DURATION=0;const standardDialog=window.dialog;window.dialog=options=>{dialogCalls++;return standardDialog(options)};</script><script src="/plugin.js${'${location.search}'}"></script></body></html>`;
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    let body,type='application/javascript';
    if(url.pathname==='/leaflet.js')body=fs.readFileSync(require.resolve('leaflet/dist/leaflet.js'));
    else if(url.pathname==='/leaflet.css'){body=fs.readFileSync(require.resolve('leaflet/dist/leaflet.css'));type='text/css';}
    else if(url.pathname==='/jquery.js')body=fs.readFileSync(require.resolve('jquery/dist/jquery.js'));
    else if(url.pathname==='/jquery-ui.js')body=fs.readFileSync(require.resolve('jquery-ui-dist/jquery-ui.js'));
    else if(url.pathname==='/jquery-ui.css'){body=fs.readFileSync(require.resolve('jquery-ui-dist/jquery-ui.css'));type='text/css';}
    else if(url.pathname.startsWith('/images/')){body=fs.readFileSync(path.join(path.dirname(require.resolve('jquery-ui-dist/jquery-ui.js')),'images',path.basename(url.pathname)));type='image/png';}
    else if(url.pathname==='/iitc-dialog.js')body=fs.readFileSync(path.join(__dirname,'fixtures/iitc-dialog.js'));
    else if(url.pathname==='/iitc-dialog.css'){body=fs.readFileSync(path.join(__dirname,'fixtures/iitc-dialog.css'));type='text/css';}
    else if(/^\/dialog_(redeem|artifact|cellscore|text)\.css$/.test(url.pathname)){body='';type='text/css';}
    else if(url.pathname==='/plugin.js')body=url.searchParams.has('mobile')?source.replace(mobileTail,'wrapper(info);'):source;
    else {body=html.replace('<script src="/plugin.js${location.search}"></script>','<script src="/plugin.js'+url.search+'"></script>');type='text/html;charset=utf-8';}
    res.writeHead(200,{'Content-Type':type});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const executable=process.env.BROWSER_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
  browser=await chromium.launch({executablePath:executable,headless:true});
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function pageFor(query='',viewport={width:1280,height:800}) {
  const context=await browser.newContext({viewport,hasTouch:query.includes('mobile'),isMobile:query.includes('mobile')});
  const page=await context.newPage();page.errors=[];page.on('pageerror',error=>page.errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.route('https://api.investigatexm.com/**',route=>{
    const request=route.request();
    if(request.url().endsWith('/health'))return route.fulfill({json:{ok:true,model:'fixture-model'}});
    const data=request.postDataJSON(),result=v=>({mu:12345,area_km2:12.34,coordinates:v.map(p=>p.lat.toFixed(6)+', '+p.lng.toFixed(6))});
    return route.fulfill({json:data.fields?{model:'fixture-model',results:data.fields.map((f,index)=>({id:f.id,index,ok:true,...result(f.coordinates)}))}:{model:'fixture-model',...result(data.coordinates)}});
  });
  await page.goto(origin+'/'+query);await page.locator('#toolbox_component').getByText('MU Calculator',{exact:true}).click();
  return {page,context};
}
async function click(page,text){await page.getByRole('button',{name:text,exact:true}).click();}
async function pick(page,guids){for(const guid of guids)await page.evaluate(guid=>portals[guid].fire('click'),guid);}
async function expectText(page,text){await page.getByText(text,{exact:false}).first().waitFor();}

test('desktop: single field, XSS, API, hide/highlight/color, delete and clear',async()=>{
  const {page,context}=await pageFor();
  try {
    assert.equal(await page.evaluate(()=>dialogCalls),1);
    await click(page,'選択開始');await pick(page,['a','b','c']);
    await expectText(page,'登録 1 CF');assert.equal(await page.locator('.muc-panel img').count(),0);
    await click(page,'MU計算');await expectText(page,'合計推定 12,345 MU');
    await click(page,'非表示にする');await click(page,'表示する');await click(page,'強調表示');
    await page.waitForFunction(()=>overlays[0].getLayers().length===2);
    const layerState=await page.evaluate(()=>{const o=overlays[0];return {layers:o.getLayers().length,interactive:o.getLayers().filter(l=>l instanceof L.Polygon).map(l=>l.options.interactive)}});
    assert.equal(layerState.layers,2);assert.deepEqual(layerState.interactive,[false]);
    await page.screenshot({path:'test-results/desktop.png'});
    await click(page,'JSON出力');const data=await page.evaluate(()=>JSON.parse(exports.at(-1).text));assert.equal(data.fields.length,1);assert.equal(data.fields[0].result.mu,12345);
    await click(page,'CSV出力');assert.equal((await page.evaluate(()=>exports.at(-1).text)).charCodeAt(0),0xfeff);
    await click(page,'CF削除');await expectText(page,'登録 0 CF');
    await click(page,'選択開始');await pick(page,['d','a','b']);
    await click(page,'MU計算');await expectText(page,'合計推定 12,345 MU');
    await click(page,'JSON出力');
    const replacement=await page.evaluate(()=>JSON.parse(exports.at(-1).text));
    assert.equal(replacement.fields[0].id,'CF1');
    assert.equal(replacement.fields[0].vertices[0].guid,'d');
    await page.waitForFunction(()=>{
      const polygon=overlays[0].getLayers().find(l=>l instanceof L.Polygon);
      return polygon && polygon.getLatLngs()[0].some(p=>p.lat===35.22) && !polygon.getLatLngs()[0].some(p=>p.lat===35.2);
    });
    page.once('dialog',dialog=>dialog.accept());await click(page,'全クリア');
    assert.deepEqual(page.errors,[]);
  } finally {await context.close();}
});
test('desktop: Draw Tools preview, batch import, no writes, imported portal metadata',async()=>{
  const {page,context}=await pageFor();
  try {
    const before=await page.evaluate(()=>JSON.stringify(plugin.drawTools.drawnItems.toGeoJSON()));
    await click(page,'両方');await expectText(page,'追加可能 2 CF');await expectText(page,'対象外・無効図形 1');
    await click(page,'確認して登録');await expectText(page,'登録 2 CF');
    assert.equal(await page.evaluate(()=>JSON.stringify(plugin.drawTools.drawnItems.toGeoJSON())),before);
    await click(page,'JSON出力');const data=await page.evaluate(()=>JSON.parse(exports.at(-1).text));
    assert.equal(data.fields.length,2);assert.equal(data.fields[0].vertices[0].guid,'a');
    await click(page,'MU計算');await expectText(page,'合計推定 24,690 MU');
    await click(page,'両方');await expectText(page,'追加可能 0 CF');assert.deepEqual(page.errors,[]);
  } finally {await context.close();}
});
test('mobile: native wrapper transform, continuous touch selection, shared edge, portrait and landscape',async()=>{
  assert(source.includes(mobileTail),'Mobile loader must recognize the exact standard IITC injection tail');
  const {page,context}=await pageFor('?mobile',{width:390,height:844});
  try {
    assert.equal(await page.evaluate(()=>dialogCalls),1);
    assert.equal(await page.locator('.muc-dialog-mobile .ui-dialog-title').textContent(),'MU Calculator');
    assert.equal(await page.locator('.muc-dialog-mobile .ui-dialog-titlebar-button-close').isVisible(),true);
    assert.equal(await page.locator('.ui-widget-overlay').count(),0);
    await page.locator('.muc-panel select').selectOption('edge');await click(page,'選択開始');
    // Actual touchscreen taps on Leaflet portal markers, not hook-only calls.
    const sequence=['a','b','c','d','e','f','g'];
    for(const guid of sequence) {
      const position=await page.evaluate(guid=>{
        // Pan each target into the map area above the always-visible panel.
        map.panTo(portals[guid].getLatLng(),{animate:false});
        map.panBy([0,map.getSize().y/2-120],{animate:false});
        const pt=map.latLngToContainerPoint(portals[guid].getLatLng());return {x:pt.x,y:pt.y};
      },guid);
      await page.touchscreen.tap(position.x,position.y);
      await page.waitForFunction(count=>document.querySelector('.muc-status').textContent.includes('選択中 · '+count+'頂点'),sequence.indexOf(guid)+1);
      // Space taps beyond Leaflet's native double-tap interval, as when selecting separate portals.
      await page.waitForTimeout(350);
    }
    await expectText(page,'登録 5 CF');
    await click(page,'MU計算');await expectText(page,'合計推定 61,725 MU');
    const bounds=await page.locator('.muc-dialog-mobile').boundingBox();assert(bounds.x>=0 && bounds.x+bounds.width<=390);
    assert(await page.locator('.muc-scroll').evaluate(e=>e.scrollHeight>e.clientHeight));
    await page.screenshot({path:'test-results/mobile-portrait.png'});
    await page.setViewportSize({width:844,height:390});await page.evaluate(()=>map.invalidateSize());
    await page.screenshot({path:'test-results/mobile-landscape.png'});
    const landscape=await page.locator('.muc-dialog-mobile').boundingBox();assert(landscape.y>=0 && landscape.y+landscape.height<=390);
    await page.evaluate(()=>show('info'));assert.equal(await page.locator('.muc-panel').isVisible(),false);
    await page.evaluate(()=>show('map'));await page.locator('.muc-panel').waitFor({state:'visible'});
    // Standard IITC titlebar controls remain available in both orientations.
    await page.locator('.ui-dialog-titlebar-button-collapse').tap();
    await page.locator('.muc-panel').waitFor({state:'hidden'});
    assert.equal(await page.locator('.ui-dialog-titlebar-button-close').isVisible(),true);
    await page.locator('.ui-dialog-titlebar-button-collapse').tap();
    await page.locator('.muc-panel').waitFor({state:'visible'});
    await click(page,'選択開始');
    await page.locator('.ui-dialog-titlebar-button-close').tap();
    await page.locator('.muc-dialog').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>DIALOG_COUNT),0);
    // Closing ends portal selection while preserving the registered plan.
    await page.evaluate(()=>{
      portals.h=L.marker([36,136]);portals.h.options.data={title:'closed-panel portal'};
      runHooks('portalSelected',{selectedPortalGuid:'h'});
      show('info');
    });
    await page.locator('#toolbox_component').getByText('MU Calculator',{exact:true}).click();
    await expectText(page,'登録 5 CF');
    assert.equal(await page.evaluate(()=>currentPane),'map');
    assert.equal(await page.locator('.muc-dialog').count(),1);
    assert.equal(await page.locator('.muc-status').textContent().then(text=>text.includes('選択中')),false);
    await click(page,'JSON出力');
    assert.equal(await page.evaluate(()=>JSON.parse(exports.at(-1).text).selection.length),7);
    await page.evaluate(()=>show('info'));
    await page.locator('#toolbox_component').getByText('MU Calculator',{exact:true}).click();
    assert.equal(await page.locator('.muc-dialog').count(),1);
    assert.equal(await page.evaluate(()=>hooks.portalSelected.length),1);
    assert.deepEqual(page.errors,[]);
  } finally {await context.close();}
});
test('persistence: reload restores results unverified, repeated setup guarded, map pan/zoom preserves polygons',async()=>{
  const {page,context}=await pageFor();
  try {
    await click(page,'選択開始');await pick(page,['a','b','c']);await click(page,'MU計算');await expectText(page,'合計推定 12,345 MU');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('iitc.muCalculator.v1')||'{}').fields?.[0]?.status==='success');
    await page.reload();await page.locator('#toolbox_component').getByText('MU Calculator',{exact:true}).click();await expectText(page,'モデル未確認');
    await page.evaluate(()=>{bootPlugins.forEach(setup=>setup());map.panBy([50,50]);map.setZoom(12)});
    assert.equal(await page.evaluate(()=>hooks.portalSelected.length),1);assert.equal(await page.evaluate(()=>overlays[0].getLayers().filter(l=>l instanceof L.Polygon).length),1);
    await click(page,'MU計算');await expectText(page,'合計推定 12,345 MU');assert.deepEqual(page.errors,[]);
  } finally {await context.close();}
});
test('Draw Tools absent: disabled import only; JSON file import works',async()=>{
  const {page,context}=await pageFor('?noDraw');
  try {
    assert.equal(await page.getByRole('button',{name:'両方',exact:true}).isDisabled(),true);
    await click(page,'JSONインポート');
    const data={schemaVersion:1,mode:'free',fields:[{id:'CF8',vertices:[{lat:35,lng:135},{lat:35.1,lng:135.1},{lat:35.2,lng:135}]}]};
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('input[type=file]').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await expectText(page,'登録 1 CF');await click(page,'MU計算');await expectText(page,'合計推定 12,345 MU');
    assert.deepEqual(page.errors,[]);
  } finally {await context.close();}
});
