import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

test('renamed CLI preserves legacy data/plugins and prioritizes the new token', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'webdesk-migration-'));
  const data = path.join(home, '.local/share/codex-remote-web');
  const plugins = path.join(home, '.config/codex-remote-web/plugins');
  await mkdir(data, {recursive:true});
  await mkdir(plugins, {recursive:true});
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const token = 'new-environment-token-123456';
  const child = spawn(process.execPath, ['bin/cli.js', '--port', String(port), '--cwd', home], {
    env: {...process.env, HOME:home, CODEX_HOME:path.join(home,'.codex'), CODEX_WEBDESK_TOKEN:token,
      CODEX_REMOTE_WEB_TOKEN:'legacy-environment-token-123456'}, stdio:['ignore','pipe','pipe']
  });
  try {
    const output = await new Promise((resolve,reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('CLI startup timeout')),5000);
      child.stdout.on('data',chunk => {text += chunk; if(text.includes('History:')) {clearTimeout(timer);resolve(text);}});
      child.once('exit',code => {clearTimeout(timer);reject(new Error(`CLI exited ${code}`));});
    });
    assert.ok(output.includes(`History: ${data}`));
    assert.ok(!output.includes(token));
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base+'/api/config', {headers:{Authorization:`Bearer ${token}`}})).status,200);
    assert.equal((await fetch(base+'/api/config', {headers:{Authorization:'Bearer legacy-environment-token-123456'}})).status,401);
  } finally {
    if(child.exitCode===null) {const closed = new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}
    await rm(home,{recursive:true,force:true});
  }
});
