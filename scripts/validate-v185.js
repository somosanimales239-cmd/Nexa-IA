'use strict';
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const main=fs.readFileSync(path.join(root,'main-v185.js'),'utf8');
const lib=fs.readFileSync(path.join(root,'lib','visual-review-v185.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
function must(condition,message){if(!condition){console.error('FAIL:',message);process.exit(1);}}
must(pkg.version==='1.8.5','package version');
must(pkg.main==='main-v185.js','active main');
must(main.includes('callQwenReviewSafely'),'safe Qwen retry controller');
must(main.includes('repeat_penalty:1.16'),'repeat penalty profile 1');
must(main.includes('repeat_penalty:1.20'),'repeat penalty profile 2');
must(main.includes('repeat_penalty:1.22'),'repeat penalty profile 3');
must(main.includes('num_predict:360') && main.includes('num_predict:280') && main.includes('num_predict:180'),'bounded Qwen outputs');
must(!main.includes('num_predict:900'),'old dangerous 900-token review removed');
must(!main.includes('num_predict:750'),'old dangerous 750-token repair removed');
must(main.includes('reviewUnavailable:true'),'graceful evaluator failure');
must(main.includes("evaluationStatus:chosen.evaluation.reviewUnavailable?'REVIEW_UNAVAILABLE'"),'review unavailable delivery status');
must(main.includes('!attempts[attempts.length-1].evaluation.reviewUnavailable'),'no useless image retries after reviewer outage');
must(main.includes('think:false'),'thinking disabled for visual reviewer');
must(lib.includes("const MODEL = 'qwen2.5vl:3b'"),'visual model preserved');
for(const file of ['main-v185.js','lib/visual-review-v185.js']){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 must(!text.includes('<<<<<<<')&&!text.includes('>>>>>>>'),'no conflict markers in '+file);
}
console.log('Nexa AI v1.8.5 repeat-safe visual review validation: OK');
