"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teamStatistics = teamStatistics;
exports.collaborationView = collaborationView;
const automation_js_1 = require("../domain/automation.js");
const employee_activity_js_1 = require("../domain/employee-activity.js");
const job_outcome_js_1 = require("../domain/job-outcome.js");
const run_usage_js_1 = require("../domain/run-usage.js");
const record_graph_js_1 = require("../domain/record-graph.js");
const collaboration_js_1 = require("../domain/collaboration.js");
const report_js_1 = require("../domain/report.js");
/** This projection never changes persisted records or grants execution permission. */
function teamStatistics(entities) {
    return entities
        .filter((e) => e.kind === 'team')
        .map((team) => {
        const employees = entities.filter((e) => e.kind === 'employee' && e.data.teamId === team.id);
        const works = entities.filter((e) => e.kind === 'work' && employees.some((employee) => employee.id === e.data.assigneeId));
        return {
            id: team.id,
            name: team.data.name,
            employees: employees.length,
            assigned: works.length,
            active: works.filter((e) => e.data.status === 'ACTIVE').length,
            blocked: works.filter((e) => e.data.status === 'BLOCKED').length,
        };
    });
}
function collaborationView(visible, recentJobs, policy) {
    const employees = visible.filter((e) => e.kind === 'employee');
    const entities = visible.map((entity) => ({
        ...entity,
        ...(entity.kind === 'memory' ? { freshness: policy.memoryStatus(entity) } : {}),
        ...(entity.kind === 'message'
            ? {
                reportText: entity.data.jobId
                    ? (0, report_js_1.briefReport)((0, collaboration_js_1.string)(entity.data, 'body'))
                    : (0, collaboration_js_1.string)(entity.data, 'body'),
            }
            : {}),
        ...(entity.kind === 'room'
            ? { participantIds: employees.filter((employee) => policy.canRead(entity, employee)).map((e) => e.id) }
            : {}),
    }));
    const jobs = recentJobs
        .filter((job) => entities.some((e) => e.id === job.roomId))
        // Usage counts in one shape for the run's detail line (ADR 0070); unknown counts stay null.
        .map((job) => ({ ...job, outcome: (0, job_outcome_js_1.jobOutcome)(job), usageTotals: (0, run_usage_js_1.runUsageTotals)(job) }));
    const works = entities.filter((e) => e.kind === 'work' && (0, automation_js_1.onBoard)(e));
    return {
        schemaVersion: 14,
        employeeActivity: (0, employee_activity_js_1.employeeActivity)(entities, jobs),
        contract: collaboration_js_1.entityContract,
        entities,
        jobs,
        planning: (0, record_graph_js_1.workPlanning)(visible, policy.canRead),
        dashboard: {
            teams: teamStatistics(entities),
            updatedAt: new Date().toISOString(),
            works: works.length,
            active: works.filter((e) => e.data.status === 'ACTIVE').length,
            decisions: entities.filter((e) => e.kind === 'decision' && e.data.status === 'PROPOSED').length,
            artifacts: entities.filter((e) => e.kind === 'artifact').length,
            employees: employees.map((e) => ({
                id: e.id,
                name: e.data.name,
                assigned: works.filter((w) => w.data.assigneeId === e.id).length,
                runs: jobs.filter((j) => j.employeeId === e.id).length,
                tokens: jobs.filter((j) => j.employeeId === e.id).reduce((sum, j) => sum + j.tokens, 0),
            })),
        },
    };
}
//# sourceMappingURL=collaboration-view.js.map