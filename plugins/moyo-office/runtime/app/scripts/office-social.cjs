const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
(async () => {
  const args = process.argv.slice(2),
    at = args.indexOf('--project');
  if (at < 0 || !args[at + 1]) throw Error('PROJECT_REQUIRED');
  const root = fs.realpathSync(path.resolve(args[at + 1]));
  args.splice(at, 2);
  const {SocialWorkspace} = await import('../dist/src/infrastructure/social-workspace.js');
  const {OfficePresence} = await import('../dist/src/infrastructure/office-presence.js');
  const presence = new OfficePresence(root, path.join(root, '.aiorchestra'));
  const service = new SocialWorkspace(root, undefined, undefined, (id) =>
    presence.list().some((p) => p.id === id),
  );
  try {
    if (args[0] === 'list') console.log(JSON.stringify(service.view(), null, 2));
    else if (args[0] === 'draft' && args[1]) {
      const file = path.resolve(root, args[1]);
      const relative = path.relative(root, fs.realpathSync(file));
      if (relative.startsWith('..') || path.isAbsolute(relative) || fs.statSync(file).size > 16384)
        throw Error('DRAFT_FILE_DENIED');
      const input = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(
        JSON.stringify(
          await service.command(
            'draft',
            {accountId: input.accountId, text: input.text, imageUrl: input.imageUrl},
            {
              actor: 'local-user',
              project_id: root,
              expected_version: 0,
              idempotency_key: args[2] || crypto.randomUUID(),
              correlation_id: crypto.randomUUID(),
            },
          ),
          null,
          2,
        ),
      );
    } else throw Error('USAGE: --project <folder> list | draft <json> [idempotency-key]');
  } finally {
    service.close();
    presence.close();
  }
})().catch((e) => {
  console.error(/^[A-Z_]+(?::.*)?$/.test(e.message) ? e.message : 'SOCIAL_COMMAND_FAILED');
  process.exitCode = 1;
});
