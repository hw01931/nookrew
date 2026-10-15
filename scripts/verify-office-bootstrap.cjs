const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process'),
  {randomUUID} = require('node:crypto');
const plugin = path.resolve(process.argv[2]);
const project = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nookrew-bootstrap-'));
const binary = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
const args =
  process.platform === 'win32'
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(plugin, 'scripts/open-office.ps1'),
        '-Project',
        project,
      ]
    : [path.join(plugin, 'scripts/open-office.sh'), project];
let url;
function launch() {
  const r = spawnSync(binary, args, {encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 65536});
  if (r.error || r.status !== 0) throw Error('BOOTSTRAP_FAILED:' + (r.error?.code || String(r.stderr).slice(-500)));
  const report = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(report.project, project);
  const u = new URL(report.url);
  assert.equal(u.protocol, 'http:');
  assert.ok(['127.0.0.1', '[::1]'].includes(u.hostname));
  return report;
}
(async () => {
  try {
    url = launch().url;
    assert.equal((await fetch(url)).status, 200);
    const reused = launch();
    assert.equal(reused.url, url);
    assert.equal(reused.reused, true);
    console.log(
      'PASS ' +
        process.platform +
        '-' +
        process.arch +
        ': download, pinned SHA256, extraction, bundled launch, repeat-cache reuse, real HTTP',
    );
  } finally {
    if (url) {
      const origin = new URL(url).origin;
      const office = await (await fetch(origin + '/api/office')).json();
      assert.equal(office.projectRoot, project);
      const state = await (await fetch(origin + '/api/state')).json();
      const r = await fetch(origin + '/api/office/companion-stop', {
        method: 'POST',
        headers: {Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': state.token},
        body: JSON.stringify({key: randomUUID(), version: 0}),
      });
      assert.ok(r.ok);
    }
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
