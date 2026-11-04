'use strict';
const assert=require('node:assert/strict');
const c=require('./chicken-road-committed');
for(const d of ['easy','medium','hard']){
 const seed=c.generateRoundSeed(),hash=c.commitSeed(seed),a=c.laneOutcomes(seed,'round-test',d);
 assert.equal(hash,c.commitSeed(seed));assert.equal(a.length,14);
 assert.deepEqual(a,c.laneOutcomes(seed,'round-test',d));
 const tree=c.merkleTree('round-test',a);
 assert.equal(a.every((x,i)=>c.verifyProof('round-test',x.lane,x.outcome,tree.salts[i],tree.proofs[i],tree.root)),true);
 assert.equal(c.verifyProof('round-test',1,a[0].outcome==='safe'?'collision':'safe',tree.salts[0],tree.proofs[0],tree.root),false);
 assert.notEqual(c.commitSeed(c.generateRoundSeed()),hash);
}
assert.throws(()=>c.laneOutcomes(Buffer.alloc(31),'r','easy'));
for(const d of ['easy','medium','hard']){
 const expected={easy:15,medium:9,hard:9}[d];
 const seed=c.generateRoundSeed(),a=c.laneOutcomesV2(seed,'round-v2',d);
 assert.equal(a.length,expected);
 assert.deepEqual(a,c.laneOutcomesV2(seed,'round-v2',d));
 assert.equal(a.every(x=>x.outcome==='safe'||x.outcome==='collision'),true);
 assert.equal(a.every((x,i)=>x.lane===i+1&&x.line===require('./chicken-road-2-config').MODES[d].lines[i]),true);
 const tree=c.merkleTreeV2('round-v2',a);
 assert.equal(a.every((x,i)=>c.verifyProof('round-v2',x.lane,x.outcome,tree.salts[i],tree.proofs[i],tree.root)),true);
 assert.equal(c.verifyProof('round-v2',1,a[0].outcome==='safe'?'collision':'safe',tree.salts[0],tree.proofs[0],tree.root),false);
}
console.log('chicken-road-committed.test.js: seed commitment and Merkle proof checks passed');
