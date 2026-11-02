'use strict';

// Offline Model C investigation only. This does not call game APIs or wallets.
const crypto = require('node:crypto');
const { CONFIG, LANES, makeTraffic, crossingCollision, multiplier } = require('./chicken-road-engine');

const MASTER = Buffer.from('5c8f0e1f32a4c7d9981a6d345abcfed7123456789abcdef0fedcba9876543210','hex');
function deterministicBytes(label, length=32) {
  const parts=[]; let n=0;
  while(Buffer.concat(parts).length<length) parts.push(crypto.createHmac('sha256',MASTER).update(label+':'+n++).digest());
  return Buffer.concat(parts).subarray(0,length);
}
function rng(seed) {
  let x=seed.readUInt32BE(0)||1;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/0x100000000;};
}
function wilson(k,n){const z=1.96,p=k/n,z2=z*z,d=1+z2/n,c=(p+z2/(2*n))/d,r=z*Math.sqrt((p*(1-p)+z2/(4*n))/n)/d;return [Math.max(0,c-r),Math.min(1,c+r)];}
function meanCi(sum,sq,n,bet){const m=sum/n,se=Math.sqrt(Math.max(0,sq/n-m*m)/n);return [m/bet,Math.max(0,m-1.96*se)/bet,(m+1.96*se)/bet];}

function calibrateTraffic(rounds=100000){
  const out={};
  for(const d of ['easy','medium','hard']){
    const entered=Array(LANES).fill(0), hit=Array(LANES).fill(0);
    for(let i=0;i<rounds;i++){
      const seed=deterministicBytes('traffic:'+d+':'+i), traffic=makeTraffic(seed,d);
      let t=0, alive=true;
      for(let lane=1;lane<=LANES;lane++){
        if(!alive)break;
        entered[lane-1]++;
        if(crossingCollision(traffic,lane,t,d)){hit[lane-1]++;alive=false;break;}
        t+=CONFIG[d].hopTime;
      }
    }
    out[d]=entered.map((n,i)=>({lane:i+1,entered:n,collision:hit[i],p:hit[i]/n,ci95:wilson(hit[i],n)}));
  }
  return out;
}

function committedOutcomes(probabilities, label){
  // One immutable HMAC-derived Bernoulli outcome per lane, all generated
  // before the round begins. In production this seed must be precommitted.
  const seed=deterministicBytes('round:'+label), toss=rng(seed);
  return probabilities.map((x)=>toss()<x.p?'collision':'safe');
}

function optimalCashout(probabilities,difficulty){
  let continuation=multiplier(difficulty,LANES)*1.5;
  for(let k=LANES;k>=1;k--){
    const survive=1-probabilities[k-1].p;
    continuation=Math.max(multiplier(difficulty,k),survive*continuation);
  }
  return continuation;
}

function theoreticalRtp(probabilities,difficulty,policy){
  const surv=(n)=>probabilities.slice(0,n).reduce((a,x)=>a*(1-x.p),1);
  if(policy==='cashout_3')return surv(3)*multiplier(difficulty,3);
  if(policy==='cashout_7')return surv(7)*multiplier(difficulty,7);
  if(policy==='cashout_14')return surv(14)*multiplier(difficulty,14);
  const finish=surv(14)*multiplier(difficulty,14)*1.5;
  if(policy==='always_accept_to_finish')return finish;
  if(policy==='optimal_hidden_adaptive')return Math.max(finish,...Array.from({length:14},(_,i)=>surv(i+1)*multiplier(difficulty,i+1)));
  // If the next immutable outcome is disclosed before the accept/cashout
  // decision, this tested policy cashes at the current multiplier on a known
  // crash and otherwise continues to finish.
  let v=finish;
  for(let k=1;k<=LANES;k++)v+=surv(k-1)*probabilities[k-1].p*(k===1?0:multiplier(difficulty,k-1));
  return v;
}

function simulate({rounds=100000,calibrationRounds=100000,calibrationData=null,bets=[100,300,50000]}={}){
  const calibration=calibrationData||calibrateTraffic(calibrationRounds), rows=[];
  for(const difficulty of ['easy','medium','hard']){
    const p=calibration[difficulty];
    const adaptiveValue=optimalCashout(p,difficulty);
    const policyNames=['always_accept_to_finish','cashout_3','cashout_7','cashout_14','optimal_hidden_adaptive','visible_outcome_selective'];
    for(const policy of policyNames){
      const sums=Object.fromEntries(bets.map(b=>[b,{sum:0,sq:0,max:0}]));
      let roundsAlive=0,collisions=0,finishes=0,cashouts=0,survivedAt=[];
      for(let i=0;i<rounds;i++){
        const outcomes=committedOutcomes(p,'sim-'+difficulty+'-'+i);
        if(outcomes.every(x=>x==='safe'))roundsAlive++;
        let reached=0,hitAt=0,payoutMult=0,cash=false,finish=false;
        if(policy==='optimal_hidden_adaptive'){
          // Since only previously resolved outcomes are visible, surviving
          // progression is the only new information; use optimal stopping EV.
          let bestStep=1,bestValue=-1;
          for(let k=1;k<=LANES;k++){const survival=p.slice(0,k).reduce((a,x)=>a*(1-x.p),1);const value=survival*multiplier(difficulty,k);if(value>bestValue){bestValue=value;bestStep=k;}}
          const finishValue=p.reduce((a,x)=>a*(1-x.p),1)*multiplier(difficulty,LANES)*1.5;
          if(finishValue>bestValue)bestStep='finish';
          for(let k=1;k<=LANES;k++){if(outcomes[k-1]==='collision'){hitAt=k;break;}reached=k;if(bestStep===k){payoutMult=multiplier(difficulty,k);cash=true;break;}}
          if(!hitAt&&bestStep==='finish'&&reached===LANES){payoutMult=multiplier(difficulty,LANES)*1.5;finish=true;}
        } else {
          for(let k=1;k<=LANES;k++){
            const outcome=outcomes[k-1];
            if(policy==='visible_outcome_selective'&&outcome==='collision'){
              hitAt=k;
              if(reached>0){payoutMult=multiplier(difficulty,reached);cash=true;hitAt=0;}
              break;
            }
            if(outcome==='collision'){hitAt=k;break;}
            reached=k;
            if(policy==='cashout_3'&&k===3||policy==='cashout_7'&&k===7||policy==='cashout_14'&&k===14){payoutMult=multiplier(difficulty,k);cash=true;break;}
          }
          if((policy==='always_accept_to_finish'||policy==='visible_outcome_selective')&&!hitAt&&reached===LANES){payoutMult=multiplier(difficulty,LANES)*1.5;finish=true;}
        }
        if(hitAt)collisions++;
        if(finish)finishes++;
        if(cash)cashouts++;
        survivedAt.push(reached);
        for(const bet of bets){const payout=Math.round(bet*payoutMult),x=sums[bet];x.sum+=payout;x.sq+=payout*payout;x.max=Math.max(x.max,payout);}
      }
      for(const bet of bets){const x=sums[bet],ci=meanCi(x.sum,x.sq,rounds,bet);rows.push({difficulty,policy,bet_santim:bet,rounds,calibration_rounds:calibrationRounds,theoretical_rtp:theoreticalRtp(p,difficulty,policy),rtp:ci[0],rtp_ci95:ci.slice(1),house_edge:1-ci[0],collision_rate:collisions/rounds,finish_rate:finishes/rounds,cashout_rate:cashouts/rounds,all14_survival_rate:roundsAlive/rounds,average_crossings:survivedAt.reduce((a,b)=>a+b,0)/rounds,average_payout_santim:x.sum/rounds,maximum_payout_santim:x.max,optimal_hidden_value:adaptiveValue});}
    }
  }
  return {calibration,rows};
}

if(require.main===module){const r=Math.max(100000,Number(process.argv[2])||100000);process.stdout.write(JSON.stringify(simulate({rounds:r,calibrationRounds:r}),null,2)+'\n');}
module.exports={calibrateTraffic,committedOutcomes,optimalCashout,theoreticalRtp,simulate};
