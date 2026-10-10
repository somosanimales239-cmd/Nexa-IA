'use strict';
/* Nexa Developer Autonomous Web Bridge v2.8.1 — for Web v3.19 compatible UI.
   Does not modify Chat normal or Image Studio, only the existing Developer route. */
(function(){
  const csrf=document.querySelector('meta[name="nexa-csrf"]')?.content||'';
  let active=false,currentJob='';
  const REVISION='nexa-agent-281-reliability-20261010';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function request(url,options={}){
    const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    let j;try{j=await r.json()}catch(_){throw Error('Servidor no devolvió JSON: '+url+' HTTP '+r.status)}
    if(!r.ok||j?.ok===false)throw Error(String(j?.error||'HTTP '+r.status));return j;
  }
  function post(url,v){return request(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(v)})}
  async function command(type,payload,progress){
    const res=await post('api/web/command.php',{type,payload});
    if(!res.jobId)throw Error('Nexa Web no devolvió jobId para '+type);
    const started=Date.now(),id=res.jobId;
    if(type==='developer.agent.run')currentJob=id;
    const limit=type==='developer.agent.run'?19*60*1000:75*1000;
    while(Date.now()-started<limit){
      const x=await request('api/web/job.php?id='+encodeURIComponent(id));const j=x.job||{};
      if(j.status==='done')return j.result||{};
      if(['error','cancelled'].includes(j.status))throw Error(type+': '+String(j.error||j.status));
      if(Date.now()-started>limit-3000)throw Error('Tiempo agotado, trabajo '+id+'. Verifica estado antes de reintentar.');
      await sleep(1450);
    }
    throw Error('Trabajo de Nexa no concluyó en el límite.');
  }
  function secureRoot(v){const s=String(v||'').trim().replaceAll('/','\\');
    if(!/^D:\\Projects\\[\w .-]+(?:\\[\w .-]+)*$/i.test(s)||s.includes('..'))throw Error('Selecciona una carpeta real en D:\\Projects\\NombreProyecto');return s;
  }
  const bytesToHex=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
  async function digest(bytes){if(!crypto?.subtle)throw Error('Se requiere HTTPS para verificar ZIP');return bytesToHex(await crypto.subtle.digest('SHA-256',bytes))}
  function link(){const parent=document.getElementById('chatDeveloperDock');if(!parent)throw Error('La página no tiene el dock Developer compatible.');
    let a=document.getElementById('nexaAutonomousZip');if(!a){a=document.createElement('a');a.id='nexaAutonomousZip';a.textContent='📦 ZIP Cambios Qwen';a.style.cssText='display:none;margin:6px;padding:8px 12px;border:1px solid #347a55;border-radius:8px;';parent.appendChild(a);}return a;
  }
  async function download(out,progress){
    const z=out.zip;if(!z||!z.size||!z.sha256)throw Error('Developer no generó ZIP');
    if(z.size>12*1024*1024)throw Error('ZIP superior a 12 MB');
    const chunks=[],parts=Math.ceil(z.size/(240*1024));let size=0;
    for(let p=0;p<parts;p++){
      const res=await command('developer.agent.artifact',{jobId:out.jobId,part:p},progress);
      if(!res.ok||res.part!==p||res.parts!==parts||res.sha256!==z.sha256)throw Error('Fragmento ZIP no coincide con el manifiesto');
      const b=Uint8Array.from(atob(res.chunkBase64||''),ch=>ch.charCodeAt(0));
      if(await digest(b)!==res.chunkSha256)throw Error('SHA256 de fragmento inválido');
      chunks.push(b);size+=b.length;progress('ZIP Cambios','Fragmento '+(p+1)+'/'+parts);
    }
    if(size!==z.size)throw Error('ZIP truncado');
    const all=new Uint8Array(size);let i=0;for(const c of chunks){all.set(c,i);i+=c.length}
    if(await digest(all)!==z.sha256)throw Error('SHA256 de ZIP inválido');
    const a=link();if(a.dataset.uri)URL.revokeObjectURL(a.dataset.uri);
    a.href=URL.createObjectURL(new Blob([all],{type:'application/zip'}));a.dataset.uri=a.href;
    a.download='NEXA_QWEN_CAMBIOS_'+out.jobId+'.zip';a.style.display='inline-block';a.click();
    return a.download;
  }
  // A failed or incomplete run may still contain useful staged changes.
  // Never download them automatically or describe them as a verified build.
  function offerPartialZip(out,progress){
    const dock=document.getElementById('chatDeveloperDock');if(!dock)return;
    let btn=document.getElementById('nexaPartialZip281');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.id='nexaPartialZip281';dock.appendChild(btn);}
    btn.textContent='📦 Descargar ZIP provisional (no certificado)';
    btn.style.cssText='display:inline-block;margin:6px;padding:8px 12px;border:1px solid #c79b37;border-radius:8px;';
    btn.onclick=async()=>{
      if(!confirm('Este ZIP contiene cambios PROVISIONALES de un trabajo no terminado. Solo descárgalo para revisarlos; NO lo instales ni reemplaces archivos originales. ¿Continuar?'))return;
      btn.disabled=true;
      try{await download(out,progress);}catch(e){alert('No se pudo verificar y descargar el ZIP: '+String(e.message||e));}
      finally{btn.disabled=false;}
    };
  }
  function installStopButton(){
    const dock=document.getElementById('chatDeveloperDock');if(!dock)return null;
    let btn=document.getElementById('nexaAutonomousStop');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.id='nexaAutonomousStop';btn.textContent='⛔ Detener Developer';
      btn.style.cssText='margin:6px;padding:8px;border:1px solid #c33;border-radius:8px;color:#c33';dock.appendChild(btn);
      btn.addEventListener('click',async()=>{if(!currentJob)return;btn.disabled=true;try{await post('api/web/cancel.php',{id:currentJob})}catch(e){console.warn('No se pudo cancelar:',e.message)}finally{btn.disabled=false}});
    }
    btn.style.display='inline-block';return btn;
  }
  async function run({task,project,projectId,onProgress}){
    if(active)throw Error('Ya hay un Developer trabajando desde esta pestaña.');
    active=true;const stopButton=installStopButton();const progress=(l,d)=>{try{onProgress?.(l,d)}catch(_){}};
    try{
      const root=secureRoot(project?.local_root),t=String(task||'').trim();
      if(t.length<10||t.length>9000)throw Error('Descripción de tarea inválida');
      if(!confirm('Nexa Developer v2.8.1 trabajará en COPIA aislada de '+root+'. ¿Continuar?'))throw Error('Tarea no autorizada.');
      const caps=await command('developer.capabilities',{},progress);
      if(!caps.enabled||!Array.isArray(caps.allowedRoots)||!caps.allowedRoots.some(r=>{const a=r.replace(/[\\/]+$/,'').toLowerCase(),b=root.toLowerCase();return b===a||b.startsWith(a+'\\')}))throw Error('Workspace no autorizado en Developer Allowed Roots');
      const st=await command('developer.agent.status',{},progress);
      if(st.version!=='2.8.1'||!st.agentLoaded||st.buildId!==REVISION)throw Error('Nexa Windows no cargó el Developer v2.8.1. No ejecutes tareas hasta verificar el nuevo EXE. Runtime encontrado: '+String(st.runtimeVersion||st.version||'?'));
      if(st.ready!==true)throw Error('Qwen local no está disponible: '+String(st.ollama?.error||'Modelo qwen2.5-coder:7b ausente en Ollama'));
      progress('Qwen Developer','Agente verificado '+st.version+' · Qwen: '+st.model+' · original solo lectura');
      const allowTests=confirm('¿Autorizas ejecutar npm test del proyecto (si existe) EN UNA COPIA? Solo si confías en ese código.');
      const out=await command('developer.agent.run',{root,task:t,maxSteps:36,allowTests},progress);
      const changed=Array.isArray(out.files)?out.files:[];
      const status=String(out.status||'unknown');
      const isCandidate=status==='review_required';
      // A blocked, incomplete or cancelled job is NOT a completed job.
      // Never download a blocked ZIP automatically or report functional QA PASS.
      let zipName='';
      if(out.zip&&isCandidate)zipName=await download(out,progress);
      let errors=(Array.isArray(out.invalidActions)?out.invalidActions:[]).slice(-8);
      if(['blocked','incomplete'].includes(status)&&!errors.length&&out.jobId){
        try{const report=await command('developer.agent.report',{jobId:out.jobId},progress);errors=report.invalidActions||[]}catch(_){}
      }
      const qa=out.qa||{};
      let summary=`### Nexa Developer autónomo · ${status}\n\n**Motor:** ${out.version||'?'}, Qwen: ${out.model||'qwen2.5-coder:7b'}\n**Original:** sin modificaciones (solo copia temporal)\n**Archivos candidatos:** ${changed.map(f=>'`'+f.path+'`').join(', ')||'ninguno'}\n**Sintaxis:** ${qa.level||'no verificada'}\n**QA funcional:** ${qa.projectTests?.executed? (qa.projectTests.passed?'pruebas configuradas aprobadas':'pruebas configuradas fallidas') : 'no certificada'}\n`;
      if(status==='blocked')summary+='\n❌ **Bloqueado:** El motor NO completó la tarea. No se declara éxito.\n';
      if(status==='incomplete')summary+='\n⚠️ **Incompleto:** Quedan operaciones o pruebas pendientes.\n';
      if(status==='cancelled')summary+='\n⛔ **Cancelado:** Trabajo interrumpido.\n';
      if(isCandidate)summary+='\n⚠️ **Cambios candidatos:** requieren QA funcional y revisión humana antes de instalar.\n';
      if(errors.length)summary+='\n**Acciones inválidas detectadas:**\n'+errors.map(x=>`- Paso ${x.step||'?'} · ${x.action||x.kind||'acción'} ${x.path||''}: ${x.error||'sin detalle'}`).join('\n')+'\n';
      if(out.error)summary+='\n**Error exacto:** '+String(out.error);
      if(out.summary)summary+='\n**Resumen Qwen:** '+String(out.summary);
      if(zipName)summary+='\n**ZIP candidato descargado:** '+zipName;
      if(out.zip&&!isCandidate){
        offerPartialZip(out,progress);
        summary+='\n**ZIP provisional disponible:** usa el botón «Descargar ZIP provisional (no certificado)» para revisarlo. NO lo instales sin validación.';
      }
      return {finished:false,artifactOnly:true,failed:!isCandidate,status,changedFiles:changed.map(x=>x.path),qa:null,summary,artifacts:[]};
    }finally{active=false;currentJob='';if(stopButton)stopButton.style.display='none';}
  }
  // One-click version check: does not modify any project or send work to Qwen.
  async function checkInstalled(){
    const st=await command('developer.agent.status',{},()=>{});
    if(!st.agentLoaded||st.version!=='2.8.1'||st.buildId!==REVISION)throw Error('Agente equivocado: '+String(st.version||'?'));
    if(!st.ready)throw Error('v2.8.1 cargado; pero Qwen local no disponible: '+String(st.ollama?.error||'Modelo no registrado'));
    return st;
  }
  function addVerificationButton(){
    const dock=document.getElementById('chatDeveloperDock');if(!dock||document.getElementById('nexaAgentCheck281'))return;
    const btn=document.createElement('button');btn.id='nexaAgentCheck281';btn.type='button';btn.textContent='🧪 Verificar agente 2.8.1';
    btn.style.cssText='margin:5px;padding:7px;border:1px solid #298365;border-radius:8px;';
    const msg=document.createElement('span');msg.id='nexaAgentCheckResult281';msg.style.cssText='font-size:12px;margin-left:5px;';
    btn.addEventListener('click',async()=>{btn.disabled=true;msg.textContent='Comprobando Windows...';
      try{const st=await checkInstalled();msg.textContent='✅ v'+st.version+' + '+st.model+' listos';}
      catch(e){msg.textContent='❌ '+String(e.message).slice(0,170);}
      finally{btn.disabled=false;}
    });
    dock.appendChild(btn);dock.appendChild(msg);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addVerificationButton,{once:true});else addVerificationButton();
  window.NexaDeveloperChatBridge={run,checkInstalled,version:'2.8.1',buildId:REVISION};
})();
