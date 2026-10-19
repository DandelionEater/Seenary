import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/cloud/rendererAdapter.ts', import.meta.url), 'utf8');
const start = source.indexOf('  let lastSessionRenewal =');
assert(start >= 0);
const code = ts.transpileModule(source.slice(start, source.lastIndexOf('}')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const handlers = new Map();
let now = 0;
let visible = true;
let focused = true;
let calls = 0;
let fail = false;
let signedIn = true;
vm.runInNewContext(code, {
  window: { addEventListener: (name, handler) => handlers.set(name, handler) },
  document: { get visibilityState() { return visible ? 'visible' : 'hidden'; }, hasFocus: () => focused },
  performance: { now: () => now },
  get user() { return signedIn ? { id: 'user' } : null; },
  rpc: async (method, args, id) => {
    assert.equal(method, 'renewSession'); assert.equal(id, 'user'); calls++;
    if (fail) throw new Error('offline');
    return { ok: true };
  },
});
const input = async (name = 'pointerdown', trusted = true) => {
  handlers.get(name)({ isTrusted: trusted });
  await new Promise(resolve => setImmediate(resolve));
};
assert.deepEqual([...handlers.keys()], ['pointerdown', 'keydown', 'wheel']);
assert.equal(calls, 0, 'installation/startup never renews');
await input('pointerdown', false);
visible = false; await input(); visible = true;
focused = false; await input(); focused = true;
signedIn = false; await input(); signedIn = true;
assert.equal(calls, 0, 'synthetic, hidden, unfocused, and signed-out input ignored');
await input(); assert.equal(calls, 1);
await input('keydown'); assert.equal(calls, 1, 'input is throttled');
now += 3600000;
await input('wheel'); assert.equal(calls, 2);
now += 3600000; fail = true;
await input(); assert.equal(calls, 3);
await input(); assert.equal(calls, 3, 'failure cooldown');
now += 60000; fail = false;
await input(); assert.equal(calls, 4, 'network failures retry only on fresh input');
console.log('PASS: trusted foreground input, no startup renewal, throttle and input-only network retry.');
