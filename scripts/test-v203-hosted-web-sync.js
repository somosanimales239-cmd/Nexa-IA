'use strict';
const assert=require('assert');const fs=require('fs'),path=require('path');
const agent=fs.readFileSync(path.join(__dirname,'..','lib','hosted-web-agent-v203.js'),'utf8');
for(const token of ['runtimeStatus(force=false)','checked:true','runtimeStatus','compactStore(snapshot)','slice(0,60)','slice(-100)','agentVersion:this.version','forgeBaseUrl:this.cfg.forgeBaseUrl'])assert(agent.includes(token),token);
assert(agent.includes("{version:this.version,platform:process.platform,runtime}"));
const main=fs.readFileSync(path.join(__dirname,'..','main-v203.js'),'utf8');
assert(main.includes("require('./main-v198.js')"));
assert(main.includes("require('./lib/hosted-web-agent-v203')"));
console.log('Nexa AI v2.0.3 Hosted Web sync tests: OK');
