'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../iitc-plugin-mu-calculator.user.js');
const A = {lat:35,lng:135,guid:'a',name:'頂点A'};
const B = {lat:35.1,lng:135.1,guid:'b',name:'頂点B'};
const D = {lat:35.2,lng:135,guid:'c',name:'頂点C'};
const triangle = [A,B,D];
const coords = v => v.map(p => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
function storeOf(count) {
  const s = new C.Store();
  for (let i=0;i<count;i++) s.add([A,B,{lat:35.2+i/10000,lng:135,guid:'c'+i}]);
  return s;
}
function transport(log = [], options = {}) {
  return async (path,body,job) => {
    log.push({path,body});
    if (job.cancelled) throw Error('cancelled');
    if (path === '/health') { if (options.healthError) throw Error('offline'); return {ok:true,model:options.model || 'model1'}; }
    const data = JSON.parse(body), model = options.model || 'model1';
    if (options.networkError) throw Error('network unavailable');
    if (path === '/getMU') return {mu:1234,area_km2:3,coordinates:coords(data.coordinates),model};
    return {model,results:data.fields.map((f,index) => options.partial && index === 1 ?
      {id:f.id,index,ok:false,error:'deadline exceeded'} :
      {id:f.id,index,ok:true,mu:1234,area_km2:3,coordinates:coords(f.coordinates)})};
  };
}

test('half-up rounding matches decimal API precision for both signs and small exponents',() => {
  for (const [n,want] of [[1.2345645,1.234565],[-1.2345645,-1.234565],[0.0000005,0.000001],[-0.0000005,-0.000001],[1e-9,0],[135,135]]) assert.equal(C.round6(n),want);
  assert.equal(C.pointKey(C.point({lat:-0,lng:180})),'0.000000,-180.000000');
  assert.equal(C.pointKey(C.point({lat:90,lng:120})),'90.000000,0.000000');
});
test('invalid coordinates, rounded duplicates, great circle zero area and antipodes rejected',() => {
  for (const p of [{lat:91,lng:0},{lat:0,lng:181},{lat:NaN,lng:0},{lat:'35',lng:0}]) assert.throws(() => C.point(p));
  assert.throws(() => C.triangle([A,{...A,lat:A.lat+1e-8},D]));
  assert.throws(() => C.triangle([{lat:0,lng:0},{lat:0,lng:1},{lat:0,lng:2}]));
  assert.throws(() => C.triangle([{lat:35,lng:135},{lat:36,lng:135},{lat:37,lng:135}]));
  assert.throws(() => C.triangle([{lat:0,lng:0},{lat:0,lng:180},{lat:2,lng:2}]));
  assert.equal(C.triangle(triangle).length,3);
});
test('spherical rather than flat collinearity and tiny nonzero triangles',() => {
  assert.equal(C.triangle([{lat:35,lng:135},{lat:35.1,lng:135.1},{lat:35.2,lng:135.2}]).length,3);
  assert.equal(C.triangle([{lat:35,lng:135},{lat:35.000001,lng:135},{lat:35,lng:135.000001}]).length,3);
});
test('single field selection, vertex deletion and next single selection',() => {
  const s = new C.Store(); triangle.forEach(v => s.select(v));
  assert.equal(s.fields.length,1); assert.equal(s.selection.length,3);
  s.selection.splice(2,1); s.select(D); assert.equal(s.fields.length,1);
  s.select({lat:36,lng:135,guid:'next'}); assert.equal(s.selection.length,1);
});
test('shared edge plus five vertices creates five independent fields without fixed limit',() => {
  const s = new C.Store(); s.mode = 'edge'; s.select(A); s.select(B);
  for (let i=0;i<105;i++) s.select({lat:35.2+i/10000,lng:135,guid:'c'+i});
  assert.equal(s.fields.length,105); assert.equal(s.selection.length,107);
  assert.deepEqual(s.fields[4].vertices.slice(0,2).map(p => p.guid),['a','b']);
});
test('free selection resets pending vertices and preserves fields',() => {
  const s = new C.Store(); s.mode='free'; triangle.forEach(v => s.select(v));
  assert.equal(s.selection.length,0); [A,B,{...D,lat:36,guid:'d'}].forEach(v => s.select(v)); assert.equal(s.fields.length,2);
});
test('field deduplication ignores order, works across portals and Draw Tools, GUID primary',() => {
  const s = new C.Store(); s.add(triangle);
  assert.equal(s.add([D,A,B]),null);
  assert.equal(s.add(triangle.map(({lat,lng}) => ({lat,lng})),'draw'),null);
  assert.equal(s.add(triangle.map(p => ({...p,lat:p.lat+0.01}))),null);
});
test('CF removal and clear also remove cache, selection and highlight',() => {
  const s = storeOf(2); s.remove('CF1'); assert.deepEqual(s.fields.map(f=>f.id),['CF2']);
  s.selection=[A];s.highlight='CF2';s.cache.test={};s.clear(); assert.equal(s.fields.length,0);assert.equal(s.selection.length,0);assert.equal(Object.keys(s.cache).length,0);assert.equal(s.highlight,'');
});
test('versioned storage roundtrip restores settings and marks results unverified',async () => {
  const s = storeOf(1); s.mode='edge';s.selection=[A,B,D];s.fields[0].visible=false;
  await C.calculate(s,C.token(),transport());
  const restored = C.Store.parse(JSON.parse(JSON.stringify(s.export())));
  assert.equal(restored.mode,'edge');assert.equal(restored.fields[0].visible,false);
  assert.equal(restored.fields[0].status,'stale');assert.equal(restored.summary().mu,0);assert.equal(restored.selection.length,3);
  assert.throws(()=>C.Store.parse({schemaVersion:100,fields:[]}));
  assert.throws(()=>C.Store.parse({schemaVersion:1,fields:[{vertices:[A,A,A]}]}));
});
test('single API request uses documented endpoint and sums results',async () => {
  const s=storeOf(1),log=[];await C.calculate(s,C.token(),transport(log));
  assert.deepEqual(log.map(r=>r.path),['/health','/getMU']);assert.equal(s.summary().mu,1234);assert.equal(s.summary().area,3);
  assert.deepEqual(JSON.parse(log[1].body).coordinates,triangle.map(({lat,lng})=>({lat,lng})));
});
test('50 fields bulk; 51 and 121 split sequentially, never exceed 50',async () => {
  for (const [count,sizes] of [[50,[50]],[51,[50,1]],[121,[50,50,21]]]) {
    const s=storeOf(count),log=[];await C.calculate(s,C.token(),transport(log));
    assert.deepEqual(log.slice(1).map(r=>JSON.parse(r.body).fields.length),sizes);assert.equal(s.summary().success,count);
    assert.equal(s.summary().mu,count*1234); // overlapping areas are intentionally counted repeatedly
  }
});
test('UTF-8 byte count, body budget partitioning, excessive individual field rejected',() => {
  assert.equal(C.bytes('あ😀'),7);
  const fields=storeOf(5).fields;
  fields.forEach(f=>f.id='日本語'.repeat(100)+f.id);
  const chunks=C.batches(fields,1500);assert(chunks.length>1);assert(chunks.every(chunk=>C.bytes(C.bulkBody(chunk))<=1500));
  assert.throws(()=>C.batches(fields,20));
});
test('partial bulk failures stay null and totals are successful subtotal',async () => {
  const s=storeOf(5);await C.calculate(s,C.token(),transport([],{partial:true}));
  assert.equal(s.fields[1].result,null);assert.equal(s.fields[1].status,'error');assert.equal(s.summary().failed,1);assert.equal(s.summary().mu,4*1234);assert.equal(s.summary().partial,true);
});
test('missing, malformed, mismatched coordinate results fail rather than become zero MU',async () => {
  for (const bad of [{results:[],model:'m'},{mu:'1',area_km2:1,model:'m',coordinates:coords(triangle)},
    {mu:1,area_km2:1,model:'m',coordinates:['0,0','1,1','2,2']}, {mu:1,area_km2:0,model:'m',coordinates:coords(triangle)}]) {
    const s=storeOf(1);await C.calculate(s,C.token(),async path=>path==='/health'?{ok:true,model:'m'}:bad);
    assert.equal(s.fields[0].status,'error');assert.equal(s.fields[0].result,null);
  }
});
test('true zero MU is valid when API returns a nonzero area',async () => {
  const s=storeOf(1);await C.calculate(s,C.token(),async path=>path==='/health'?{ok:true,model:'m'}:{mu:0,area_km2:1,model:'m',coordinates:coords(triangle)});
  assert.equal(s.summary().success,1);assert.equal(s.summary().mu,0);
});
test('network failures do not destroy plan and retry succeeds',async () => {
  const s=storeOf(2);await C.calculate(s,C.token(),transport([],{networkError:true}));assert.equal(s.summary().failed,2);
  await C.calculate(s,C.token(),transport());assert.equal(s.summary().success,2);
});
test('current model cache avoids recalculation; model changes invalidate it; health failure calculates fresh',async () => {
  const s=storeOf(2);await C.calculate(s,C.token(),transport());
  const hit=[];await C.calculate(s,C.token(),transport(hit));assert.deepEqual(hit.map(r=>r.path),['/health']);
  const changed=[];await C.calculate(s,C.token(),transport(changed,{model:'model2'}));assert.equal(changed.length,2);assert.equal(s.summary().models[0],'model2');
  const unknown=[];await C.calculate(s,C.token(),transport(unknown,{healthError:true}));assert.equal(unknown.length,2);
});
test('a model change during a multi-batch run excludes mixed model totals',async () => {
  const s=storeOf(51),base=transport();let index=0;
  await C.calculate(s,C.token(),async(...args)=>{const r=await base(...args);if(args[0]!=='/health')r.model='model'+index++;return r;});
  assert.equal(s.summary().success,0);assert(s.fields.every(f=>f.status==='stale'));
});
test('cancel between batches retains completed fields and cancels unstarted fields',async () => {
  const s=storeOf(51),job=C.token();
  await assert.rejects(C.calculate(s,job,transport(),(done)=>{if(done===50)job.cancel();}));
  assert.equal(s.summary().success,50);assert.equal(s.fields[50].status,'cancelled');
});
test('cancel during health check leaves no pending fields or counted stale results',async () => {
  const s=storeOf(2),job=C.token();
  await assert.rejects(C.calculate(s,job,async()=>{job.cancel();throw new Error('cancelled');}));
  assert(s.fields.every(f=>f.status==='cancelled' && f.result===null));
});
test('reload preserves stable CF identifiers and highlight after deletions',() => {
  const s=storeOf(3);s.remove('CF2');s.highlight='CF3';
  const restored=C.Store.parse(s.export());assert.deepEqual(restored.fields.map(f=>f.id),['CF1','CF3']);assert.equal(restored.highlight,'CF3');
  assert.equal(restored.add([A,B,{lat:36,lng:135}]).id,'CF4');
});
test('polygon detection: flat/nested/closed triangles, duplicates, quadrilateral and holes',async () => {
  const items=[{type:'polygon',latLngs:triangle},{type:'polygon',latLngs:[triangle.concat(A)]},
    {type:'polygon',latLngs:[A,B,D,{lat:36,lng:136}]},{type:'polygon',latLngs:[triangle,triangle]}];
  const before=JSON.stringify(items),r=await C.detect(items,'polygons',C.token());
  assert.equal(r.vertices.length,1);assert.equal(r.skipped,2);assert.equal(r.duplicates,1);assert.equal(JSON.stringify(items),before);
});
test('three explicit links close a triangle; reversed duplicate links are harmless',async () => {
  const items=[[A,B],[B,D],[D,A],[B,A]].map(latLngs=>({type:'polyline',latLngs}));
  assert.equal((await C.detect(items,'links',C.token())).vertices.length,1);
});
test('polyline paths use explicit consecutive segments only; never split at interior points',async () => {
  const a={lat:0,lng:0},b={lat:0,lng:2},c={lat:1,lng:1},middle={lat:0,lng:1};
  const items=[[a,b],[middle,c],[c,a]].map(latLngs=>({type:'polyline',latLngs}));
  assert.equal((await C.detect(items,'links',C.token())).vertices.length,0);
  const path=[{type:'polyline',latLngs:[A,B,D,A]}];assert.equal((await C.detect(path,'links',C.token())).vertices.length,1);
});
test('coordinates rounded to six decimal places join link endpoints',async () => {
  const shifted={...A,lat:A.lat+0.0000001};
  const items=[[A,B],[B,D],[D,shifted]].map(latLngs=>({type:'polyline',latLngs}));
  assert.equal((await C.detect(items,'links',C.token())).vertices.length,1);
});
test('combined polygon and link candidates are deduplicated',async () => {
  const items=[{type:'polygon',latLngs:triangle},...[[A,B],[B,D],[D,A]].map(latLngs=>({type:'polyline',latLngs}))];
  assert.equal((await C.detect(items,'both',C.token())).vertices.length,1);
});
test('thousands of disconnected edges and many closed fields yield control and permit cancellation',async () => {
  const items=[];
  for(let i=0;i<2000;i++) items.push({type:'polyline',latLngs:[{lat:20+i/10000,lng:100},{lat:20+i/10000,lng:101}]});
  for(let i=0;i<100;i++) {
    const v=[{lat:30+i/1000,lng:120},{lat:30+i/1000,lng:121},{lat:30.0005+i/1000,lng:120.5}];
    items.push(...[[v[0],v[1]],[v[1],v[2]],[v[2],v[0]]].map(latLngs=>({type:'polyline',latLngs})));
  }
  let ticks=0;const interval=setInterval(()=>ticks++,0);
  const r=await C.detect(items,'links',C.token());clearInterval(interval);assert.equal(r.vertices.length,100);assert(ticks>2);
  const job=C.token();await assert.rejects(C.detect(items,'links',job,()=>job.cancel()));
});
test('CSV is BOM UTF-8, escapes quotes, Japanese and spreadsheet formulas',async () => {
  const s=storeOf(1);s.fields[0].vertices[0].name='=HYPERLINK("evil")';s.fields[0].vertices[1].name='日本語,改行\n"引用"';
  await C.calculate(s,C.token(),transport());const csv=C.csv(s);
  assert(csv.startsWith('\ufeff'));assert(csv.includes("'="));assert(csv.includes('""evil""'));assert(csv.includes('日本語,改行\n""引用""'));assert(csv.includes('model1'));
});
test('fetch rejects HTTP/CDN HTML/non-JSON, handles timeout and cancellation',async () => {
  for (const [response,pattern] of [[{ok:false,status:403,text:async()=>'<html>blocked</html>'},/HTTP 403/],
    [{ok:true,status:200,text:async()=>'<html>'},/JSON/], [{ok:false,status:400,text:async()=>'{"error":"invalid coordinate"}'},/invalid coordinate/]]) {
    await assert.rejects(C.request('/getMU','{}',C.token(),{AbortController,fetch:async()=>response}),pattern);
  }
  const env={AbortController,fetch:async(url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))};
  await assert.rejects(C.request('/getMU','{}',C.token(),env,10),/タイムアウト/);
  const job=C.token(),pending=C.request('/getMU','{}',job,env);job.cancel();await assert.rejects(pending,/キャンセル/);assert.equal(job.handlers.size,0);
});
test('fetch request contains no forbidden UA or authentication headers',async () => {
  let options;
  const env={AbortController,fetch:async(url,opts)=>{options=opts;return {ok:true,text:async()=>'{"ok":true}'};}};
  assert.deepEqual(await C.request('/health',undefined,C.token(),env),{ok:true});assert.deepEqual(options.headers,{});assert.equal(options.credentials,'omit');
});
test('XHR compatibility when fetch or AbortController is unavailable',async () => {
  let xhr;
  class XHR {
    constructor(){xhr=this;this.status=200;this.responseText='{"ok":true}';this.headers={};}
    open(method,url){this.method=method;this.url=url;}setRequestHeader(k,v){this.headers[k]=v;}send(){queueMicrotask(()=>this.onload());}abort(){this.onabort();}
  }
  const job=C.token();assert.deepEqual(await C.request('/getMU','{}',job,{XMLHttpRequest:XHR}),{ok:true});
  assert.equal(xhr.method,'POST');assert.equal(job.handlers.size,0);assert.equal(xhr.timeout,25000);
});
