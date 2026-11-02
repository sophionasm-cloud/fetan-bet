'use strict';

// Server-side Chicken Road Dash traffic model. Coordinates use the original
// recreation's canonical 800px stage; clients scale positions for display.
const crypto = require('node:crypto');

const STAGE_HEIGHT = 800;
const LANES = 14;
const LANE_WIDTH = 112;
const SIDE_LEFT = 200;
const CHICKEN_HALF_WIDTH = 17;
const CAR_COLLISION_HALF_WIDTH = 51;
const CONFIG = Object.freeze({
  easy: Object.freeze({ speed: 82, density: 0.30, hopTime: 0.34 }),
  medium: Object.freeze({ speed: 122, density: 0.62, hopTime: 0.30 }),
  hard: Object.freeze({ speed: 168, density: 0.90, hopTime: 0.26 }),
});

function stream(seed) {
  let counter = 0;
  let bytes = Buffer.alloc(0);
  return () => {
    if (bytes.length < 4) {
      bytes = crypto.createHmac('sha256', seed).update(String(counter++)).digest();
    }
    const value = bytes.readUInt32BE(0);
    bytes = bytes.subarray(4);
    return value / 0x100000000;
  };
}

function makeTraffic(seed, difficulty, height = STAGE_HEIGHT) {
  if (!Buffer.isBuffer(seed) || seed.length < 32) throw new TypeError('Round seed must contain at least 256 bits');
  if (!CONFIG[difficulty]) throw new TypeError('Unsupported Chicken Road Dash difficulty');
  if (!Number.isFinite(height) || height < 320 || height > 2400) throw new TypeError('Invalid stage height');
  const random = stream(seed);
  const period = height + 440;
  return Array.from({ length: LANES }, (_, index) => {
    const direction = index % 2 === 0 ? 1 : -1;
    const speed = CONFIG[difficulty].speed * (0.78 + random() * 0.42) * (1 + index * 0.018);
    let count = random() < CONFIG[difficulty].density ? 2 : 1;
    if (height > 620 && random() < 0.45) count++;
    if (height > 800 && random() < 0.3) count++;
    const firstY = -80 + random() * period;
    const vehicles = [];
    for (let i = 0; i < count; i++) {
      const length = i === 0 ? 104 + random() * 38 : 100 + random() * 46;
      vehicles.push({ y0: firstY + i * period / count + (random() * 60 - 30), length });
    }
    return { direction, speed, period, vehicles };
  });
}

function vehicleY(lane, vehicle, seconds, height = STAGE_HEIGHT) {
  const top = -220;
  const span = height + 440;
  const raw = vehicle.y0 + lane.direction * lane.speed * seconds;
  return top + ((raw - top) % span + span) % span;
}

function crossingCollision(traffic, step, startedAt, difficulty, height = STAGE_HEIGHT) {
  if (!Array.isArray(traffic) || traffic.length !== LANES || !Number.isInteger(step) || step < 1 || step > LANES + 1) {
    throw new TypeError('Invalid crossing state');
  }
  if (!Number.isFinite(startedAt) || startedAt < 0 || !CONFIG[difficulty]) throw new TypeError('Invalid crossing time or difficulty');
  // The finish sidewalk contains no traffic, matching the original 14 lanes + finish.
  if (step === LANES + 1) return null;
  const lane = traffic[step - 1];
  const duration = CONFIG[difficulty].hopTime;
  const fromX = step === 1 ? SIDE_LEFT * 0.5 : SIDE_LEFT + ((step - 1) - 0.5) * LANE_WIDTH;
  const toX = SIDE_LEFT + (step - 0.5) * LANE_WIDTH;
  const laneX = SIDE_LEFT + ((step - 1) + 0.5) * LANE_WIDTH;
  const enter = Math.max(0, (laneX - CAR_COLLISION_HALF_WIDTH - fromX) / (toX - fromX));
  const leave = Math.min(1, (laneX + CAR_COLLISION_HALF_WIDTH - fromX) / (toX - fromX));
  const y = height * 0.53;
  const samples = Math.max(1, Math.ceil(duration * 120));
  for (const vehicle of lane.vehicles) {
    const radius = vehicle.length / 2 + CHICKEN_HALF_WIDTH;
    for (let i = Math.floor(enter * samples); i <= Math.ceil(leave * samples); i++) {
      const t = startedAt + duration * i / samples;
      if (Math.abs(y - vehicleY(lane, vehicle, t, height)) < radius) return { lane: step, vehicle: lane.vehicles.indexOf(vehicle), at: t };
    }
  }
  return null;
}

// Existing recreation recurrence, without introducing new odds or RTP.
function multiplier(difficulty, step) {
  if (!CONFIG[difficulty] || !Number.isInteger(step) || step < 0 || step > LANES) throw new TypeError('Invalid multiplier request');
  if (step === 0) return 0;
  const increment = { easy: 0.10, medium: 0.18, hard: 0.28 }[difficulty];
  let m = 1;
  for (let i = 1; i <= step; i++) m += increment * (1 + (m - 1) * 0.35);
  return Math.round(m * 100) / 100;
}

module.exports = { CONFIG, STAGE_HEIGHT, LANES, makeTraffic, vehicleY, crossingCollision, multiplier };
