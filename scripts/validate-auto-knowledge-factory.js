'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const { PersistentKnowledgeDB, AUTOMOTIVE_BASE_TOPICS }=require('../lib/persistent-knowledge');
const { parseVehicleCatalog, parseFlexibleVehicleCatalog, fallbackCatalogFromEvidence }=require('../lib/vehicle-catalog');
function assert(v,m){ if(!v) throw new Error(m); }
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-factory-'));
const db=new PersistentKnowledgeDB(root);
try {
  const master=db.createFactoryCurriculum({ name:'Toyota Corolla US 1969-2027 validation',make:'Toyota',model:'Corolla',startYear:1969,endYear:2027,market:'US',completionThreshold:0.85 });
  assert(master.year_count===59,'Toyota Corolla 1969-2027 preset must seed 59 years');
  assert(db.listFactoryYears(master.id)[0].year===1969 && db.listFactoryYears(master.id).at(-1).year===2027,'Toyota Corolla master year bounds are wrong');
  db.deleteFactoryCurriculum(master.id);
  const curriculum=db.createFactoryCurriculum({ make:'Toyota',model:'Corolla',startYear:2000,endYear:2002,market:'US',completionThreshold:0.85 });
  assert(curriculum.year_count===3,'curriculum did not seed 3 years');
  let work=db.nextFactoryWork(curriculum.id);
  assert(work?.type==='DISCOVER_YEAR' && work.year.year===2000,'first work must discover year 2000');
  const parsed=parseVehicleCatalog(`NEXA_VEHICLE_CATALOG_V1\nMAKE: Toyota\nMODEL: Corolla\nYEAR: 2000\nMARKET: US\nVARIANT\nGENERATION: E110\nBODY: Sedan\nTRIMS: VE, CE\nENGINE_CODE: 1ZZ-FE\nENGINE_DISPLACEMENT: 1.8L\nFUEL: Gasoline\nTRANSMISSION: 5-speed manual\nDRIVETRAIN: FWD\nCONFIDENCE: 0.90\nSOURCE_INDEXES: 1,2\nEND_VARIANT\nVARIANT\nGENERATION: E110\nBODY: Sedan\nTRIMS: LE\nENGINE_CODE: 1ZZ-FE\nENGINE_DISPLACEMENT: 1.8L\nFUEL: Gasoline\nTRANSMISSION: 4-speed automatic\nDRIVETRAIN: FWD\nCONFIDENCE: 0.88\nSOURCE_INDEXES: 1,3\nEND_VARIANT\nEND_NEXA_VEHICLE_CATALOG`,{ make:'Toyota',model:'Corolla',year:2000,market:'US' });
  assert(parsed?.variants?.length===2,'catalog parser did not produce two variants');

  const jsonParsed=parseFlexibleVehicleCatalog(JSON.stringify({variants:[{make:'Toyota',model:'Corolla',year:2000,market:'US',generation:'E110',engine_code:'1ZZ-FE',engine_displacement:'1.8L',transmission:'4-speed automatic',drivetrain:'FWD',confidence:0.82,source_indexes:[1,2]}]}),{make:'Toyota',model:'Corolla',year:2000,market:'US'});
  assert(jsonParsed?.variants?.length===1 && jsonParsed.variants[0].engine_code==='1ZZ-FE','flexible JSON catalog parser failed');
  const fallback=fallbackCatalogFromEvidence([{title:'2000 Toyota Corolla specifications',url:'https://example.com/a',text:'The 2000 Toyota Corolla for the US market used a 1.8L engine with a 4-speed automatic transmission and FWD.'}],{make:'Toyota',model:'Corolla',year:2000,market:'US'});
  assert(fallback?.variants?.length>=1,'evidence fallback did not create a conservative variant');
  assert(fallback.variants[0].engine_displacement==='1.8L','evidence fallback did not preserve displacement');
  const source=[{ title:'Toyota source',url:'https://example.com/toyota',sourceType:'OEM' }];
  for(const variant of parsed.variants) db.upsertFactoryConfig(curriculum.id,work.year.id,variant,source);
  db.setFactoryYearState(work.year.id,{ discovery_status:'COMPLETE',research_status:'RESEARCHING',variant_count:2,total_configs:2 });
  let configs=db.listFactoryConfigs(curriculum.id,2000);
  assert(configs.length===2,'factory configs not persisted');
  assert(configs.every(c=>c.objective_id),'factory configs must create/link objectives');
  work=db.nextFactoryWork(curriculum.id);
  assert(work?.type==='RESEARCH_CONFIG' && work.year.year===2000,'factory must research configs before next year');
  for(const config of configs){
    const topics=db.listTopics(config.objective_id);
    for(const topic of topics) db.setTopicStatus(topic.id,'VERIFIED');
    const progress=db.refreshFactoryConfigProgress(config.id,0.85);
    assert(progress.status==='COMPLETE' && progress.coverage===1,'verified config must complete');
  }
  db.refreshFactoryYearProgress(work.year.id,0.85);
  const year=db.getFactoryYear(work.year.id);
  assert(year.research_status==='COMPLETE','year must complete after all configs complete');
  work=db.nextFactoryWork(curriculum.id);
  assert(work?.type==='DISCOVER_YEAR' && work.year.year===2001,'factory did not advance to next year');
  db.setFactoryYearState(work.year.id,{discovery_status:'NEEDS_REVIEW',research_status:'NEEDS_REVIEW',attempts:3,last_error:'legacy strict parser'});
  db.resetFactoryDiscoveryReviews(curriculum.id);
  const retried=db.getFactoryYear(work.year.id);
  assert(retried.discovery_status==='QUEUED' && retried.attempts===0,'legacy discovery REVIEW years were not reset safely');
  const stats=db.factoryStats();
  assert(stats.curricula===1 && stats.years===3 && stats.configs===2,'factory stats mismatch');
  console.log('Auto Knowledge Factory validation: PASS');
  console.log(JSON.stringify({ years:stats.years,configs:stats.configs,topics:AUTOMOTIVE_BASE_TOPICS.length,nextYear:work.year.year },null,2));
} finally { db.close(); fs.rmSync(root,{recursive:true,force:true}); }
