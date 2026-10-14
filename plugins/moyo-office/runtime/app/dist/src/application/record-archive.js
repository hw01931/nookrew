"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.archiveLimits = void 0;
exports.exportRecords = exportRecords;
exports.inspectRecords = inspectRecords;
const hash_js_1 = require("../infrastructure/hash.js");
const sqlite_js_1 = require("../infrastructure/sqlite.js");
exports.archiveLimits = { bytes: 8 * 1024 * 1024, rows: 10000 };
/** A portable record archive. It never imports permissions, executes content or restores files. */
function exportRecords(store) {
    return (0, sqlite_js_1.transaction)(store.db, () => {
        const read = (table) => {
            const rows = store.db
                .prepare(`SELECT json FROM ${table} ORDER BY rowid LIMIT ?`)
                .all(exports.archiveLimits.rows + 1);
            if (rows.length > exports.archiveLimits.rows)
                throw Error('ARCHIVE_TOO_LARGE');
            return rows.map((row) => JSON.parse(String(row.json)));
        };
        const exists = (name) => !!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
        const payload = {
            entities: read('entities'),
            revisions: read('revisions'),
            jobs: read('jobs'),
            candidates: exists('candidates') ? read('candidates') : [],
            candidateRevisions: exists('candidate_revisions') ? read('candidate_revisions') : [],
        };
        const archive = {
            schemaVersion: 1,
            kind: 'collaboration-records',
            createdAt: new Date().toISOString(),
            payload,
            digest: (0, hash_js_1.hash)(payload),
        };
        if (Buffer.byteLength(JSON.stringify(archive)) > exports.archiveLimits.bytes)
            throw Error('ARCHIVE_TOO_LARGE');
        return archive;
    });
}
function inspectRecords(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('INVALID_ARCHIVE');
    const archive = input;
    if (archive.schemaVersion !== 1 ||
        archive.kind !== 'collaboration-records' ||
        typeof archive.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(archive.createdAt)) ||
        !archive.payload ||
        typeof archive.payload !== 'object' ||
        Array.isArray(archive.payload) ||
        typeof archive.digest !== 'string')
        throw Error('INVALID_ARCHIVE');
    const keys = ['entities', 'revisions', 'jobs', 'candidates', 'candidateRevisions'];
    if (Object.keys(archive.payload).length !== keys.length ||
        keys.some((key) => !Array.isArray(archive.payload[key]) || archive.payload[key].length > exports.archiveLimits.rows) ||
        Buffer.byteLength(JSON.stringify(archive)) > exports.archiveLimits.bytes)
        throw Error('INVALID_ARCHIVE');
    if ((0, hash_js_1.hash)(archive.payload) !== archive.digest)
        throw Error('ARCHIVE_DIGEST_MISMATCH');
    const counts = Object.fromEntries(keys.map((key) => [key, archive.payload[key].length]));
    const records = archive.payload.entities.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw Error('INVALID_ARCHIVE');
        const e = value, data = e.data;
        if (typeof e.id !== 'string' ||
            typeof e.kind !== 'string' ||
            !Number.isSafeInteger(e.version) ||
            Number(e.version) < 1 ||
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data))
            throw Error('INVALID_ARCHIVE');
        return {
            id: e.id,
            kind: e.kind,
            version: e.version,
            title: String(data.title ?? data.name ?? data.body ?? '').slice(0, 150),
            content: String(data.content ?? data.goal ?? data.body ?? '').slice(0, 12000),
        };
    });
    if (new Set(records.map((r) => r.id)).size !== records.length)
        throw Error('INVALID_ARCHIVE');
    return {
        schemaVersion: 1,
        createdAt: archive.createdAt,
        digest: archive.digest,
        counts,
        records,
        mode: 'READ_ONLY',
    };
}
//# sourceMappingURL=record-archive.js.map