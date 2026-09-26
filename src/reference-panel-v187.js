(() => {
  if (window.__NEXA_REFERENCE_PANEL_V187) return;
  window.__NEXA_REFERENCE_PANEL_V187 = true;

  const MAX_REFS=4;
  const defaults={enabled:false,mode:'consistency',strength:70,identityWeight:85,styleWeight:60,compositionWeight:45,useInRetries:true};
  let config={...defaults};
  try { config={...config,...JSON.parse(localStorage.getItem('nexaRefV187')||'{}')}; } catch(_) {}
  let referenceImages=[];

  function saveConfig(){ try{localStorage.setItem('nexaRefV187',JSON.stringify(config));}catch(_){} }
  function el(tag,attrs={},html=''){
    const node=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k==='class') node.className=v;
      else if(k==='style') node.setAttribute('style',v);
      else if(k.startsWith('data-')) node.setAttribute(k,v);
      else node[k]=v;
    }
    if(html) node.innerHTML=html;
    return node;
  }
  function resizeFile(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(reader.error||new Error('No se pudo leer referencia'));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error('Referencia de imagen inválida'));
        img.onload=()=>{
          const max=1024,scale=Math.min(1,max/Math.max(img.width,img.height));
          const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
          const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
          const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
          const dataUrl=canvas.toDataURL('image/jpeg',0.86);
          resolve({name:file.name,type:'image/jpeg',width:w,height:h,data:dataUrl.split(',')[1]||''});
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  async function currentPayload(){
    const refs=config.enabled?referenceImages.slice(0,MAX_REFS):[];
    return {enabled:config.enabled&&refs.length>0,...config,images:refs};
  }
  function renderPreview(host){
    host.innerHTML='';
    referenceImages.forEach((r,i)=>{
      const chip=el('div',{style:'display:flex;gap:8px;align-items:center;padding:6px 8px;border:1px solid #293449;border-radius:8px;margin-top:6px;'});
      chip.append(el('span',{style:'font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'},r.name||`Reference ${i+1}`));
      const b=el('button',{type:'button',style:'font-size:11px;padding:3px 7px;'},'Quitar');
      b.onclick=()=>{referenceImages.splice(i,1);renderPreview(host);}; chip.append(b); host.append(chip);
    });
  }
  function inject(){
    const form=document.getElementById('settingsForm');
    if(!form||document.getElementById('nexaReferenceV187')) return false;
    const card=el('div',{id:'nexaReferenceV187',style:'border:1px solid #26344a;border-radius:12px;padding:12px;margin:12px 0;background:rgba(10,17,29,.55);'});
    card.innerHTML='<div style="font-weight:700;margin-bottom:5px;">Reference Images · Parecido y Consistencia</div><div style="font-size:11px;opacity:.75;margin-bottom:10px;">Carga hasta 4 imágenes. Qwen extrae Visual DNA y Nexa lo mantiene en la generación y retries.</div>';
    const enabled=el('label',{style:'display:flex;gap:8px;align-items:center;margin:8px 0;'}); const enabledInput=el('input',{type:'checkbox',checked:!!config.enabled}); enabled.append(enabledInput,document.createTextNode(' Activar imágenes de referencia')); card.append(enabled);
    const select=el('select',{style:'width:100%;margin:5px 0 8px;padding:7px;'}); ['consistency','likeness','style','composition','product'].forEach(v=>{const o=el('option',{value:v,textContent:v}); if(v===config.mode)o.selected=true;select.append(o);}); card.append(el('div',{style:'font-size:11px;opacity:.8;'},'Modo')); card.append(select);
    function slider(label,key){ const wrap=el('label',{style:'display:block;margin:8px 0;font-size:11px;'}); const value=el('span',{style:'float:right;'},String(config[key])); const input=el('input',{type:'range',min:0,max:100,value:config[key],style:'width:100%;'}); input.oninput=()=>{config[key]=Number(input.value);value.textContent=input.value;saveConfig();}; wrap.append(document.createTextNode(label),value,input); return wrap; }
    card.append(slider('Fuerza general','strength'),slider('Peso de identidad','identityWeight'),slider('Peso de estilo','styleWeight'),slider('Peso de composición','compositionWeight'));
    const retry=el('label',{style:'display:flex;gap:8px;align-items:center;margin:8px 0;'}); const retryInput=el('input',{type:'checkbox',checked:config.useInRetries!==false}); retry.append(retryInput,document.createTextNode(' Mantener referencias durante retries')); card.append(retry);
    const file=el('input',{type:'file',accept:'image/*',multiple:true,style:'width:100%;margin-top:8px;'}); const preview=el('div'); card.append(file,preview); renderPreview(preview);
    enabledInput.onchange=()=>{config.enabled=enabledInput.checked;saveConfig();}; select.onchange=()=>{config.mode=select.value;saveConfig();}; retryInput.onchange=()=>{config.useInRetries=retryInput.checked;saveConfig();};
    file.onchange=async()=>{
      const files=Array.from(file.files||[]).slice(0,MAX_REFS);
      try{ referenceImages=await Promise.all(files.map(resizeFile)); renderPreview(preview); config.enabled=referenceImages.length>0; enabledInput.checked=config.enabled; saveConfig(); }
      catch(e){ console.error('Nexa reference load',e); }
      file.value='';
    };
    const saveBtn=form.querySelector('[data-testid="save-settings"]')||form.querySelector('button[type="submit"]');
    if(saveBtn) form.insertBefore(card,saveBtn); else form.append(card);
    return true;
  }
  let tries=0; const timer=setInterval(()=>{tries++; if(inject()||tries>40)clearInterval(timer);},500);

  // Wrap the function used by the current renderer. v1.8.5 has already removed its timeout.
  const wrapGenerate=()=>{
    if(typeof window.invokeImageWithTimeout!=='function'||window.__NEXA_REF_GENERATE_WRAP_V187) return false;
    window.__NEXA_REF_GENERATE_WRAP_V187=true;
    const original=window.invokeImageWithTimeout;
    window.invokeImageWithTimeout=async function(requestId,payload){
      const ref=await currentPayload();
      return original.call(this,requestId,{...(payload||{}),referenceConfig:ref});
    };
    return true;
  };
  let wtries=0; const wtimer=setInterval(()=>{wtries++; if(wrapGenerate()||wtries>40)clearInterval(wtimer);},500);
})();
