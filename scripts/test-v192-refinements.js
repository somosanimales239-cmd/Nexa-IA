'use strict';
const assert=require('assert');
const Refine=require('../lib/web-intelligence-refinements-v192');

(async()=>{
  const sources=[
    {title:'Ollama Releases',url:'https://github.com/ollama/ollama/releases',domain:'github.com',text:'Release information'},
    {title:'Ollama Documentation',url:'https://docs.ollama.com',domain:'docs.ollama.com',text:'Official documentation'},
  ];
  const cleaned=Refine.cleanInternalRefs('W2 contradice [W1]. Base: Web Intelligence (W1, W2).',sources);
  assert(!/\bW\d+\b|\[W\d+\]|Base:\s*Web Intelligence/i.test(cleaned));
  assert(cleaned.includes('Ollama Documentation'));
  assert(cleaned.includes('Ollama Releases'));

  const queries=Refine.officialQueries('Busca si salió una nueva versión de Ollama','software_technical');
  assert(queries.length>=2);
  assert(queries.some(q=>/official/i.test(q)));
  assert(queries.some(q=>/GitHub|release/i.test(q)));

  const system=Refine.publicResearchSystemMessage('¿Hay una nueva versión?',{intent:'software_technical'},{status:'PARTIAL',confidence:.7,facts:['W1 dice una versión'],conflicts:['W2 difiere'],caveats:[]},sources);
  assert(!/\bW\d+\b|\[W\d+\]|Base:\s*Web Intelligence/i.test(system));
  assert(system.includes('Ollama Releases'));
  assert(system.includes('https://github.com/ollama/ollama/releases'));

  const records=Refine.publicSourceRecords(sources,{status:'VERIFIED',confidence:.92,selected_sources:[1]});
  assert(records.every(r=>r.citation===''));
  assert(records[0].documentName==='Ollama Releases');

  const fake={
    explicitWebRequest:()=>true,currentInfoRequest:()=>true,exactOrHighRiskFact:()=>false,
    gatherIntelligentSources:async()=>({sources:[sources[1]]}),
    verifyEvidence:async()=>({status:'VERIFIED',confidence:.94,facts:['official confirmed'],conflicts:[],caveats:[],selected_sources:[1,2]}),
  };
  const original=async()=>({used:true,plan:{intent:'software_technical',queries:['q'],max_sources:5},sources:[sources[0]],verification:{status:'CONFLICTING',confidence:.55,facts:[],conflicts:['conflict'],caveats:[],selected_sources:[1]}});
  const upgraded=await Refine.enhancedResearchForChat(original,fake,'Busca la versión actual',{},{});
  assert(upgraded.officialRetry?.attempted===true);
  assert(upgraded.sources.length===2);
  assert(upgraded.verification.status==='VERIFIED');

  const script=require('fs').readFileSync(require('path').join(__dirname,'..','src','conversation-tools-v192.js'),'utf8');
  for(const token of ['chat-rename-v192','data-rename-chat-v192','chatTitle','change','Enter','Escape'])assert(script.includes(token));
  console.log('Nexa v1.9.2 refinement tests: OK');
})().catch(error=>{console.error(error);process.exit(1);});
