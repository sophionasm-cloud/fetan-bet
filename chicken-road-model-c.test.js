'use strict';
const assert=require('node:assert/strict');
const {calibrateTraffic,committedOutcomes,theoreticalRtp}=require('./chicken-road-model-c-simulate');
const {multiplier}=require('./chicken-road-engine');
for(const d of ['easy','medium','hard']){
  const p=calibrateTraffic(5000)[d];
  const first=committedOutcomes(p,'fixed-round');
  assert.deepEqual(committedOutcomes(p,'fixed-round'),first,'refresh/retry seed reconstructs identical commitments');
  assert.equal(first.length,14);
  assert.ok(first.every(x=>x==='safe'||x==='collision'));
  assert.ok(theoreticalRtp(p,d,'cashout_3')>=0);
  assert.ok(multiplier(d,14)>multiplier(d,3));
}
console.log('chicken-road-model-c.test.js: reproducible hidden commitment checks passed');
