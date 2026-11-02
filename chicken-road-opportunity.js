'use strict';

// Model B prototype only: this in-memory state machine is for simulations and
// tests. A production adapter must persist it transactionally before use.
const crypto = require('node:crypto');
const { CONFIG, LANES, crossingCollision } = require('./chicken-road-engine');

function issueOpportunity(roundId, lane, openedAt, windowSeconds) {
  if (!roundId || !Number.isInteger(lane) || lane < 1 || lane > LANES + 1 || !Number.isFinite(openedAt) || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new TypeError('Invalid opportunity parameters');
  }
  return Object.freeze({
    id: crypto.randomUUID(), roundId: String(roundId), lane,
    openedAt, expiresAt: openedAt + windowSeconds,
  });
}

function resolveAt(traffic, opportunity, serverTime, difficulty) {
  const collision = crossingCollision(traffic, opportunity.lane, serverTime, difficulty);
  return Object.freeze({
    opportunityId: opportunity.id,
    lane: opportunity.lane,
    resolvedAt: serverTime,
    outcome: collision ? 'collision' : opportunity.lane === LANES + 1 ? 'finish' : 'safe',
    collision,
  });
}

class PrototypeOpportunityRound {
  constructor({ id, traffic, difficulty, windowSeconds = 1, clock = () => 0 }) {
    if (!id || !traffic || !CONFIG[difficulty]) throw new TypeError('Invalid prototype round');
    this.id = String(id);
    this.traffic = traffic;
    this.difficulty = difficulty;
    this.windowSeconds = windowSeconds;
    if (typeof clock !== 'function') throw new TypeError('A trusted server clock is required');
    this.clock = clock;
    this.nextLane = 1;
    this.opportunity = issueOpportunity(this.id, this.nextLane, 0, windowSeconds);
    this.resolution = null;
    this.actionCache = new Map();
  }

  state() {
    return Object.freeze({ roundId: this.id, lane: this.nextLane, opportunity: this.opportunity, resolved: this.resolution });
  }

  submit({ actionId, lane }) {
    if (!actionId || !Number.isInteger(lane)) throw new TypeError('Invalid crossing action');
    const serverReceivedAt = this.clock();
    if (!Number.isFinite(serverReceivedAt)) throw new Error('SERVER_CLOCK_UNAVAILABLE');
    if (this.actionCache.has(actionId)) return this.actionCache.get(actionId);
    if (this.resolution) throw new Error('OPPORTUNITY_ALREADY_RESOLVED');
    if (lane !== this.opportunity.lane) throw new Error('OUT_OF_ORDER');

    let response;
    if (serverReceivedAt > this.opportunity.expiresAt) {
      // The public expiry is the deadline. A late packet cannot move it; the
      // round resolves from the traffic visible at the displayed expiry time.
      response = resolveAt(this.traffic, this.opportunity, this.opportunity.expiresAt, this.difficulty);
      response = Object.freeze({ ...response, source: 'deadline', lateAction: true });
    } else if (serverReceivedAt < this.opportunity.openedAt) {
      throw new Error('NOT_OPEN');
    } else {
      response = Object.freeze({ ...resolveAt(this.traffic, this.opportunity, serverReceivedAt, this.difficulty), source: 'action', lateAction: false });
    }
    this.resolution = response;
    this.actionCache.set(actionId, response);
    return response;
  }

  expire() {
    const serverNow = this.clock();
    if (!Number.isFinite(serverNow)) throw new Error('SERVER_CLOCK_UNAVAILABLE');
    if (this.resolution || serverNow < this.opportunity.expiresAt) return this.resolution;
    this.resolution = Object.freeze({
      ...resolveAt(this.traffic, this.opportunity, this.opportunity.expiresAt, this.difficulty),
      source: 'deadline', lateAction: false,
    });
    return this.resolution;
  }

  advance() {
    if (!this.resolution || this.resolution.outcome === 'collision' || this.nextLane > LANES) throw new Error('ROUND_NOT_ADVANCEABLE');
    this.nextLane++;
    this.opportunity = issueOpportunity(this.id, this.nextLane, this.resolution.resolvedAt + CONFIG[this.difficulty].hopTime, this.windowSeconds);
    this.resolution = null;
    return this.state();
  }
}

module.exports = { issueOpportunity, resolveAt, PrototypeOpportunityRound };
