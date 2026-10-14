"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientErrorCode = clientErrorCode;
exports.officeCommand = officeCommand;
const node_vm_1 = require("node:vm");
const collaboration_tools_js_1 = require("../application/collaboration-tools.js");
const collaboration_js_1 = require("../domain/collaboration.js");
/**
 * What a failed request tells the client: a plain business code, optionally naming where it applies
 * (`WORKFLOW_CYCLE:a->b`, ADR 0068) with validated ids only. Anything else is a generic code.
 */
function clientErrorCode(message) {
    return /^[A-Z_]+(:[A-Za-z0-9_.>-]{1,80})?$/.test(message) ? message : 'REQUEST_FAILED';
}
/** HTTP transport validates host/origin/CSRF before dispatching owner commands here. */
function officeCommand(input, command, office, changes, track) {
    if (input.action === 'change-review')
        return {
            status: 200,
            value: changes.review(String(input.id), String(input.candidateHash), input.data, command),
        };
    if (input.action === 'model-routes-set')
        return { status: 200, value: office.routes.set(input.data, command) };
    if (input.action === 'automation-set')
        return { status: 200, value: changes.setAutomation(input.data, command) };
    if (input.action === 'work-triage')
        return { status: 200, value: changes.triage(String(input.id), input.decision, command) };
    if (input.action === 'change-review-resolve')
        return {
            status: 200,
            value: changes.resolveReview(String(input.id), String(input.reviewId), input.resolved, command),
        };
    if (input.action === 'propose') {
        const room = office.store.read(String(input.roomId), collaboration_js_1.owner);
        if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))
            throw Error('INVALID_CHANGE_SET');
        return { status: 200, value: changes.propose(input.data, collaboration_js_1.owner, room, undefined, command) };
    }
    if (input.action === 'checks-register') {
        // The owner turns a reviewed `checks` artifact into the project's acceptance check.
        const artifact = office.store.read(String(input.id), collaboration_js_1.owner);
        if (artifact.kind !== 'artifact' || artifact.data.type !== 'checks')
            throw Error('INVALID_ARTIFACT');
        if (artifact.version !== Number(input.artifactVersion))
            throw Error('VERSION_CONFLICT');
        const source = (0, collaboration_js_1.string)(artifact.data, 'content');
        // The check runs as tests/acceptance.test.cjs, so it must parse as CommonJS (no import/export).
        try {
            new node_vm_1.Script(`(function (require, module, exports) {
${source}
})`);
        }
        catch {
            throw Error('INVALID_CHECKS_SYNTAX');
        }
        // It must actually use node:test; a check that calls an undefined runner always crashes.
        if (!/require\(\s*['"]node:test['"]\s*\)/.test(source) || !/\btest\s*\(/.test(source))
            throw Error('INVALID_CHECKS_RUNNER');
        return {
            status: 200,
            value: changes.setChecks(source, changes.checks().version, command.idempotency_key),
        };
    }
    if (input.action === 'rules-update')
        return {
            status: 200,
            value: changes.setRules(String(input.content ?? ''), input.checks, Number(input.version), command.idempotency_key),
        };
    if (input.action === 'rules-register') {
        // An employee's rules draft becomes the project rules only by the owner's command.
        const artifact = office.store.read(String(input.id), collaboration_js_1.owner);
        if (artifact.kind !== 'artifact' || artifact.data.type !== 'rules')
            throw Error('INVALID_ARTIFACT');
        if (artifact.version !== Number(input.artifactVersion))
            throw Error('VERSION_CONFLICT');
        const current = changes.rules();
        return {
            status: 200,
            value: changes.setRules((0, collaboration_js_1.string)(artifact.data, 'content'), current.checks, current.version, command.idempotency_key),
        };
    }
    if (input.action === 'checks-update') {
        return {
            status: 200,
            value: changes.setChecks(input.content, Number(input.version), command.idempotency_key),
        };
    }
    if (input.action === 'put') {
        if (!collaboration_js_1.collaborationKinds.includes(input.kind) ||
            (input.id !== null && typeof input.id !== 'string'))
            throw Error('INVALID_ENTITY');
        if (input.kind === 'employee' &&
            (!Array.isArray(input.data?.tools) ||
                (0, collaboration_js_1.strings)(input.data, 'tools').some((name) => !(name in collaboration_tools_js_1.toolDescriptions))))
            throw Error('UNKNOWN_TOOL');
        return {
            status: 200,
            value: office.put(input.kind, input.id, input.data, input.audience, collaboration_js_1.owner, command),
        };
    }
    // Decision changes and memory retention (ADR 0067): owner commands with their own handlers.
    if (input.action === 'decision-change')
        return { status: 200, value: office.lifecycle.changeDecision(String(input.id), input, command) };
    if (input.action === 'decision-impact-check')
        return {
            status: 200,
            value: office.lifecycle.checkImpact(String(input.id), String(input.recordId), command),
        };
    if (input.action === 'memory-archive')
        return {
            status: 200,
            value: office.lifecycle.archiveMemory(String(input.id), input.archived, input.reason, command),
        };
    if (input.action === 'memory-delete')
        return { status: 200, value: office.lifecycle.deleteMemory(String(input.id), input.reason, command) };
    if (input.action === 'memory-index-rebuild')
        return {
            status: 200,
            value: office.lifecycle.rebuildIndex(command, (memory) => office.memoryStatus(memory)),
        };
    if (input.action === 'attention-seen') {
        return { status: 200, value: office.markAttention(String(input.id), command) };
    }
    if (input.action === 'chat-abandon') {
        return {
            status: 200,
            value: office.abandonChat(String(input.roomId), String(input.employeeId ?? ''), String(input.messageKey), String(input.jobKey ?? ''), command),
        };
    }
    if (input.action === 'employee-handover')
        return {
            status: 200,
            value: office.handover.execute(String(input.id), String(input.targetId), String(input.snapshotHash), command),
        };
    if (input.action === 'workflow-start')
        return {
            status: 202,
            value: office.workflows.start(String(input.id), String(input.snapshotHash), Number(input.tokenLimit), command),
        };
    if (['workflow-pause', 'workflow-resume', 'workflow-cancel', 'workflow-retry'].includes(String(input.action)))
        return {
            status: 200,
            value: office.workflows.control(String(input.id), String(input.action).slice(9), String(input.nodeId ?? ''), command),
        };
    if (input.action === 'graph-start')
        return { status: 202, value: office.graphs.start(input.definition, Number(input.tokenLimit), command) };
    if (['graph-pause', 'graph-resume', 'graph-cancel', 'graph-retry'].includes(String(input.action)))
        return {
            status: 200,
            value: office.graphs.control(String(input.id), String(input.action).slice(6), String(input.stepKey ?? ''), command),
        };
    if (input.action === 'routine-put')
        return { status: 200, value: office.routines.put(input.id || null, input.data, command) };
    if (input.action === 'routine-delete')
        return { status: 200, value: office.routines.remove(String(input.id), command) };
    if (input.action === 'routine-run')
        return { status: 202, value: office.routines.runNow(String(input.id), command) };
    if (input.action === 'engine-consent')
        return { status: 200, value: office.grantEngineConsent(String(input.engineId ?? ''), command) };
    if (input.action === 'engine-revoke')
        return { status: 200, value: office.revokeEngineConsent(String(input.engineId ?? ''), command) };
    if (input.action === 'engine-route')
        return { status: 200, value: office.setDevelopEngine(String(input.engineId ?? ''), command) };
    if (input.action === 'work-start') {
        return { status: 202, value: office.startWork(String(input.id), command) };
    }
    if (input.action === 'work-request-abandon') {
        return {
            status: 200,
            value: office.abandonWorkRequest(String(input.id), String(input.requestKey), command),
        };
    }
    if (input.action === 'room-read') {
        return {
            status: 200,
            value: office.store.markRead(String(input.roomId), String(input.messageId), collaboration_js_1.owner, command),
        };
    }
    if (input.action === 'start') {
        if (input.targetId && office.store.get(String(input.targetId)).kind === 'work')
            throw Error('WORK_COMMAND_REQUIRED');
        return {
            status: 202,
            value: office.start(String(input.roomId), String(input.employeeId), String(input.prompt ?? ''), String(input.mode ?? 'chat'), String(input.targetId ?? ''), command.idempotency_key, undefined, input.baseCandidateId ? { baseCandidateId: String(input.baseCandidateId) } : {}),
        };
    }
    if (input.action === 'cancel') {
        return { status: 200, value: office.cancel(String(input.id), Number(input.version)) };
    }
    if (input.action === 'meeting') {
        const meeting = office.store.get(String(input.id));
        if (meeting.kind !== 'meeting' || meeting.version !== input.version)
            throw Error('VERSION_CONFLICT');
        const runs = (0, collaboration_js_1.strings)(meeting.data, 'participants').map((id) => office.start((0, collaboration_js_1.string)(meeting.data, 'roomId'), id, '회의 안건: ' +
            (0, collaboration_js_1.string)(meeting.data, 'agenda') +
            '\n다른 발언을 참고해 자신의 역할에서 검토하고 구체적인 제안·미결정·후속 업무를 남기세요.', 'meeting', meeting.id, command.idempotency_key + ':' + id));
        return { status: 202, value: runs };
    }
    if (input.action === 'client-create') {
        return { status: 200, value: office.createClient(String(input.name ?? '')) };
    }
    if (input.action === 'client-revoke') {
        office.revokeClient(String(input.id));
        return { status: 200, value: { revoked: true } };
    }
    if (input.action === 'verify') {
        const job = changes.verify(String(input.id), Number(input.version));
        track(job);
        return { status: 202, value: changes.get(String(input.id)) };
    }
    if (input.action === 'approve') {
        return { status: 200, value: changes.approve(String(input.id), Number(input.version)) };
    }
    if (input.action === 'rebase') {
        return { status: 200, value: changes.rebase(String(input.id), Number(input.version)) };
    }
    if (input.action === 'verify-cancel') {
        return { status: 202, value: changes.cancel(String(input.id), Number(input.version)) };
    }
    if (input.action === 'apply') {
        return { status: 200, value: changes.apply(String(input.id), Number(input.version)) };
    }
    throw Error('UNKNOWN_ACTION');
}
//# sourceMappingURL=office-http.js.map