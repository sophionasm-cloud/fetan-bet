// Rocket Crash client constants. Server-owned defaults arrive in /state and
// override the game values here. Visual-only tuning lives here because the
// frontend has no build step and cannot require crash-config.js.
'use strict';
window.CrashConfig = Object.freeze({
  gameName: 'Rocket Crash',
  minStake: 100,
  maxStake: 100000,
  minAutoCashout: 101,
  maxHundredths: 100000,
  maxWin: 1000000,
  growthK: 0.087,
  bettingMs: 6000,
  crashedMs: 3000,
  edgeBp: 300,
  redPillThreshold: 1000,
  stripLength: 10,
  displayBets: 50,
  tickMs: 250,
  pollMs: 500,
  streamBackoff: [1000, 2000, 4000, 8000, 15000],
  currency: 'ETB',
  dprCap: 2,
  lowDprCap: 1.5,
  maxCurvePoints: 300,
  embersPerSecond: 42,
  maxEmbers: 80,
  lowEmbers: 40,
  crashParticles: 90,
  lowCrashParticles: 45,
  qualityWindow: 30,
  qualityFrameMs: 24,
  historyModalRows: 50
});
