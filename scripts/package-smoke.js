import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { name, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const archive = path.resolve(`${name}-${version}.tgz`);
const root = await mkdtemp(path.join(os.tmpdir(), 'codex-plugin-package-'));
let child;
try {
  execFileSync('npm', ['install', '--prefix', root, '--omit=dev', '--no-audit', '--no-fund', process.env.WEBDESK_PACKAGE_SPEC || archive], { stdio: 'pipe' });
  const packageDir = path.join(root, `node_modules/${name}`);
  const bin = path.join(root, `node_modules/.bin/${name}`);
  assert.equal(execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(), version);
  const home = path.join(root, 'codex');
  await mkdir(path.join(home, 'sessions'), { recursive: true });
  const id = '77777777-7777-4777-8777-777777777777';
  await writeFile(path.join(home, 'sessions/demo.jsonl'), [
    {type:'session_meta',payload:{id,cwd:root}},
    {type:'event_msg',payload:{type:'user_message',message:'Package test'}}
  ].map(row=>JSON.stringify(row)).join('\n'));
  const probe = createServer();
  await new Promise(resolve=>probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve=>probe.close(resolve));
  const token = 'package-test-token-123456789';
  child = spawn(bin, ['start', '--port', String(port), '--cwd', root, '--data-dir', path.join(root,'data'), '--codex-home', home, '--plugins-dir', path.join(packageDir,'examples/plugins'), '--token', token], {stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Package startup timeout')),5000);
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('Listening:')){clearTimeout(timer);resolve();}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Package startup exited ${code}`));});
  });
  const base=`http://127.0.0.1:${port}`;
  const request=(route,init={})=>fetch(base+route,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers}});
  assert.equal((await fetch(base)).status,200);
  assert.equal((await fetch(base+'/plugins/codex-history/index.html')).status,401);
  const plugins=await(await request('/api/plugins')).json();
  assert.deepEqual(plugins.plugins.map(plugin=>plugin.id),['workbench','codex-history','server-info']);
  assert.equal((await request('/plugins/codex-history/app.js')).status,200);
  assert.equal((await request('/api/plugins/server-info/info')).status,200);
  const sessions=await(await request('/api/plugins/codex-history/api/sessions')).json();
  assert.equal(sessions.sessions.length,1);
  const exported=await request('/api/plugins/codex-history/api/sessions/export',{method:'POST',headers:{'X-CSRF-Token':sessions.csrfToken},body:JSON.stringify({ids:[id],format:'html'})});
  assert.equal(exported.status,200);assert.match(await exported.text(),/Package test/);
  console.log('Packed install passed: CLI, protected plugin assets, custom plugin API, Python adapter and offline HTML export.');
} finally {
  if(child && child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}
  await rm(root,{recursive:true,force:true});
}
