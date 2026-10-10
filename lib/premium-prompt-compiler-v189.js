'use strict';

const NUMBER_WORDS = Object.freeze({
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,
});

function clean(v,max=9000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,max);}
function uniq(values,max=80){const out=[],seen=new Set();for(const raw of values||[]){const v=clean(raw,500);if(!v)continue;const k=v.toLowerCase();if(seen.has(k))continue;seen.add(k);out.push(v);if(out.length>=max)break;}return out;}
function parseNumber(raw){if(raw==null)return null;const s=String(raw).toLowerCase();if(/^\d+$/.test(s))return Math.max(0,Math.min(20,Number(s)));return NUMBER_WORDS[s]??null;}

function detectStyle(text){
  if(/\b(pixar|3d animated|animado 3d|family animation|pel[ií]cula animada|feature animation)\b/i.test(text))return'3d_animation';
  if(/\b(cartoon|caricatura|dibujo animado)\b/i.test(text))return'cartoon';
  if(/\b(anime|manga)\b/i.test(text))return'anime';
  if(/\b(photo ?real|photoreal|realista|fotoreal)\b/i.test(text))return'photorealistic';
  return'auto';
}
function detectScene(text){
  const map=[['park',/\b(park|parque)\b/i],['beach',/\b(beach|playa)\b/i],['forest',/\b(forest|bosque)\b/i],['city',/\b(city|ciudad)\b/i],['street',/\b(street|calle)\b/i],['home',/\b(home|house|casa)\b/i],['studio',/\b(studio|estudio)\b/i],['school',/\b(school|escuela)\b/i]];
  for(const [name,re] of map)if(re.test(text))return name;return'';
}
function detectAction(text){
  const map=[['playing',/\b(playing|playful interaction|jugando|jugar)\b/i],['running',/\b(running|corriendo)\b/i],['jumping',/\b(jumping|saltando)\b/i],['boxing',/\b(boxing|boxeando|boxeador|boxer)\b/i],['sitting',/\b(sitting|sentado|sentada)\b/i],['standing',/\b(standing|de pie)\b/i]];
  for(const [name,re] of map)if(re.test(text))return name;return'';
}
function detectMainSubject(text){
  const map=[['puppy',/\b(puppy|perrito|perrita|cachorro|cachorra)\b/i],['dog',/\b(dog|perro|perra)\b/i],['cat',/\b(cat|gato|gata|gatito|gatita|kitten)\b/i],['kangaroo',/\b(kangaroo|canguro|kanguro)\b/i],['rabbit',/\b(rabbit|bunny|conejo|conejito)\b/i],['fox',/\b(fox|zorro|zorrito)\b/i],['person',/\b(person|persona|woman|man|mujer|hombre)\b/i],['car',/\b(car|auto|coche|carro|vehicle|veh[ií]culo)\b/i]];
  for(const [name,re] of map)if(re.test(text))return name;return'';
}
function detectSecondaryCounts(text){
  const results=[];
  const regex=/(?:with|con|junto a|junto con)\s+(exactly\s+|exactamente\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(cats?|gatos?|gatas?|kittens?|dogs?|perros?|puppies|cachorros?|people|persons?|personas?|children|niños?|niñas?|birds?|p[aá]jaros?)/ig;
  let m;while((m=regex.exec(text))){const count=parseNumber(m[2]);if(count==null)continue;let type=m[3].toLowerCase();if(/cat|gato|gata|kitten/.test(type))type='cats';else if(/dog|perro|pupp|cachorr/.test(type))type='dogs';else if(/people|person/.test(type))type='people';else if(/child|niñ/.test(type))type='children';else if(/bird|páj|paj/.test(type))type='birds';results.push({type,count,explicitExact:true});}
  return results;
}

function buildSpec(userRequest,{referenceActive=false,referenceMode='consistency'}={}){
  const original=clean(userRequest,7000),lower=original.toLowerCase();
  const mainSubject=detectMainSubject(original),secondary=detectSecondaryCounts(original),style=detectStyle(original),scene=detectScene(original),action=detectAction(original);
  const sameIdentity=referenceActive && /\b(same|mismo|misma|igual|same one|el mismo|la misma)\b/i.test(original);
  const sameStyle=referenceActive && /\b(same style|mismo estilo|misma apariencia|same look)\b/i.test(original);
  const close=/\b(close|close[- ]?up|encuadre cercano|primer plano|muy cercano)\b/i.test(original);
  const fullBody=/\b(full body|cuerpo completo|de pies a cabeza)\b/i.test(original);
  const hard=[];
  if(mainSubject)hard.push(`main subject is ${mainSubject}`);
  if(sameIdentity)hard.push('main subject identity must match the uploaded reference');
  for(const x of secondary)hard.push(`exactly ${x.count} ${x.type} must be visible`);
  if(scene)hard.push(`scene must be ${scene}`);
  if(action)hard.push(`requested action must read as ${action}`);
  if(sameStyle)hard.push('all generated subjects must share the reference visual style');
  if(close)hard.push('close framing');
  if(fullBody)hard.push('full body visible');
  const totalSubjects=(mainSubject?1:0)+secondary.reduce((a,b)=>a+b.count,0);
  return {original,mainSubject,secondary,style,scene,action,sameIdentity,sameStyle,referenceActive,referenceMode,close,fullBody,totalSubjects,hardRequirements:hard};
}

function dimensions(spec){
  if(spec.close)return{width:896,height:896};
  if(spec.fullBody&&spec.totalSubjects<=1)return{width:768,height:1024};
  if(spec.totalSubjects>=3||spec.scene)return{width:1024,height:768};
  if(spec.mainSubject==='car')return{width:1024,height:768};
  return{width:896,height:896};
}

function compile(userRequest,opts={}){
  const spec=buildSpec(userRequest,opts),d=dimensions(spec);const pos=[spec.original],neg=[];
  pos.push('one coherent finished image','professional composition','clear focal hierarchy','clean readable silhouettes','polished final render','high visual clarity');
  if(spec.mainSubject)pos.push(`clearly recognizable ${spec.mainSubject} as the main subject`);
  if(spec.sameIdentity)pos.push('preserve the same main subject identity from the uploaded reference','match distinctive face shape, markings, colors, proportions and silhouette from the reference','reference identity has highest priority');
  if(spec.scene)pos.push(`clearly recognizable ${spec.scene} environment`);
  if(spec.action)pos.push(`clear readable ${spec.action} action`,`natural interaction appropriate to ${spec.action}`);
  for(const x of spec.secondary){pos.push(`exactly ${x.count} ${x.type}, all ${x.count} clearly visible and individually countable`,`no missing ${x.type}, no extra ${x.type}`);neg.push(`fewer than ${x.count} ${x.type}`,`more than ${x.count} ${x.type}`,`missing ${x.type}`,`extra ${x.type}`);}
  if(spec.sameStyle)pos.push('every subject uses the same visual rendering language as the reference','consistent materials, proportions, lighting language and character design across all subjects');
  if(spec.style==='3d_animation')pos.push('premium stylized 3D animated family-film aesthetic','appealing feature-animation proportions','soft global illumination','cinematic soft lighting','polished character rendering','subtle depth of field');
  else if(spec.style==='cartoon')pos.push('premium cartoon illustration','clean expressive shapes','appealing character design','controlled vibrant palette');
  else if(spec.style==='anime')pos.push('premium anime illustration','clean linework','coherent cel shading','strong composition');
  else if(spec.style==='photorealistic')pos.push('photorealistic materials','natural lighting','realistic detail','coherent optics');
  if(/\b(cute|adorable|tierno|tierna|kawaii)\b/i.test(spec.original))pos.push('extremely cute and appealing','warm friendly expression','soft rounded shapes','charming lovable personality');
  if(spec.close)pos.push('close framing','main subject fills most of the frame');
  if(spec.fullBody)pos.push('full body entirely visible','comfortable margin around the subject');
  neg.push('blurry','low quality','low detail','bad anatomy','deformed anatomy','extra limbs','missing limbs','duplicate main subject','cloned subject','accidental crop','messy composition','character sheet','turnaround sheet','reference sheet','multiple views','multiple poses','collage','text','watermark','logo artifact','unrequested objects');
  if(spec.mainSubject&&['puppy','dog','cat','kangaroo','rabbit','fox'].includes(spec.mainSubject))neg.push('wrong species','species drift','hybrid animal','deformed muzzle','malformed ears','bad paws','extra paws','human face on animal','uncanny creature');
  if(spec.sameIdentity)neg.push('different main character','identity drift','different facial markings','different fur pattern','different face proportions','different silhouette','reference mismatch','breed drift');
  if(spec.sameStyle)neg.push('mixed rendering styles','one subject rendered realistically while others are stylized','style mismatch between subjects');
  const positive=uniq(pos,70).join(', '),negative=uniq(neg,70).join(', ');
  return {...spec,width:d.width,height:d.height,positivePrompt:positive,negativePrompt:negative,softPreferences:['clean lighting','polished rendering','balanced composition']};
}

function plannerRequest(compiled){
  return [
    `ORIGINAL USER REQUEST: ${compiled.original}`,
    `PREMIUM POSITIVE PROMPT: ${compiled.positivePrompt}`,
    `PREMIUM NEGATIVE PROMPT: ${compiled.negativePrompt}`,
    `HARD REQUIREMENTS: ${compiled.hardRequirements.join(' | ')||'none beyond original request'}`,
    `OUTPUT PLAN: ${compiled.width}x${compiled.height}; style=${compiled.style}; scene=${compiled.scene||'auto'}; total_subjects=${compiled.totalSubjects||'auto'}.`,
    'Use the PREMIUM POSITIVE PROMPT as the main positive conditioning and the PREMIUM NEGATIVE PROMPT as the negative conditioning.',
    'Do not reinterpret explicit counts, identity locks, scene requirements, or same-style requirements.'
  ].join('\n');
}

module.exports={compile,plannerRequest,buildSpec,dimensions};
