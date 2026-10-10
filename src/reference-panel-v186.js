'use strict';

function readReferencePanelState() {
  const fileInput = document.getElementById('refImages');
  const files = Array.from((fileInput && fileInput.files) || []).slice(0, 6);
  return {
    enabled: !!document.getElementById('refEnabled')?.checked,
    mode: document.getElementById('refMode')?.value || 'consistency',
    strength: Number(document.getElementById('refStrength')?.value || 65),
    identityWeight: Number(document.getElementById('refIdentityWeight')?.value || 80),
    styleWeight: Number(document.getElementById('refStyleWeight')?.value || 60),
    compositionWeight: Number(document.getElementById('refCompositionWeight')?.value || 50),
    useInRetries: !!document.getElementById('refUseInRetries')?.checked,
    carryBestApprovedAnchor: !!document.getElementById('refCarryAnchor')?.checked,
    images: files,
  };
}

function bindReferencePreview() {
  const input = document.getElementById('refImages');
  const list = document.getElementById('refPreviewList');
  if (!input || !list) return;
  input.addEventListener('change', () => {
    list.innerHTML = '';
    const files = Array.from(input.files || []).slice(0, 6);
    files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.textContent = file.name;
      list.appendChild(item);
    });
  });
}

window.NexaReferencePanelV186 = {
  readReferencePanelState,
  bindReferencePreview,
};
