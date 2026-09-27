'use strict';

(() => {
  if (window.__NEXA_WEB_INTELLIGENCE_V191__) return;
  window.__NEXA_WEB_INTELLIGENCE_V191__=true;

  function installBadge(){
    const hint=document.getElementById('composerHint');
    if(hint&&!document.getElementById('nexaWebBadgeV191')){
      const badge=document.createElement('span');
      badge.id='nexaWebBadgeV191';
      badge.textContent=' · 🌐 Web inteligente';
      badge.title='Nexa puede investigar automáticamente cuando una pregunta necesita evidencia web.';
      badge.style.opacity='.72';
      hint.appendChild(badge);
    }
    const note=document.querySelector('.web-settings-note');
    if(note&&!document.getElementById('nexaWebNoteV191')){
      const line=document.createElement('p');
      line.id='nexaWebNoteV191';
      line.innerHTML='<strong>Web Intelligence v1.9.1:</strong> el chat crea un plan interno, genera varias búsquedas, prioriza fuentes y verifica contradicciones automáticamente.';
      note.appendChild(line);
    }
  }
  function setProgress(packet){
    if(!packet)return;
    const banner=document.getElementById('generationBanner');
    const label=document.getElementById('generationBannerLabel');
    if(label&&packet.label&&banner&&!banner.hidden)label.textContent=packet.label;
    const hint=document.getElementById('composerHint');
    if(hint&&packet.phase&&!['done','fallback'].includes(packet.phase))hint.dataset.webIntel='active';
    if(hint&&['done','fallback'].includes(packet.phase))delete hint.dataset.webIntel;
  }

  if(window.nexa?.webIntelligence?.onProgress)window.nexa.webIntelligence.onProgress(setProgress);
  installBadge();
  const hint=document.getElementById('composerHint');
  if(hint)new MutationObserver(()=>queueMicrotask(installBadge)).observe(hint,{childList:true,characterData:true,subtree:true});
  let tries=0;const timer=setInterval(()=>{tries++;installBadge();if(tries>20)clearInterval(timer);},500);
})();
