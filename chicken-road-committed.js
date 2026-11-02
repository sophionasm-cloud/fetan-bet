'use strict';

// Model C outcome primitives. Not wired to an API or settlement path.
const crypto = require('node:crypto');
const { LANES } = require('./chicken-road-engine');

const ENGINE_VERSION = 1;
const PROBABILITY_VERSION = 1;
const DIFFICULTIES = Object.freeze({
  easy: Object.freeze([235120,240443,239840,242377,243055,242213,239859,240384,240813,242582,247703,245075,242225,239900]),
  medium: Object.freeze([282300,291000,291600,292000,294500,296000,290700,293100,288500,298500,298500,314200,300800,278400]),
  hard: Object.freeze([323800,335600,337300,340000,334400,338300,346400,338000,338300,344600,351600,353300,330400,320200]),
});
const SCALE = 1_000_000;

function generateRoundSeed(){return crypto.randomBytes(32);}
function commitSeed(seed){if(!Buffer.isBuffer(seed)||seed.length!==32)throw new TypeError('Expected a 256-bit server seed');return crypto.createHash('sha256').update(seed).digest('hex');}
function laneUniform(seed,roundId,difficulty,lane,configVersion=PROBABILITY_VERSION){
  if(!Buffer.isBuffer(seed)||seed.length!==32||!roundId||!DIFFICULTIES[difficulty]||!Number.isInteger(lane)||lane<1||lane>LANES)throw new TypeError('Invalid committed-outcome inputs');
  const msg=`chicken-road-dash|engine:${ENGINE_VERSION}|config:${configVersion}|round:${roundId}|difficulty:${difficulty}|lane:${lane}`;
  const bytes=crypto.createHmac('sha256',seed).update(msg).digest();
  return bytes.readUInt32BE(0);
}
function laneOutcomes(seed,roundId,difficulty){
  return DIFFICULTIES[difficulty].map((p,lane)=>{const uniform=laneUniform(seed,roundId,difficulty,lane+1);return {lane:lane+1,probabilityPpm:p,uniform,outcome:uniform<Math.floor(p/1_000_000*0x100000000)?'collision':'safe'};});
}
function outcomeLeaf(roundId,lane,outcome,salt){return crypto.createHash('sha256').update(`${roundId}|${lane}|${outcome}|${salt}`).digest();}
function merkleTree(roundId,outcomes){
  if(!Array.isArray(outcomes)||outcomes.length!==LANES)throw new TypeError('Expected fourteen lane outcomes');
  const salts=outcomes.map(()=>crypto.randomBytes(32).toString('hex'));
  let level=outcomes.map((x,i)=>outcomeLeaf(roundId,x.lane,x.outcome,salts[i]));
  for(let i=LANES;i<16;i++)level.push(crypto.createHash('sha256').update(`chicken-road-dash-pad|${roundId}|${i+1}`).digest());
  const proofPaths=outcomes.map(()=>[]),indices=outcomes.map((_,i)=>i);
  while(level.length>1){
    for(let i=0;i<indices.length;i++){const index=indices[i],sibling=index^1;proofPaths[i].push(level[sibling].toString('hex'));indices[i]=Math.floor(index/2);}
    const next=[];for(let i=0;i<level.length;i+=2)next.push(crypto.createHash('sha256').update(Buffer.concat([level[i],level[i+1]])).digest());level=next;
  }
  return {root:level[0].toString('hex'),salts,proofs:proofPaths};
}
function verifyProof(roundId,lane,outcome,salt,proof,root){
  let node=outcomeLeaf(roundId,lane,outcome,salt),index=lane-1;
  for(const siblingHex of proof){const sibling=Buffer.from(siblingHex,'hex');node=crypto.createHash('sha256').update(Buffer.concat(index%2?[sibling,node]:[node,sibling])).digest();index=Math.floor(index/2);}
  return node.toString('hex')===root;
}
module.exports={ENGINE_VERSION,PROBABILITY_VERSION,DIFFICULTIES,SCALE,generateRoundSeed,commitSeed,laneUniform,laneOutcomes,merkleTree,verifyProof};
