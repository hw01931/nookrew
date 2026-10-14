// Real Docker integration and a controlled filesystem commit fault; no model output is substituted.
const {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {resolve} = require('node:path');
const assert = require('node:assert/strict');
const {ProjectChanges} = require('../../dist/src/adapters/project-changes.js');
const {CollaborationStore} = require('../../dist/src/infrastructure/collaboration-store.js');
const {owner} = require('../../dist/src/domain/collaboration.js');
const {createCommand} = require('../../dist/src/application/command.js');
(async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'managed-real-'));
  for (const f of ['src', 'tests', 'experiments', '.aiorchestra']) mkdirSync(resolve(root, f));
  writeFileSync(
    resolve(root, 'experiments/workspace-scope.json'),
    JSON.stringify({schema_version: 1, include: ['src/**', 'tests/**'], exclude: []}),
  );
  writeFileSync(resolve(root, 'src/old.js'), 'module.exports=1;');
  // node-web verification requires an app page (APP_SHELL check).
  writeFileSync(resolve(root, 'src/index.html'), '<!doctype html><title>t</title>');
  const acceptance =
    "const t=require('node:test'),a=require('node:assert/strict');t('actual behavior',()=>{a.equal(require('../src/old.js'),2);a.equal(require('../src/new.js'),3);});";
  writeFileSync(resolve(root, '.aiorchestra/acceptance.test.cjs'), acceptance);
  const store = new CollaborationStore(':memory:', root);
  let fault = true;
  const changes = new ProjectChanges(root, store, 'node-web', {
    beforeCommit() {
      if (fault) throw Error('INJECTED_COMMIT_FAILURE');
    },
  });
  const room = store.put(
    'room',
    null,
    {name: '검증', type: 'project', members: []},
    ['staff'],
    owner,
    createCommand(owner.id, root, 'room', 0),
  );
  try {
    const proposal = () =>
      changes.propose(
        {
          title: '실제 검증',
          files: [
            {
              path: 'src/old.js',
              beforeHash: changes.read('src/old.js', owner).hash,
              content: 'module.exports=2;',
            },
            {path: 'src/new.js', beforeHash: null, content: 'module.exports=3;'},
          ],
        },
        owner,
        room,
      );
    const c = proposal();
    const verified = await changes.verify(c.id, c.version);
    assert.equal(verified.evidence.status, 'PASS', verified.evidence.log);
    console.log('Docker assertions PASS');
    writeFileSync(resolve(root, '.aiorchestra/acceptance.test.cjs'), acceptance + '\n// changed');
    assert.throws(() => changes.approve(c.id, verified.version), /SOURCE_CHANGED/);
    writeFileSync(resolve(root, '.aiorchestra/acceptance.test.cjs'), acceptance);
    const approved = changes.approve(c.id, verified.version);
    assert.throws(() => changes.apply(c.id, approved.version), /INJECTED/);
    assert.equal(changes.get(c.id).state, 'UNKNOWN');
    assert.equal(readFileSync(resolve(root, 'src/old.js'), 'utf8'), 'module.exports=1;');
    assert.ok(!existsSync(resolve(root, 'src/new.js')));
    console.log('Commit fault rollback and UNKNOWN PASS');
    fault = false;
    const next = proposal();
    const v = await changes.verify(next.id, next.version);
    assert.equal(v.evidence.status, 'PASS', v.evidence.log);
    const a = changes.approve(v.id, v.version);
    changes.apply(a.id, a.version);
    assert.equal(readFileSync(resolve(root, 'src/new.js'), 'utf8'), 'module.exports=3;');
    console.log('New and modified files applied PASS');
    console.log(JSON.stringify({root, verification: 'PASS', fault: 'PASS', apply: 'PASS'}));
  } finally {
    await changes.close();
    store.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
