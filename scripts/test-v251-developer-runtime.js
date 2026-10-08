'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const {spawnSync}=require('child_process');
const {DeveloperRuntime}=require('../lib/developer-runtime-v251');
(async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-v251-')); const project=path.join(base,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'a.js'),'console.log(1);\n');
 const rt=new DeveloperRuntime({baseDir:path.join(base,'runtime'),config:{allowedRoots:[project],terminal:{allowedCommands:['node','npm']},git:{enabled:true,networkEnabled:false}}});
 const caps=rt.capabilities(); if(!caps.terminal.commandAvailability||typeof caps.terminal.commandAvailability.node!=='boolean')throw new Error('commandAvailability missing');
 const node=await rt.runTerminal({root:project,command:'node',args:['--check','a.js'],timeoutMs:30000}); if(!node.ok)throw new Error('node check failed '+node.stderr);
 let blocked=false;try{await rt.runTerminal({root:project,command:'git',args:['status']});}catch(e){blocked=/Comando no permitido/.test(e.message);} if(!blocked)throw new Error('generic terminal must keep git blocked unless explicitly allowlisted');
 if(caps.git.available){const g=spawnSync('git',['init'],{cwd:project,encoding:'utf8'});if(g.status===0){const status=await rt.gitRun({root:project,operation:'status'});if(status.error&&/Comando no permitido/.test(status.error))throw new Error('gitRun incorrectly routed through terminal allowlist');}}
 fs.rmSync(base,{recursive:true,force:true});console.log('test-v251-developer-runtime: PASS');
})().catch(e=>{console.error(e);process.exit(1);});
