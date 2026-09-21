'use strict';
const fs=require('fs');const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','src','index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','src','app.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'..','src','app.js'),'utf8');
const checks=[
['scroll shell exists',html.includes('id="chatScrollShell"')],
['visible rail exists',html.includes('id="chatScrollRail"')],
['draggable thumb exists',html.includes('id="chatScrollThumb"')],
['jump button exists',html.includes('id="jumpToBottomBtn"')],
['rail positioned',css.includes('.chat-scroll-rail')&&css.includes('position:absolute')],
['thumb styled',css.includes('.chat-scroll-thumb')&&css.includes('cursor:grab')],
['native scrollbar hidden',css.includes('scrollbar-width:none')],
['sync exists',js.includes('function updateScrollUi()')],
['rail click exists',js.includes('setScrollFromRailPointer')],
['thumb drag exists',js.includes('beginScrollThumbDrag')&&js.includes('moveScrollThumbDrag')],
['jump wired',js.includes("els.jumpToBottomBtn.addEventListener('click'")]
];
const failed=checks.filter(x=>!x[1]);for(const [n,ok] of checks)console.log((ok?'PASS ':'FAIL ')+n);if(failed.length)process.exit(1);console.log('Chat scroll validation: '+checks.length+'/'+checks.length+' PASS');
