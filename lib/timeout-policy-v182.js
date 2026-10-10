'use strict';

function now() { return Date.now(); }

function buildVisualTimeoutPolicy(settings = {}) {
  const attempts = Math.max(1, Math.min(5, Number(settings.maxVisualAttempts) || 3));
  const renderMs = Math.max(60_000, Number(settings.perAttemptRenderTimeoutMs) || 360_000);
  const reviewMs = Math.max(30_000, Number(settings.perAttemptReviewTimeoutMs) || 120_000);
  const graceMs = Math.max(15_000, Number(settings.progressGraceMs) || 120_000);
  const totalMs = Math.max(renderMs + reviewMs, Number(settings.totalVisualPipelineTimeoutMs) || 1_080_000);

  return {
    attempts,
    renderMs,
    reviewMs,
    graceMs,
    totalMs,
  };
}

function createVisualDeadline(policy) {
  const startAt = now();
  let lastProgressAt = startAt;
  return {
    startAt,
    touch(stage = 'progress') {
      lastProgressAt = now();
      return { stage, at: lastProgressAt };
    },
    elapsedMs() { return now() - startAt; },
    idleMs() { return now() - lastProgressAt; },
    hasExceededTotal() { return (now() - startAt) > policy.totalMs; },
    hasExceededIdle() { return (now() - lastProgressAt) > policy.graceMs; },
    snapshot() {
      return {
        startAt,
        lastProgressAt,
        elapsedMs: now() - startAt,
        idleMs: now() - lastProgressAt,
        totalMs: policy.totalMs,
        graceMs: policy.graceMs,
      };
    }
  };
}

function shouldAbortPipeline(policy, deadline, currentAttempt, currentPhase) {
  const reasons = [];
  if (deadline.hasExceededTotal()) reasons.push('TOTAL_TIMEOUT');
  if (deadline.hasExceededIdle()) reasons.push('IDLE_TIMEOUT');
  return {
    abort: reasons.length > 0,
    reasons,
    currentAttempt,
    currentPhase,
    deadline: deadline.snapshot(),
  };
}

module.exports = {
  buildVisualTimeoutPolicy,
  createVisualDeadline,
  shouldAbortPipeline,
};
