process.env.VITE_ATLAS_STAGING = 'true';
process.argv.push('--host', '127.0.0.1', '--port', '5173', '--strictPort');
await import('../node_modules/vite/bin/vite.js');
