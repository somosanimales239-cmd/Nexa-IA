'use strict';

const { buildVisualTimeoutPolicy, createVisualDeadline, shouldAbortPipeline } = require('./timeout-policy-v182');

async function runVisualPipeline(options) {
  const {
    settings = {},
    progress = () => {},
    renderAttempt,
    reviewAttempt,
    repairPlan,
  } = options || {};

  if (typeof renderAttempt !== 'function') throw new Error('renderAttempt function required');
  if (typeof reviewAttempt !== 'function') throw new Error('reviewAttempt function required');
  if (typeof repairPlan !== 'function') throw new Error('repairPlan function required');

  const policy = buildVisualTimeoutPolicy(settings);
  const deadline = createVisualDeadline(policy);
  let best = null;
  let plan = { positivePrompt: settings.positivePrompt || '', negativePrompt: settings.negativePrompt || '' };

  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    deadline.touch('attempt_start');
    progress({ stage: 'render_start', attempt, totalAttempts: policy.attempts, message: `Renderizando intento ${attempt}/${policy.attempts}…` });

    const renderResult = await Promise.race([
      renderAttempt({ attempt, plan, timeoutMs: policy.renderMs, deadline: deadline.snapshot() }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`RENDER_TIMEOUT_ATTEMPT_${attempt}`)), policy.renderMs)),
    ]);

    deadline.touch('render_complete');
    progress({ stage: 'review_start', attempt, totalAttempts: policy.attempts, message: `Revisando imagen con Qwen ${attempt}/${policy.attempts}…` });

    const reviewResult = await Promise.race([
      reviewAttempt({ attempt, plan, renderResult, timeoutMs: policy.reviewMs, deadline: deadline.snapshot() }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`REVIEW_TIMEOUT_ATTEMPT_${attempt}`)), policy.reviewMs)),
    ]);

    deadline.touch('review_complete');
    const score = Number(reviewResult?.score || 0);
    const accepted = reviewResult?.accepted === true;
    const item = { attempt, plan, renderResult, reviewResult, score, accepted };
    if (!best || score > best.score) best = item;

    if (accepted) {
      progress({ stage: 'accepted', attempt, totalAttempts: policy.attempts, message: `Nexa Visual aprobó la imagen · ${score}/100` });
      return { ok: true, best: item, attemptsUsed: attempt, policy, reason: 'APPROVED' };
    }

    const abortCheck = shouldAbortPipeline(policy, deadline, attempt, 'review_complete');
    if (abortCheck.abort) {
      progress({ stage: 'aborted', attempt, totalAttempts: policy.attempts, message: 'Tiempo total agotado durante la revisión visual.' });
      return { ok: false, best, attemptsUsed: attempt, policy, reason: abortCheck.reasons.join('+') };
    }

    if (attempt < policy.attempts) {
      progress({ stage: 'repair', attempt, totalAttempts: policy.attempts, message: 'Reparando prompt…' });
      plan = await repairPlan({ attempt, plan, reviewResult, renderResult });
      deadline.touch('repair_complete');
    }
  }

  return { ok: !!best, best, attemptsUsed: policy.attempts, policy, reason: best ? 'BEST_AVAILABLE' : 'NO_RESULT' };
}

module.exports = { runVisualPipeline };
