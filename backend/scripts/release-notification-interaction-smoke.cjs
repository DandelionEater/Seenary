const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sent = [];
const ipcHandlers = new Map();
const callbacks = new Map();
function element() {
  const handlers = new Map();
  const classes = new Set();
  return { handlers, style: {}, textContent: '', hidden:true,
    classList:{ add: name=>classes.add(name), remove:name=>classes.delete(name), contains:name=>classes.has(name) },
    addEventListener: (name, fn) => handlers.set(name, fn),
    setPointerCapture() {}, hasPointerCapture:()=>false, releasePointerCapture() {},
    getBoundingClientRect:()=>({height:170,width:394}),
  };
}
const elements = Object.fromEntries(['label','title','message','cover','dismiss','open','article','body'].map(name=>[name,element()]));
vm.runInNewContext(fs.readFileSync(require.resolve('../release-notification-preload'),'utf8'), {
  require:()=>({ipcRenderer:{on:(name,fn)=>ipcHandlers.set(name,fn),send:(...args)=>sent.push(args)}}),
  window:{addEventListener:(name,fn)=>callbacks.set(name,fn)},
  document:{getElementById:name=>elements[name],querySelector:()=>elements.article,body:elements.body},
  setTimeout() {},
});
callbacks.get('DOMContentLoaded')();
ipcHandlers.get('release-notice:visible')();
assert.ok(elements.body.classList.contains('visible'));
ipcHandlers.get('release-notice:fade-out')();
assert.equal(elements.body.classList.contains('visible'),false);
const pointer=(x,y=0)=>({button:0,pointerId:1,clientX:x,clientY:y,target:{closest:()=>null}});
const fire=(name,event)=>elements.article.handlers.get(name)(event);
const click=()=>elements.open.handlers.get('click')({preventDefault(){}});
fire('pointerdown',pointer(10));fire('pointerup',pointer(10));click();
assert.equal(sent.pop()[0],'release-notice:open','tap opens title');
for(const dx of [150,-150]) {
  fire('pointerdown',pointer(150));fire('pointermove',pointer(150+dx));fire('pointerup',pointer(150+dx));click();
  assert.equal(sent.pop()[0],'release-notice:dismiss','swipe in either direction dismisses');
  assert.equal(sent.length,0,'swipe never navigates');
}
fire('pointerdown',pointer(100));fire('pointermove',pointer(125));fire('pointerup',pointer(125));click();
assert.equal(sent.length,0,'short drag never dismisses or navigates');
assert.equal(elements.article.style.transform,'','short drag snaps back');
assert.ok(elements.article.classList.contains('snapping-back'),'short drag gets spring animation');
fire('pointerdown',pointer(100));fire('pointermove',pointer(190));fire('pointerup',pointer(190));click();
assert.equal(sent.length,0,'less than thirty percent of width never dismisses');
fire('pointerdown',pointer(100));fire('pointermove',pointer(200));fire('pointercancel',pointer(200));
assert.equal(sent.length,0,'cancelled swipe snaps back');
const html=fs.readFileSync(require.resolve('../release-notification.html'),'utf8');
assert.match(html,/countdown 10s linear/);
console.log('PASS: notification taps, left/right swipes, short drags, cancellation, fade signals and countdown duration.');
