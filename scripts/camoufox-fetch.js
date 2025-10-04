#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

if (process.env.SKIP_CAMOUFOX_FETCH === '1') {
    console.log('Skipping Camoufox browser fetch because SKIP_CAMOUFOX_FETCH=1');
    process.exit(0);
}

const result = spawnSync('npx', ['camoufox-js', 'fetch'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (result.error) {
    console.warn(`Camoufox fetch failed to start: ${result.error.message}`);
    process.exit(0);
}

if (result.status !== 0) {
    console.warn(`Camoufox fetch exited with code ${result.status}. You may need to run it manually.`);
}
