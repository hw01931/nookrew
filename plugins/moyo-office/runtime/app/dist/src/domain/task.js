"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeRelativePath = safeRelativePath;
exports.pathMatches = pathMatches;
exports.canChange = canChange;
exports.semanticIssues = semanticIssues;
exports.readinessIssues = readinessIssues;
// v0 supports literal paths and a terminal /** only. Reject ambiguous Windows paths.
function safeRelativePath(value, allowGlob = false) {
    const path = allowGlob && value.endsWith('/**') ? value.slice(0, -3) : value;
    if (!path || /[\\:*?"<>|\x00-\x1f]/.test(path) || path.startsWith('/'))
        return false;
    return path
        .split('/')
        .every((part) => part !== '' &&
        part !== '.' &&
        part !== '..' &&
        !/[. ]$/.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function pathMatches(path, pattern) {
    const p = path.toLowerCase();
    const scope = pattern.toLowerCase();
    return scope.endsWith('/**') ? p.startsWith(scope.slice(0, -2)) : p === scope;
}
function canChange(task, path) {
    return (safeRelativePath(path) &&
        task.allowed_scope.some((scope) => pathMatches(path, scope)) &&
        !task.forbidden_scope.some((scope) => pathMatches(path, scope)));
}
function semanticIssues(task) {
    const issues = [];
    const issue = (path, code, message) => issues.push({ path, code, message });
    for (const name of ['allowed_scope', 'forbidden_scope']) {
        task[name].forEach((scope, i) => {
            if (!safeRelativePath(scope, true))
                issue(`/${name}/${i}`, 'UNSAFE_SCOPE', '상대 경로 또는 끝이 /**인 범위만 허용합니다.');
        });
    }
    const ids = new Set();
    task.acceptance_criteria.forEach((criterion, i) => {
        if (ids.has(criterion.id))
            issue(`/acceptance_criteria/${i}/id`, 'DUPLICATE_ID', '수락 조건 ID가 중복됩니다.');
        ids.add(criterion.id);
    });
    const checks = new Set();
    const covered = new Set();
    task.verification.forEach((check, i) => {
        if (checks.has(check.check_id))
            issue(`/verification/${i}/check_id`, 'DUPLICATE_ID', '검사 ID가 중복됩니다.');
        checks.add(check.check_id);
        check.criterion_ids.forEach((id, j) => {
            if (!ids.has(id))
                issue(`/verification/${i}/criterion_ids/${j}`, 'UNKNOWN_CRITERION', '존재하지 않는 수락 조건입니다.');
            if (check.required)
                covered.add(id);
        });
    });
    task.acceptance_criteria.forEach((criterion, i) => {
        if (!covered.has(criterion.id))
            issue(`/acceptance_criteria/${i}`, 'UNCOVERED_CRITERION', '필수 검사와 연결해야 합니다.');
    });
    return issues;
}
function readinessIssues(task, registry) {
    const issues = [];
    const repo = Object.hasOwn(registry, task.repository.reference)
        ? registry[task.repository.reference]
        : undefined;
    if (!repo)
        return [
            {
                path: '/repository/reference',
                code: 'UNREGISTERED_REPOSITORY',
                message: '등록되지 않은 저장소입니다.',
            },
        ];
    if (repo.snapshot !== task.repository.base_snapshot)
        issues.push({
            path: '/repository/base_snapshot',
            code: 'UNSUPPORTED_SNAPSHOT',
            message: '등록된 기준 snapshot과 다릅니다.',
        });
    task.verification.forEach((check, i) => {
        if (!Object.hasOwn(repo.checks, check.check_id) || repo.checks[check.check_id] !== check.kind) {
            issues.push({
                path: `/verification/${i}`,
                code: 'UNREGISTERED_CHECK',
                message: '등록된 검사 ID와 종류를 사용해야 합니다.',
            });
        }
    });
    for (const id of repo.required_checks) {
        if (!task.verification.some((check) => check.check_id === id && check.required)) {
            issues.push({
                path: '/verification',
                code: 'REQUIRED_CHECK_MISSING',
                message: '저장소의 필수 검사를 삭제하거나 선택 검사로 바꿀 수 없습니다.',
            });
        }
    }
    if (task.delivery !== 'patch')
        issues.push({
            path: '/delivery',
            code: 'UNSUPPORTED_DELIVERY',
            message: '현재 실행기는 patch 산출물만 지원합니다.',
        });
    return issues;
}
//# sourceMappingURL=task.js.map