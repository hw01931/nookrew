// Desktop fallback: the local rollout format is internal and may change.
// Only project identity and allowlisted lifecycle metadata are persisted.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {StringDecoder} = require('node:string_decoder');
const {tokenCounts, tokenDifference} = require('../dist/src/domain/presence-usage.js');
const {OfficePresence} = require('../dist/src/infrastructure/office-presence.js');
const LIMIT = 1048576;
const validId = (v) => typeof v === 'string' && /^[\w.-]{1,150}$/.test(v);
function lifecycle(record) {
  const p = record.payload;
  if (!p) return null;
  if (record.type === 'event_msg' && ['task_started', 'task_complete'].includes(p.type))
    return {
      hook_event_name: p.type === 'task_started' ? 'UserPromptSubmit' : 'Stop',
      ...(validId(p.turn_id) ? {turn_id: p.turn_id} : {}),
    };
  if (record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p.type)) {
    // Classify locally; neither tool names nor arguments are persisted.
    const name = String(p.name || '');
    const args = String(p.arguments || p.input || '').slice(0, 65536);
    const activity = /spawn_agent|delegate/.test(name)
      ? 'DELEGATE'
      : /search|web.*run/.test(name) || /\brg\s|search_query/.test(args)
        ? 'SEARCH'
        : /read_file|view_image/.test(name) || /Get-Content/.test(args)
          ? 'READ'
          : /\b(?:npm|npx|node)\s+(?:run\s+(?:build|test)|tsc|--test)/.test(args)
            ? 'BUILD'
            : 'WORK';
    return {hook_event_name: 'PreToolUse', activity};
  }
  return null;
}
function metadata(file, root) {
  const buffer = Buffer.alloc(LIMIT),
    fd = fs.openSync(file, 'r');
  let size;
  try {
    size = fs.readSync(fd, buffer, 0, LIMIT, 0);
  } finally {
    fs.closeSync(fd);
  }
  const end = buffer.indexOf(10);
  if (end < 0 || end >= size) return null;
  let r;
  try {
    r = JSON.parse(buffer.subarray(0, end).toString('utf8'));
  } catch {
    return null;
  }
  const p = r.payload;
  if (r.type !== 'session_meta' || !validId(p?.id) || typeof p.cwd !== 'string') return null;
  if (fs.realpathSync(p.cwd).toLowerCase() !== root.toLowerCase()) return null;
  // Automatic approval reviewers are infrastructure, not user-delegated employees.
  if (p.source?.subagent?.other === 'guardian') return null;
  const parent = validId(p.parent_thread_id) ? p.parent_thread_id : '';
  return {session: parent || p.id, agent: parent ? p.id : '', id: p.id};
}
function createProjectObserver({root, sessions, currentSession = '', recentMs = 1800000, clock = Date.now}) {
  root = fs.realpathSync(root);
  sessions = fs.realpathSync(sessions);
  const directory = path.join(root, '.aiorchestra');
  fs.mkdirSync(directory, {recursive: true});
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('STORAGE_LINK_DENIED');
  const database = path.join(directory, 'office-presence.db');
  if (fs.existsSync(database) && fs.lstatSync(database).isSymbolicLink()) throw Error('STORAGE_LINK_DENIED');
  const store = new OfficePresence(root),
    readers = new Map();
  const knownSessions = new Set(
    store
      .list(true)
      .filter((p) => p.provider === 'codex')
      .flatMap((p) => [p.session, p.agent].filter(Boolean)),
  );
  function emit(reader, event, key) {
    return store.observe(
      'codex',
      {cwd: root, session_id: reader.session, ...(reader.agent ? {agent_id: reader.agent} : {}), ...event},
      {
        actor: 'hook:codex',
        project_id: root,
        expected_version: 0,
        idempotency_key:
          'desktop-' +
          createHash('sha256')
            .update(reader.id + ':' + key)
            .digest('hex'),
        correlation_id: 'desktop-project-observer',
      },
    );
  }
  function discover(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        discover(file);
        continue;
      }
      if (!entry.name.endsWith('.jsonl') || readers.has(file) || readers.size >= 100) continue;
      const stat = fs.statSync(file);
      if (
        stat.mtimeMs < clock() - recentMs &&
        ![currentSession, ...knownSessions].some((id) => id && entry.name.endsWith('-' + id + '.jsonl'))
      ) {
        const fd = fs.openSync(file, 'r'),
          tail = Buffer.alloc(Math.min(stat.size, 65536));
        try {
          fs.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length));
        } finally {
          fs.closeSync(fd);
        }
        const recent = tail
          .toString('utf8')
          .split('\n')
          .some((line) => {
            try {
              const r = JSON.parse(line);
              return Date.parse(r.timestamp) >= clock() - recentMs;
            } catch {
              return false;
            }
          });
        if (!recent) continue;
      }
      let meta;
      try {
        meta = metadata(file, root);
      } catch {
        continue;
      }
      if (!meta) continue;
      const offset = 0;
      const reader = {
        ...meta,
        file,
        offset,
        pending: '',
        discard: offset > 0,
        decoder: new StringDecoder('utf8'),
      };
      const person = emit(
        reader,
        {hook_event_name: reader.agent ? 'SubagentStart' : 'SessionStart'},
        'metadata',
      );
      if (!person.label)
        store.configure(
          person.id,
          meta.id === currentSession ? 'Codex · 현재 대화' : 'Codex · ' + meta.id.slice(-6),
          meta.agent ? 'subagent' : 'desktop · 실행 기록 관찰',
          {
            actor: 'local-user',
            project_id: root,
            expected_version: person.version,
            idempotency_key: 'desktop-label-' + meta.id,
            correlation_id: 'desktop-project-observer',
          },
        );
      readers.set(file, reader);
      knownSessions.add(reader.session);
      if (reader.agent) knownSessions.add(reader.agent);
      try {
        // Restore the last lifecycle with its turn identity, then follow only appended bytes.
        // A tail window can miss task_started and incorrectly reject the matching completion.
        while (reader.offset < stat.size) read(reader, true);
        for (const report of reader.usagePending?.values() || []) storeUsage(reader, report);
        delete reader.usagePending;
        const latest = reader.restored;
        const saved = store.list().find((p) => p.id === person.id);
        if (latest) {
          const sameTurn = saved?.turn === latest.event.turn_id;
          const done = ['Stop', 'SubagentStop'].includes(latest.event.hook_event_name);
          if (!(sameTurn && done && ['IDLE', 'DELIVERED'].includes(saved?.status))) {
            if (latest.event.turn_id && !sameTurn)
              emit(
                reader,
                {hook_event_name: 'UserPromptSubmit', turn_id: latest.event.turn_id},
                'restore-start:' + latest.event.turn_id,
              );
            emit(reader, latest.event, 'restore-v2:' + latest.key);
          }
        }
        delete reader.restored;
      } catch (error) {
        readers.delete(file);
        throw error;
      }
    }
  }
  function storeUsage(reader, report) {
    store.recordUsage(report, {
      actor: 'hook:codex',
      project_id: root,
      expected_version: 0,
      idempotency_key:
        'usage-' +
        createHash('sha256')
          .update(reader.id + JSON.stringify(report))
          .digest('hex'),
      correlation_id: 'desktop-project-observer',
    });
  }
  function read(reader, restore = false) {
    if (fs.lstatSync(reader.file).isSymbolicLink()) throw Error('SESSION_LINK_DENIED');
    const size = fs.statSync(reader.file).size;
    if (size < reader.offset) {
      reader.offset = 0;
      reader.pending = '';
      reader.discard = false;
      reader.decoder = new StringDecoder('utf8');
      reader.cumulative = null;
      reader.usageBaseline = null;
      reader.usageAt = null;
      reader.turn = null;
    }
    if (size === reader.offset) return;
    const buffer = Buffer.alloc(Math.min(size - reader.offset, LIMIT)),
      fd = fs.openSync(reader.file, 'r');
    let bytes;
    try {
      bytes = fs.readSync(fd, buffer, 0, buffer.length, reader.offset);
    } finally {
      fs.closeSync(fd);
    }
    reader.offset += bytes;
    const lines = (reader.pending + reader.decoder.write(buffer.subarray(0, bytes))).split('\n');
    reader.pending = lines.pop();
    if (reader.pending.length > LIMIT) {
      reader.pending = '';
      reader.discard = true;
    }
    for (const line of lines) {
      if (reader.discard) {
        reader.discard = false;
        continue;
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === 'turn_context' && typeof record.payload?.model === 'string')
        reader.model = record.payload.model.slice(0, 120);
      if (
        record.type === 'event_msg' &&
        record.payload?.type === 'token_count' &&
        record.payload.info &&
        Number.isFinite(Date.parse(record.timestamp)) &&
        (!reader.usageAt || Date.parse(record.timestamp) > Date.parse(reader.usageAt))
      ) {
        const counts = tokenCounts(record.payload.info.total_token_usage);
        if (reader.cumulative && tokenDifference(counts, reader.cumulative) === null)
          reader.usageBaseline = null;
        const person = store
          .list()
          .find(
            (p) => p.session === reader.session && p.agent === (reader.agent || '') && p.provider === 'codex',
          );
        if (person) {
          const report = {
            person: person.id,
            turn: reader.turn || '',
            model: reader.model || '',
            observedAt: record.timestamp,
            source: 'codex-rollout',
            session: counts,
            lastCall: tokenCounts(record.payload.info.last_token_usage),
            currentTurn: tokenDifference(counts, reader.usageBaseline || null),
          };
          if (restore) {
            reader.usagePending ||= new Map();
            reader.usagePending.set(report.turn, report);
          } else storeUsage(reader, report);
        }
        reader.cumulative = counts;
        reader.usageAt = record.timestamp;
      }
      const event = lifecycle(record);
      if (!event) continue;
      if (event.hook_event_name === 'UserPromptSubmit') {
        reader.turn = event.turn_id;
        reader.usageBaseline = reader.cumulative || null;
      } else if (!event.turn_id && reader.turn) event.turn_id = reader.turn;
      if (reader.agent && event.hook_event_name === 'Stop') event.hook_event_name = 'SubagentStop';
      const key = record.timestamp + ':' + JSON.stringify(event);
      if (restore) reader.restored = {event, key};
      else emit(reader, event, key);
    }
  }
  let watcher, watchTimer;
  const api = {
    poll() {
      for (const [file] of readers) if (!fs.existsSync(file)) readers.delete(file);
      discover(sessions);
      const present = new Set([...readers.values()].map((r) => r.agent || r.session));
      for (const person of store.list(true).filter((p) => p.provider === 'codex'))
        store.sourceAvailability(person.id, present.has(person.agent || person.session), {
          actor: 'hook:codex',
          project_id: root,
          expected_version: 0,
          idempotency_key: 'availability',
          correlation_id: 'source-reconciliation',
        });
      for (const reader of readers.values()) {
        try {
          read(reader);
        } catch (error) {
          readers.delete(reader.file);
          throw error;
        }
      }
    },
    list: () => store.list(),
    usage: () => store.usage(),
    watch(onError = () => {}) {
      watcher = fs.watch(sessions, {recursive: true}, () => {
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          try {
            api.poll();
          } catch {
            onError();
          }
        }, 100);
      });
      watcher.on('error', onError);
    },
    close() {
      clearTimeout(watchTimer);
      watcher?.close();
      store.close();
    },
  };
  return api;
}
function main() {
  const observer = createProjectObserver({
    root: path.resolve(__dirname, '..'),
    sessions: path.join(process.env.USERPROFILE, '.codex', 'sessions'),
    currentSession: process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || '',
  });
  observer.poll();
  const timer = setInterval(() => {
    try {
      observer.poll();
    } catch {
      console.error('Project session observation unavailable');
    }
  }, 1500);
  process.on('SIGINT', () => {
    clearInterval(timer);
    observer.close();
    process.exit();
  });
  console.log('Observing Codex sessions for this project');
}
module.exports = {lifecycle, metadata, createProjectObserver, main};
