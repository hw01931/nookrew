"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectRoot = void 0;
exports.validateTask = validateTask;
exports.readTask = readTask;
const _2020_js_1 = __importDefault(require("ajv/dist/2020.js"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const task_js_1 = require("../domain/task.js");
exports.projectRoot = (0, node_path_1.resolve)(__dirname, '../../..');
const schema = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(exports.projectRoot, 'experiments/task-schema.yaml'), 'utf8'));
const validateSchema = new _2020_js_1.default({ allErrors: true, strict: true }).compile(schema);
function validateTask(input, registry = {}) {
    if (!validateSchema(input)) {
        return {
            schema_version: '0.1',
            schema_valid: false,
            contract_valid: false,
            execution_ready: false,
            errors: (validateSchema.errors ?? []).map((error) => ({
                path: error.instancePath || '/',
                code: `SCHEMA_${error.keyword.toUpperCase()}`,
                message: error.message ?? 'Schema mismatch',
            })),
            readiness_errors: [],
        };
    }
    const errors = (0, task_js_1.semanticIssues)(input);
    const readiness = errors.length ? [] : (0, task_js_1.readinessIssues)(input, registry);
    return {
        schema_version: '0.1',
        schema_valid: true,
        contract_valid: errors.length === 0,
        execution_ready: errors.length === 0 && readiness.length === 0,
        errors,
        readiness_errors: readiness,
    };
}
function readTask(path) {
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8'));
    }
    catch {
        throw new Error('TASK_READ_ERROR: 파일을 읽을 수 없거나 JSON 형식이 아닙니다.');
    }
}
//# sourceMappingURL=validation.js.map