"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelFolder = void 0;
exports.findModelFiles = findModelFiles;
exports.fileModelId = fileModelId;
exports.syncFolderModels = syncFolderModels;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * The model folder (ADR 0050). Every .gguf file in it becomes a model employees can use, whether it
 * came from the recommended list, a pasted link, or was copied in by hand. Configured profiles keep
 * their tuned settings; other files get the default local profile's settings (context, GPU layers).
 */
exports.modelFolder = 'local-lab/models';
const maxDepth = 3;
/** .gguf files under the folder, as root-relative POSIX paths. Projector and later shard files are not models. */
function findModelFiles(root) {
    const base = (0, node_path_1.resolve)(root, exports.modelFolder);
    const found = [];
    const walk = (dir, depth) => {
        let names;
        try {
            names = (0, node_fs_1.readdirSync)(dir);
        }
        catch {
            return;
        }
        for (const name of names.sort()) {
            if (name.startsWith('.'))
                continue;
            const path = (0, node_path_1.resolve)(dir, name);
            let stat;
            try {
                stat = (0, node_fs_1.statSync)(path);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                if (depth < maxDepth)
                    walk(path, depth + 1);
            }
            else if (/\.gguf$/i.test(name) &&
                !/^mmproj/i.test(name) &&
                !/-0000[2-9]-of-|-000[1-9]\d-of-/i.test(name))
                found.push({ file: (0, node_path_1.relative)(root, path).split('\\').join('/'), bytes: stat.size });
        }
    };
    if ((0, node_fs_1.existsSync)(base))
        walk(base, 0);
    return found;
}
/** A stable id from the file name: "file:mistral-7b-instruct-v0.3-q4_k_m". */
function fileModelId(file) {
    const stem = (0, node_path_1.basename)(file).replace(/\.gguf$/i, '');
    return ('file:' +
        stem
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80));
}
/**
 * Brings config.models in line with the folder, in place (projects share the array): adds a profile
 * for each new file and drops added profiles whose file is gone. Configured profiles are never touched.
 */
function syncFolderModels(root, config, labels = {}) {
    const models = (config.models ??= [config.runtime]);
    const template = models.find((m) => (m.provider ?? 'local') === 'local' && !m.discovered) ?? config.runtime;
    const files = findModelFiles(root);
    const known = new Set(models.map((m) => m.modelFile));
    const added = [];
    for (const f of files) {
        if (known.has(f.file))
            continue;
        let id = fileModelId(f.file);
        for (let n = 2; models.some((m) => m.modelId === id); n++)
            id = fileModelId(f.file) + '-' + n;
        const profile = {
            executable: template.executable,
            modelFile: f.file,
            modelId: id,
            port: template.port,
            contextTokens: template.contextTokens,
            maxOutputTokens: template.maxOutputTokens,
            gpuLayers: template.gpuLayers,
            timeoutMs: template.timeoutMs,
            ...(template.flashAttention ? { flashAttention: true } : {}),
            ...(template.kvCacheType ? { kvCacheType: template.kvCacheType } : {}),
            // cpuMoeLayers is not copied: how many MoE layers to keep on the CPU depends on that model.
            label: labels[f.file] ?? (0, node_path_1.basename)(f.file).replace(/\.gguf$/i, ''),
            discovered: true,
        };
        models.push(profile);
        added.push(id);
    }
    const present = new Set(files.map((f) => f.file));
    const removed = [];
    for (let i = models.length - 1; i >= 0; i--)
        if (models[i].discovered && !present.has(models[i].modelFile)) {
            removed.push(models[i].modelId);
            models.splice(i, 1);
        }
    return { added, removed };
}
//# sourceMappingURL=local-models.js.map