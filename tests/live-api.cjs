'use strict';
// Optional network smoke test: only the public example coordinates from the API docs.
const assert = require('node:assert/strict');
const C = require('../iitc-plugin-mu-calculator.user.js');
const vertices=[{lat:52.324297,lng:10.182664},{lat:52.244048,lng:10.167482},{lat:52.295984,lng:10.231064}];
const env={AbortController,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,'User-Agent':'IITC-MU-Calculator-test/1.0','Origin':'https://intel.ingress.com'}})};
(async()=>{
  const health=await C.request('/health',undefined,C.token(),env);assert.equal(health.ok,true);
  const single=await C.request('/getMU',JSON.stringify({coordinates:vertices,detail:false}),C.token(),env);
  assert(C.validResult(single));assert(single.coordinates.length===3);
  const bulk=await C.request('/getMUbulk',JSON.stringify({fields:[{id:'valid',coordinates:vertices},{id:'invalid',coordinates:[vertices[0],vertices[0],vertices[0]]}],detail:false}),C.token(),env);
  assert.equal(bulk.results[0].ok,true);assert.equal(bulk.results[1].ok,false);assert.equal(bulk.results[0].mu,single.mu);
  const preflight=await env.fetch(C.API+'/getMUbulk',{method:'OPTIONS',headers:{Origin:'https://intel.ingress.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'},signal:AbortSignal.timeout(25000)});
  assert(preflight.ok);assert(['*','https://intel.ingress.com'].includes(preflight.headers.get('access-control-allow-origin')));
  console.log(JSON.stringify({health:health.ok,model:health.model,singleMU:single.mu,singleArea:single.area_km2,bulkSuccess:bulk.results[0].ok,bulkFailure:bulk.results[1].ok,cors:preflight.headers.get('access-control-allow-origin')},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
