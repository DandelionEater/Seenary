const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const backendDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(backendDir, '..', 'frontend');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function portIsOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPort(port, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsOpen(port)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not open port ${port} within ${timeoutMs / 1000} seconds.`);
}

function start(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env },
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
    windowsHide: false,
  });
  children.push({ label, child });
  child.once('error', error => {
    if (!stopping) stop(1, `${label} failed to start: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) stop(code || 1, `${label} stopped unexpectedly${signal ? ` (${signal})` : ''}.`);
  });
  return child;
}

function stop(code = 0, message = '') {
  if (stopping) return;
  stopping = true;
  if (message) console.error(message);
  for (const { child } of [...children].reverse()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

async function main() {
  if (await portIsOpen(3001) || await portIsOpen(5173)) {
    throw new Error('Ports 3001 or 5173 are already in use. Stop the old Atlas/Vite terminals, then retry.');
  }

  console.log('Starting the local Atlas API…');
  start('Atlas API', process.execPath, [path.join(__dirname, 'start-atlas-local.js')], backendDir);
  await waitForPort(3001, 'Atlas API', 45000);

  console.log('Starting the Atlas frontend…');
  start('Vite frontend', npmCommand, ['run', 'dev:atlas'], frontendDir);
  await waitForPort(5173, 'Vite frontend', 30000);

  console.log('Opening Seenary in Electron…');
  start('Electron', process.execPath, [path.join(__dirname, 'start-electron.js'), '--atlas'], backendDir);
  console.log('Seenary Atlas development stack is ready. Press Ctrl+C once to stop everything.');
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
main().catch(error => stop(1, error.message));
