require('../env');
const dns = require('node:dns');
const tls = require('node:tls');

async function main() {
  const hostname = new URL(process.env.MONGODB_URI).hostname;
  const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const records = await resolver.resolveSrv(`_mongodb._tcp.${hostname}`);
  const target = records[0];
  if (!target) throw new Error('No SRV records.');
  const publicAddresses = await resolver.resolve4(target.name);
  const systemAddresses = await dns.promises.lookup(target.name, { all: true, family: 4 });
  console.log(JSON.stringify({ publicAndSystemDnsAgree: systemAddresses.some(item => publicAddresses.includes(item.address)) }));
  for (const [label, options] of [['default', {}], ['ipv4', { family: 4 }], ['ipv4-tls12', { family: 4, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }],
    ['public-dns-ipv4', { host: publicAddresses[0], family: 4 }]]) {
    const result = await new Promise(resolve => {
      const socket = tls.connect({ host: target.name, port: target.port, servername: target.name, rejectUnauthorized: true, ...options });
      const timer = setTimeout(() => { socket.destroy(); resolve({ ok: false, code: 'TIMEOUT' }); }, 6000);
      socket.once('secureConnect', () => { clearTimeout(timer); resolve({ ok: socket.authorized, protocol: socket.getProtocol() }); socket.destroy(); });
      socket.once('error', error => { clearTimeout(timer); resolve({ ok: false, code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'UNKNOWN' }); });
    });
    console.log(JSON.stringify({ test: label, ...result }));
  }
}
main().catch(error => { console.error(`TLS probe failed: ${/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'UNKNOWN'}`); process.exitCode = 1; });
