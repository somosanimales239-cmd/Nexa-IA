'use strict';

const { createStatusStore } = require('./status-system-v183');

async function runVisualPipelineNoTimeout(options) {
  const {
    requestId = `visual-${Date.now()}`,
    dataDir,
    settings = {},
    progress = () => {},
    renderAttempt,
    reviewAttempt,
    repairPlan,
    isCanceled = () => false,
  } = options || {};

  if (typeof renderAttempt !== 'function') throw new Error('renderAttempt function required');
  if (typeof reviewAttempt !== 'function') throw new Error('reviewAttempt function required');
  if (typeof repairPlan !== 'function') throw new Error('repairPlan function required');

  const maxAttempts = Math.max(1, Math.min(5, Number(settings.maxVisualAttempts) || 3));
  const status = createStatusStore(dataDir, requestId);
  let best = null;
  let plan = {
    positivePrompt: settings.positivePrompt || '',
    negativePrompt: settings.negativePrompt || '',
  };

  status.set({ phase: 'QUEUED', status: 'WAITING', message: 'Pipeline visual preparado' });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (isCanceled()) {
      status.set({ attempt, phase: 'CANCELED', status: 'STOPPED', message: 'Cancelado por el usuario' });
      return { ok: false, canceled: true, best, attemptsUsed: attempt - 1, statusFile: status.file };
    }

    status.set({ attempt, phase: 'RENDER_START', status: 'RUNNING', message: `Renderizando intento ${attempt}/${maxAttempts}…` });
    progress({ stage: 'render_start', attempt, totalAttempts: maxAttempts, message: `Renderizando intento ${attempt}/${maxAttempts}…` });

    const renderResult = await renderAttempt({ attempt, plan, status: status.snapshot() });

    status.set({ attempt, phase: 'RENDER_DONE', status: 'RUNNING', message: `Render terminado para intento ${attempt}/${maxAttempts}` });
    progress({ stage: 'render_done', attempt, totalAttempts: maxAttempts, message: `Render terminado ${attempt}/${maxAttempts}` });

    if (isCanceled()) {
      status.set({ attempt, phase: 'CANCELED', status: 'STOPPED', message: 'Cancelado por el usuario' });
      return { ok: false, canceled: true, best, attemptsUsed: attempt, statusFile: status.file };
    }

    status.set({ attempt, phase: 'REVIEW_START', status: 'RUNNING', message: `Llamando Qwen2.5-VL 3B en intento ${attempt}/${maxAttempts}…`, qwenCalled: true });
    progress({ stage: 'review_start', attempt, totalAttempts: maxAttempts, message: `Revisando imagen con Qwen ${attempt}/${maxAttempts}…` });

    const reviewResult = await reviewAttempt({ attempt, plan, renderResult, status: status.snapshot() });
    const score = Number(reviewResult?.score || 0);
    const accepted = reviewResult?.accepted === true;
    const errors = Array.isArray(reviewResult?.errors) ? reviewResult.errors : [];

    status.set({
      attempt,
      phase: 'REVIEW_DONE',
      status: accepted ? 'APPROVED' : 'REJECTED',
      message: accepted ? `Nexa Visual aprobó la imagen · ${score}/100` : `Nexa Visual rechazó la imagen · ${score}/100`,
      qwenReviewed: true,
      score,
      accepted,
      errors,
    });

    const item = { attempt, plan, renderResult, reviewResult, score, accepted };
    if (!best || score > best.score) best = item;

    if (accepted) {
      progress({ stage: 'approved', attempt, totalAttempts: maxAttempts, message: `Nexa Visual aprobó la imagen · ${score}/100` });
      return { ok: true, best: item, attemptsUsed: attempt, statusFile: status.file, reason: 'APPROVED' };
    }

    if (attempt < maxAttempts) {
      status.set({ attempt, phase: 'REPAIRING', status: 'RUNNING', message: 'Reparando prompt…' });
      progress({ stage: 'repair', attempt, totalAttempts: maxAttempts, message: 'Reparando prompt…' });
      plan = await repairPlan({ attempt, plan, renderResult, reviewResult, status: status.snapshot() });
      status.set({ attempt, phase: 'RETRYING', status: 'RUNNING', message: `Reintentando ${attempt + 1}/${maxAttempts}…` });
    }
  }

  status.set({
    phase: 'FAILED',
    status: best ? 'BEST_AVAILABLE' : 'NO_RESULT',
    message: best ? `Se alcanzó el máximo de intentos. Mejor resultado: ${best.score}/100` : 'No se obtuvo un resultado utilizable',
    score: best ? best.score : null,
    accepted: false,
  });

  return { ok: !!best, best, attemptsUsed: maxAttempts, statusFile: status.file, reason: best ? 'BEST_AVAILABLE' : 'NO_RESULT' };
}

module.exports = { runVisualPipelineNoTimeout };
