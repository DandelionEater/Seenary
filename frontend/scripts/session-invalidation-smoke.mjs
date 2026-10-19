import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/cloud/rendererAdapter.ts', import.meta.url), 'utf8');
const rpcSource = source.slice(source.indexOf('  async function rpc('), source.indexOf('  async function providerAuthorization('));
const code = ts.transpileModule(rpcSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let current = { id: 'old-account' };
let cleared = 0;
let events = 0;
let body;
const context = vm.createContext({
  get user() { return current; },
  lastRequest: 0, Date, Math, Promise, Error, Object, AbortSignal,
  setTimeout: (resolve) => { resolve(); },
  endpoint: 'https://example.test', __APP_VERSION__: 'test',
  recordDiagnosticError() {},
  activate: async value => { current = value; cleared++; },
  Event: class { constructor(type) { this.type = type; } },
  window: { dispatchEvent: event => { assert.equal(event.type, 'seenary:session-invalidated'); events++; } },
  fetch: async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: false, status: 409, json: async () => ({ ok: false, code: 'ACCOUNT_CHANGED' }) };
  },
});
vm.runInContext(code, context);
await assert.rejects(vm.runInContext("rpc('logout', [], 'old-account')", context), /ACCOUNT_CHANGED/);
assert.equal(body.expectedUserId, 'old-account');
assert.equal(current, null);
assert.equal(cleared, 1);
assert.equal(events, 1);
current = { id: 'new-account' };
await assert.rejects(vm.runInContext("rpc('getProviderAccount', [], 'old-account')", context), /ACCOUNT_CHANGED/);
assert.equal(current.id, 'new-account', 'a late response must not invalidate a newer account');
assert.equal(cleared, 1);
assert.equal(events, 1);
console.log('PASS: stale session cleared; identity guard retained; late conflict cannot clear a newer account.');
