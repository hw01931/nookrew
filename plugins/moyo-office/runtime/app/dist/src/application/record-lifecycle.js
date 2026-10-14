"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordLifecycle = exports.policyReasons = void 0;
const command_js_1 = require("../domain/command.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const record_lifecycle_js_1 = require("../domain/record-lifecycle.js");
const language_js_1 = require("../domain/language.js");
const hash_js_1 = require("../infrastructure/hash.js");
const command_js_2 = require("./command.js");
/** Stored as the retention reason when the note policy, not the owner, archives a note. */
exports.policyReasons = { expired: 'POLICY_EXPIRED', overCap: 'POLICY_CAP' };
const reasonLimit = 2000;
function reasonOf(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > reasonLimit || value.includes('\u0000'))
        throw Error('REASON_REQUIRED');
    return value.trim();
}
/**
 * Decision changes and memory retention (ADR 0067). Owner commands only: an employee proposes
 * decisions and writes notes, but never cancels, replaces, archives or deletes them.
 */
class RecordLifecycle {
    store;
    language;
    policyConfig;
    constructor(store, language, policyConfig = {}) {
        this.store = store;
        this.language = language;
        this.policyConfig = policyConfig;
    }
    get policy() {
        return (0, record_lifecycle_js_1.notePolicy)(this.policyConfig);
    }
    assertOwner(command, minVersion = 1) {
        (0, command_js_1.assertCommand)(command, { actor: collaboration_js_1.owner.id, project: this.store.project, minVersion });
    }
    /** Inner writes of one command get keys derived from it, so a retry replays every one of them. */
    derived(command, part, version) {
        return (0, command_js_2.createCommand)(collaboration_js_1.owner.id, this.store.project, (0, hash_js_1.hash)([command.idempotency_key, part]), version);
    }
    decision(id) {
        const decision = this.store.get(id);
        if (decision.kind !== 'decision')
            throw Error('INVALID_DECISION');
        return decision;
    }
    impact(id) {
        const decision = this.decision(id);
        return {
            decision: { id: decision.id, version: decision.version, status: (0, collaboration_js_1.string)(decision.data, 'status') },
            records: (0, record_lifecycle_js_1.decisionImpact)(this.store.list(collaboration_js_1.owner), decision),
        };
    }
    /**
     * Cancels an accepted decision, or supersedes it with a new accepted one. The old decision keeps
     * its versions; it records the reason, what replaced it and the records citing it at that moment.
     */
    changeDecision(id, input, command) {
        this.assertOwner(command);
        const raw = (input && typeof input === 'object' ? input : {});
        const change = raw.change;
        if (change !== 'CANCEL' && change !== 'SUPERSEDE')
            throw Error('INVALID_DECISION_CHANGE');
        const reason = reasonOf(raw.reason);
        const replacement = change === 'SUPERSEDE'
            ? (raw.replacement && typeof raw.replacement === 'object' ? raw.replacement : {})
            : undefined;
        if (replacement && (!(0, collaboration_js_1.string)(replacement, 'title').trim() || typeof replacement.body !== 'string'))
            throw Error('REPLACEMENT_REQUIRED');
        const key = (0, hash_js_1.hash)(['decision-change', this.store.project, collaboration_js_1.owner.id, command.idempotency_key]), fingerprint = (0, hash_js_1.hash)([
            id,
            command.expected_version,
            change,
            reason,
            replacement ? [(0, collaboration_js_1.string)(replacement, 'title'), (0, collaboration_js_1.string)(replacement, 'body')] : null,
        ]);
        return this.store.idempotent(key, fingerprint, () => {
            const decision = this.decision(id);
            if (decision.version !== command.expected_version)
                throw Error('VERSION_CONFLICT');
            if (decision.data.status !== 'ACCEPTED')
                throw Error('DECISION_NOT_ACCEPTED');
            const impact = (0, record_lifecycle_js_1.decisionImpact)(this.store.list(collaboration_js_1.owner), decision);
            const context = {};
            for (const field of ['meetingId', 'roomId', 'workId'])
                if ((0, collaboration_js_1.string)(decision.data, field))
                    context[field] = decision.data[field];
            const created = replacement
                ? this.store.lifecyclePut('decision', null, {
                    title: (0, collaboration_js_1.string)(replacement, 'title').trim(),
                    body: (0, collaboration_js_1.string)(replacement, 'body'),
                    sourceIds: [],
                    status: 'ACCEPTED',
                    supersedes: decision.id,
                    ...context,
                }, decision.audience, collaboration_js_1.owner, this.derived(command, 'replacement', 0))
                : undefined;
            const retired = this.store.lifecyclePut('decision', decision.id, {
                ...decision.data,
                status: replacement ? 'SUPERSEDED' : 'CANCELLED',
                changeReason: reason,
                affectedIds: impact.slice(0, 100).map((r) => r.id),
                checkedIds: [],
                ...(created ? { supersededBy: created.id } : {}),
            }, decision.audience, collaboration_js_1.owner, this.derived(command, 'retire', decision.version));
            this.store.log(collaboration_js_1.owner, replacement ? 'decision.supersede' : 'decision.cancel', decision.id, 'SUCCEEDED');
            return { decision: retired, replacement: created ?? null, impact, truncated: impact.length > 100 };
        });
    }
    /** Follow-up: the owner marks one affected record as checked against the changed decision. */
    checkImpact(id, recordId, command) {
        this.assertOwner(command);
        const decision = this.decision(id);
        if (!(0, record_lifecycle_js_1.decisionRetired)(decision))
            throw Error('DECISION_NOT_CHANGED');
        if (!(0, collaboration_js_1.strings)(decision.data, 'affectedIds').includes(recordId))
            throw Error('NOT_AFFECTED');
        const checked = (0, collaboration_js_1.strings)(decision.data, 'checkedIds');
        // A retry of the same command recomputes the same list and replays; a new command is refused.
        if (checked.includes(recordId) &&
            !this.store.receipt((0, hash_js_1.hash)([collaboration_js_1.owner.id, this.store.project, command.idempotency_key])))
            throw Error('ALREADY_CHECKED');
        const entity = this.store.lifecyclePut('decision', id, { ...decision.data, checkedIds: [...new Set([...checked, recordId])] }, decision.audience, collaboration_js_1.owner, command);
        this.store.log(collaboration_js_1.owner, 'decision.impact.check', id, 'SUCCEEDED');
        return entity;
    }
    memory(id) {
        const memory = this.store.get(id);
        if (memory.kind !== 'memory')
            throw Error('INVALID_MEMORY');
        return memory;
    }
    /** Archive hides a memory from employees and keeps it whole; restore makes it active again. */
    archiveMemory(id, archived, reason, command) {
        this.assertOwner(command);
        if (typeof archived !== 'boolean')
            throw Error('INVALID_COMMAND');
        const memory = this.memory(id);
        if (memory.data.retention === 'DELETED')
            throw Error('MEMORY_DELETED');
        const replay = !!this.store.receipt((0, hash_js_1.hash)([collaboration_js_1.owner.id, this.store.project, command.idempotency_key]));
        if (!replay && (memory.data.retention === 'ARCHIVED') === archived)
            throw Error('NO_CHANGE');
        const { retention: _r, retentionReason: _w, ...rest } = memory.data;
        const note = archived && typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, reasonLimit) : '';
        return this.store.lifecyclePut('memory', id, archived ? { ...rest, retention: 'ARCHIVED', ...(note ? { retentionReason: note } : {}) } : rest, memory.audience, collaboration_js_1.owner, command);
    }
    /**
     * Delete leaves a tombstone: the record, its version numbers, times and the audit entry remain,
     * while title, content and links are removed from every version.
     */
    deleteMemory(id, reason, command) {
        this.assertOwner(command);
        const why = reasonOf(reason);
        const memory = this.memory(id);
        const replay = !!this.store.receipt((0, hash_js_1.hash)([collaboration_js_1.owner.id, this.store.project, command.idempotency_key]));
        if (memory.data.retention === 'DELETED' && !replay)
            throw Error('MEMORY_DELETED');
        const tombstone = {
            title: language_js_1.seedText[this.language()].deletedMemory,
            type: (0, collaboration_js_1.string)(memory.data, 'type'),
            content: '',
            sourceIds: [],
            snapshot: '[]',
            relation: '-',
            ...((0, collaboration_js_1.string)(memory.data, 'roomId') ? { roomId: memory.data.roomId } : {}),
            ...((0, collaboration_js_1.string)(memory.data, 'employeeId') ? { employeeId: memory.data.employeeId } : {}),
            retention: 'DELETED',
            retentionReason: why,
        };
        return this.store.transaction(() => {
            const entity = this.store.lifecyclePut('memory', id, tombstone, memory.audience, collaboration_js_1.owner, command);
            this.store.redactRevisions(id, entity.data);
            if (!replay)
                this.store.log(collaboration_js_1.owner, 'memory.delete', id, 'SUCCEEDED');
            return entity;
        });
    }
    /** Applies the self-note policy to one employee's notes; returns what it archived. */
    applyNotePolicy(employeeId, now = new Date()) {
        const policy = this.policy, { expired, overCap } = (0, record_lifecycle_js_1.notesToRetire)(this.store.all(), employeeId, policy, now), archived = { expired: 0, overCap: 0 };
        for (const [notes, reason, count] of [
            [expired, exports.policyReasons.expired, 'expired'],
            [overCap, exports.policyReasons.overCap, 'overCap'],
        ])
            for (const note of notes) {
                this.store.lifecyclePut('memory', note.id, { ...note.data, retention: 'ARCHIVED', retentionReason: reason }, note.audience, collaboration_js_1.owner, (0, command_js_2.createCommand)(collaboration_js_1.owner.id, this.store.project, (0, hash_js_1.hash)(['note-policy', note.id, note.version]), note.version));
                archived[count]++;
            }
        return archived;
    }
    /**
     * Index rebuild without a vector store: applies the note policy, then recounts freshness and links
     * of every memory from the records themselves.
     */
    rebuildIndex(command, freshness, now = new Date()) {
        this.assertOwner(command, 0);
        const key = (0, hash_js_1.hash)(['memory-index', this.store.project, collaboration_js_1.owner.id, command.idempotency_key]);
        return this.store.idempotent(key, (0, hash_js_1.hash)(['memory-index']), () => {
            const archived = { expired: 0, overCap: 0 };
            const employees = new Set(this.store
                .all()
                .filter((e) => e.kind === 'memory' && (0, collaboration_js_1.string)(e.data, 'employeeId'))
                .map((e) => (0, collaboration_js_1.string)(e.data, 'employeeId')));
            for (const id of employees) {
                const result = this.applyNotePolicy(id, now);
                archived.expired += result.expired;
                archived.overCap += result.overCap;
            }
            const all = this.store.all(), byId = new Map(all.map((e) => [e.id, e])), memories = all.filter((e) => e.kind === 'memory');
            const counts = {
                total: memories.length,
                active: 0,
                archived: 0,
                deleted: 0,
                current: 0,
                stale: 0,
                unlinked: 0,
                inconclusive: 0,
                /** Links to records that are gone or deleted. */
                brokenLinks: 0,
                /** Links to cancelled/superseded decisions or archived memories: worth a review. */
                retiredLinks: 0,
            };
            for (const memory of memories) {
                if (memory.data.retention === 'DELETED') {
                    counts.deleted++;
                    continue;
                }
                if ((0, record_lifecycle_js_1.memoryRetired)(memory))
                    counts.archived++;
                else
                    counts.active++;
                const status = freshness(memory);
                if (status === 'CURRENT')
                    counts.current++;
                else if (status === 'STALE')
                    counts.stale++;
                else if (status === 'UNLINKED')
                    counts.unlinked++;
                else
                    counts.inconclusive++;
                for (const ref of (0, collaboration_js_1.strings)(memory.data, 'sourceIds')) {
                    const target = byId.get(ref);
                    if (!target || target.data.retention === 'DELETED')
                        counts.brokenLinks++;
                    else if ((0, record_lifecycle_js_1.decisionRetired)(target) || (0, record_lifecycle_js_1.memoryRetired)(target))
                        counts.retiredLinks++;
                }
            }
            this.store.log(collaboration_js_1.owner, 'memory.index.rebuild', this.store.project, 'SUCCEEDED');
            return { rebuiltAt: now.toISOString(), policy: this.policy, archivedByPolicy: archived, counts };
        });
    }
}
exports.RecordLifecycle = RecordLifecycle;
//# sourceMappingURL=record-lifecycle.js.map