"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workContext = workContext;
exports.toolRecovery = toolRecovery;
exports.normalizeToolInput = normalizeToolInput;
exports.toolCallInput = toolCallInput;
exports.describeInput = describeInput;
exports.toolResultContext = toolResultContext;
exports.toolContinuation = toolContinuation;
exports.compactHistory = compactHistory;
const collaboration_tools_js_1 = require("./collaboration-tools.js");
const text_edit_js_1 = require("../domain/text-edit.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const record_lifecycle_js_1 = require("../domain/record-lifecycle.js");
const model_routing_js_1 = require("../domain/model-routing.js");
/** Input must already be filtered for the employee and the destination audience. */
function workContext(request, target, visible, roomId, directory = visible.filter((e) => e.kind === 'employee'), 
/** Handoff summaries of predecessor works, built by code from records (ADR 0053). */
handoffs = {}) {
    const refs = [];
    const compact = (entity, maximum = 700) => {
        const excerpt = (0, collaboration_js_1.string)(entity.data, 'goal') ||
            (0, collaboration_js_1.string)(entity.data, 'content') ||
            (0, collaboration_js_1.string)(entity.data, 'body') ||
            (0, collaboration_js_1.string)(entity.data, 'agenda');
        return {
            id: entity.id,
            version: entity.version,
            kind: entity.kind,
            title: (0, collaboration_js_1.string)(entity.data, 'title') || (0, collaboration_js_1.string)(entity.data, 'name'),
            status: (0, collaboration_js_1.string)(entity.data, 'status'),
            excerpt: excerpt.slice(0, maximum),
            truncated: excerpt.length > maximum,
            ...(handoffs[entity.id] ? { handoff: handoffs[entity.id] } : {}),
        };
    };
    const context = {
        request,
        target: target ? compact(target, 2000) : null,
        records: [],
        /** `lock`: the employee's pin (ADR 0072), so a planner assigns work to the employee whose pin fits. */
        employees: [],
        history: [],
        omitted: { records: 0, employees: 0, history: 0 },
    };
    if (target)
        refs.push({ id: target.id, version: target.version });
    const fits = () => JSON.stringify(context).length <= collaboration_js_1.collaborationLimits.contextChars;
    if (!fits())
        throw Error('CONTEXT_LIMIT');
    const related = new Set(target
        ? [
            ...(0, collaboration_js_1.strings)(target.data, 'artifactIds'),
            ...(0, collaboration_js_1.strings)(target.data, 'dependencies'),
            ...(0, collaboration_js_1.strings)(target.data, 'sourceIds'),
            ...(0, collaboration_js_1.strings)(target.data, 'links'),
            (0, collaboration_js_1.string)(target.data, 'workId'),
            (0, collaboration_js_1.string)(target.data, 'replyTo'),
        ]
        : []);
    const records = visible.filter((e) => (['work', 'artifact', 'decision', 'memory', 'meeting'].includes(e.kind) ||
        (e.kind === 'message' && related.has(e.id))) &&
        // Cancelled/superseded decisions and archived memories are not told as current (ADR 0067);
        // one the target itself cites still appears, with its status and replacement.
        ((0, record_lifecycle_js_1.currentRecord)(e) || (related.has(e.id) && e.data.retention !== 'DELETED')) &&
        e.id !== target?.id &&
        (e.data.roomId === roomId || related.has(e.id) || (e.data.workId === target?.id && !!target)));
    records.sort((a, b) => Number(related.has(b.id)) - Number(related.has(a.id)) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id));
    // Reserve counters before filling so the final serialization cannot overflow at a digit boundary.
    context.omitted = {
        records: records.length,
        employees: directory.length,
        history: visible.filter((e) => e.kind === 'message' && e.data.roomId === roomId).length,
    };
    for (const employee of directory.slice(0, 24)) {
        const lock = (0, model_routing_js_1.employeeLock)(employee.data);
        context.employees.push({
            id: employee.id,
            role: (0, collaboration_js_1.string)(employee.data, 'role'),
            ...(lock ? { lock: (0, model_routing_js_1.formatLock)(lock) } : {}),
        });
        if (!fits()) {
            context.employees.pop();
            continue;
        }
        context.omitted.employees--;
        refs.push({ id: employee.id, version: employee.version });
    }
    for (const entity of records) {
        // A room is not a task boundary. Unrelated old drafts can dominate a small model's
        // current instructions; keep explicit links, this work's results and project memory.
        // Omitted records remain discoverable with record.search/read, never hidden by policy.
        if (target?.kind === 'work' &&
            !related.has(entity.id) &&
            entity.data.workId !== target.id &&
            !['decision', 'memory'].includes(entity.kind))
            continue;
        context.records.push(compact(entity));
        if (!fits()) {
            context.records.pop();
            continue;
        }
        context.omitted.records--;
        refs.push({ id: entity.id, version: entity.version });
    }
    for (const message of visible
        .filter((e) => e.kind === 'message' &&
        e.data.roomId === roomId &&
        (target?.kind !== 'work' ||
            (0, collaboration_js_1.strings)(e.data, 'sourceIds').includes(target.id) ||
            (0, collaboration_js_1.strings)(e.data, 'links').some((id) => related.has(id))))
        .slice(-8)
        .reverse()) {
        const body = (0, collaboration_js_1.string)(message.data, 'body');
        context.history.unshift({
            id: message.id,
            actor: message.actor,
            text: body.slice(0, 300),
            truncated: body.length > 300,
        });
        if (!fits()) {
            context.history.shift();
            continue;
        }
        context.omitted.history--;
        refs.push({ id: message.id, version: message.version });
    }
    return { content: JSON.stringify(context), refs };
}
function toolRecovery(error, tool = '') {
    const hints = {
        DESIGN_REQUIRES_STATIC_HTML: 'design은 정적 시안입니다. script와 이벤트 속성(onclick 등), javascript URL, iframe/object/embed를 제거하고 HTML/CSS만 다시 제출하세요. 실제 동작 구현은 code 산출물과 개발 업무로 분리하세요.',
        ENTITY_NOT_FOUND: '존재하지 않는 ID입니다. 문맥 records 또는 성공한 도구 결과에서 확인한 ID만 사용하세요. 선택 참조를 확인하지 못하면 생략하세요. 이미 저장한 결과를 중복 생성하지 마세요.',
        INVALID_REFERENCE: 'ID의 기록 종류가 맞지 않습니다. workId에는 실제 work ID, assigneeId에는 employee ID만 쓰세요.',
        INVALID_FIELD: `도구 설명의 필드와 허용 값을 확인하세요.${{
            'artifact.write': ` type은 ${collaboration_js_1.entityOptions.artifact?.type?.join('/')} 중 하나입니다.`,
            'memory.write': ` type은 ${collaboration_js_1.entityOptions.memory?.type?.join('/')} 중 하나입니다.`,
            'work.write': ` priority는 ${collaboration_js_1.entityOptions.work?.priority?.join('/')} 중 하나입니다.`,
        }[tool] ?? ''}`,
        INVALID_DATE: '날짜는 실제 달력 날짜 YYYY-MM-DD로 입력하세요. 모르면 선택 날짜를 생략하세요.',
        INVALID_DATE_RANGE: '시작일 이후의 마감일을 입력하세요.',
        TOOL_DENIED: '이 도구는 허용되지 않았습니다. 권한을 우회하거나 다른 도구로 대신 실행하지 말고 제한을 보고하세요.',
        SOURCE_CHANGED: '원본이 변경되었습니다. project.read로 최신 내용을 읽고 수정안을 다시 구성하세요. 이전 hash를 재사용하지 마세요.',
        SOURCE_AUDIENCE_CONFLICT: '연결 기록을 현재 대화방에 공유할 수 없습니다. 원문을 복사해 우회하지 말고 제한을 보고하세요.',
        INVALID_TOOL_INPUT: `input은 JSON 객체여야 합니다. ${tool} 형식: ${collaboration_tools_js_1.toolDescriptions[tool] ?? '도구 설명을 확인하세요.'}`,
        EDIT_NOT_FOUND: 'old 문자열이 파일에 없습니다. project.read로 현재 내용을 다시 읽고, 줄 번호와 탭을 뺀 원문을 그대로 old에 넣으세요.',
        EDIT_AMBIGUOUS: 'old 문자열이 여러 곳에 있습니다. 앞뒤 줄을 더 포함해 한 곳만 맞도록 하거나 replaceAll:true를 쓰세요.',
        EDIT_NO_OP: 'old와 new가 같습니다. 바꿀 내용을 확인하세요.',
        WEB_ADDRESS_BLOCKED: '내부망·이 PC 주소는 읽을 수 없습니다. 공개 인터넷 주소만 쓰세요.',
        WEB_HTTP_ERROR: '페이지를 받지 못했습니다(detail의 HTTP 상태). 주소를 바꾸거나 web.search로 다른 출처를 찾으세요.',
        WEB_CONTENT_UNSUPPORTED: '글자로 읽을 수 없는 형식(PDF·이미지 등)입니다. 다른 출처를 찾으세요.',
        WEB_SEARCH_OFF: '웹 검색이 꺼져 있습니다. 검색 없이 진행하거나 제한을 보고하세요.',
        WEB_UNAVAILABLE: '이 환경에서는 웹 도구를 쓸 수 없습니다. 제한을 보고하세요.',
        ELIDED_CONTENT: '⟦생략 N자⟧는 이전 단계를 줄여 보여 준 표시일 뿐 실제 내용이 아닙니다. 파일 전체 내용을 다시 쓰거나 change.edit로 필요한 부분만 바꾸세요.',
        CANDIDATE_NOT_FOUND: 'change.read는 이미 제출된 수정안 ID로만 읽습니다. 작성 중인 파일과 검증 기준(tests/acceptance.test.cjs)은 project.read로 읽으세요.',
        NO_DRAFT: '제출할 편집이 없습니다. change.write 또는 change.edit로 먼저 파일을 작성하세요.',
        NO_CHANGE_FROM_BASE: '불러온 이전 수정안과 똑같아서 제출하지 않았습니다. 같은 검증 실패가 반복됩니다. 실패 기록의 원인을 먼저 고치세요.',
        NOT_IN_DRAFT: '이 파일은 디스크에 없고 지금 편집본에도 없습니다(제출하면 편집본이 비워집니다). 고치려면 change.write로 파일 전체를 다시 쓰세요.',
        DRAFT_SYNTAX_ERROR: '편집본의 JavaScript 문법 오류 때문에 제출하지 않았습니다. detail의 파일과 줄을 project.read로 읽고 괄호·따옴표 짝을 맞춘 뒤 다시 제출하세요.',
        NO_CHANGE: '원본과 같은 내용입니다. 실제로 바뀌는 내용만 작성하세요.',
        FILE_DELETED_IN_DRAFT: '이번 실행에서 삭제한 파일입니다. 다시 만들려면 change.write를 쓰세요.',
        PATH_DENIED: '허용되지 않은 경로입니다. project.list에 나온 경로나 src/·web/ 아래 새 경로만 쓰세요.',
        PATH_NOT_TRACKED: '프로젝트 범위 밖의 파일입니다. project.list에 나온 파일만 읽을 수 있습니다.',
        PROTECTED_CHANGE: '이 경로나 파일 형식은 수정할 수 없습니다. src/ 또는 web/ 아래 텍스트 파일만 수정하세요.',
        CANDIDATE_TOO_LARGE: `파일이 너무 큽니다(${text_edit_js_1.textEditLimits.contentCharacters.toLocaleString('en-US')}자 한도). 파일을 나누거나 change.edit로 필요한 부분만 바꾸세요.`,
        INVALID_PAGE: 'offset이 파일 길이를 넘었습니다. 이전 결과의 totalLines와 next를 확인하세요.',
        CHECK_UNAVAILABLE: '검사 환경을 사용할 수 없습니다. 검사 없이 진행한다고 보고에 적으세요.',
        ROUTE_LOCKED: '담당자의 모델이 고정되어 있습니다(detail과 employees의 lock 참고). routeTarget·routeEffort를 빼거나, lock이 원하는 모델과 같은 직원에게 배정하세요. 고정을 우회하지 마세요.',
        ROUTE_PAID_OWNER_ONLY: '유료 모델은 사용자만 직접 고를 수 있습니다. routeTarget을 빼거나 detail의 사용 가능한 대상 중에서 고르세요.',
        ROUTE_TARGET_UNKNOWN: '지금 쓸 수 없는 대상입니다. routeTarget을 빼거나 detail의 사용 가능한 대상 중에서 고르세요.',
    };
    return (hints[error] ??
        '성공으로 보고하지 마세요. 이미 저장된 결과는 유지하고 실패 이유를 확인한 뒤 허용된 도구로만 수정하세요.');
}
/** Small models often send tool input as a JSON string; accept it only when it is an object. */
function normalizeToolInput(input) {
    let value = input;
    if (typeof value === 'string')
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                value = parsed;
        }
        catch {
            return input;
        }
    // "./src/a.js" is the same project path; anything else (absolute, "..") is left for path checks.
    if (value && typeof value === 'object' && typeof value.path === 'string') {
        const path = value.path;
        if (path.startsWith('./'))
            return { ...value, path: path.slice(2) };
    }
    return value;
}
/** Input of one model tool call. Small models sometimes put arguments beside `name` without `input`. */
function toolCallInput(call) {
    if ('input' in call)
        return normalizeToolInput(call.input);
    const { name: _name, ...rest } = call;
    return normalizeToolInput(rest);
}
/** Shape of what the model sent, for failure records; never the content itself. */
function describeInput(input) {
    if (input === null)
        return 'null';
    if (Array.isArray(input))
        return `array(${input.length})`;
    if (typeof input === 'object') {
        const path = input.path;
        return `object{${Object.keys(input).slice(0, 12).join(',')}}${typeof path === 'string' ? ' path=' + path.slice(0, 160) : ''}`;
    }
    if (typeof input === 'string')
        return `string(${input.length})`;
    return typeof input;
}
/** Full results stay in the job record; only the model-facing copy is bounded. */
function toolResultContext(results, limit = 6000, entryLimit = 2000) {
    const payload = { results: [], omitted: results.length };
    for (const entry of results) {
        let next = entry;
        if (JSON.stringify(entry).length > entryLimit) {
            const result = entry.result;
            next = {
                name: entry.name,
                ...(entry.error ? { error: entry.error, recovery: entry.recovery } : {}),
                result: {
                    id: result?.id,
                    kind: result?.kind,
                    version: result?.version,
                    path: result?.path,
                    hash: result?.hash,
                    preview: JSON.stringify(entry.result ?? null).slice(0, Math.max(1200, entryLimit - 400)),
                    truncated: true,
                },
            };
        }
        payload.results.push(next);
        if (JSON.stringify(payload).length > limit) {
            payload.results.pop();
            continue;
        }
        payload.omitted--;
    }
    return JSON.stringify(payload);
}
/** Long strings in a replayed call are cut so file bodies are not resent every round. */
function elide(value, depth = 0) {
    if (typeof value === 'string')
        return value.length > 160 ? value.slice(0, 80) + (0, text_edit_js_1.elisionMark)(value.length) : value;
    if (depth > 3 || value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.slice(0, 20).map((v) => elide(v, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, elide(v, depth + 1)]));
}
/**
 * Replays the model's own previous calls in the same {name,input} shape it must emit, with long
 * strings elided, then the real results; a status-only summary gets copied back as tool input.
 * Full output stays in job.results, so the continuation carries only identities and excerpts.
 */
function toolContinuation(text, results, resultChars = 2600, calls = []) {
    const replay = (calls.length ? calls : results).map((call) => ({
        name: call.name,
        input: elide('input' in call ? call.input : {}),
    }));
    return [
        {
            role: 'assistant',
            content: JSON.stringify({ text: typeof text === 'string' ? text.slice(0, 240) : '', tools: replay }),
        },
        {
            role: 'user',
            content: '실제 도구 결과(요청 순서대로): ' +
                toolResultContext(results, resultChars, Math.max(2000, resultChars)) +
                '. 저장된 결과를 중복 생성하지 마세요. 추가 작업이 없으면 text 한두 문장과 tools:[]로 종료하세요.',
        },
    ];
}
const omittedResult = '(이전 도구 결과는 문맥 한도로 생략했습니다. 원문은 실행 기록에 있습니다. 필요하면 다시 읽으세요.)';
/**
 * Keeps the system prompt, the task and the newest exchange whole. Older tool results are replaced
 * by a marker, newest first kept, until the history fits `budgetChars`. Roles and order never change.
 */
function compactHistory(messages, budgetChars) {
    const size = (list) => list.reduce((sum, m) => sum + m.content.length, 0);
    const out = messages.map((m) => ({ ...m }));
    for (let i = 3; i < out.length - 2 && size(out) > budgetChars; i += 2)
        if (out[i].role === 'user')
            out[i].content = omittedResult;
    return out;
}
//# sourceMappingURL=work-context.js.map