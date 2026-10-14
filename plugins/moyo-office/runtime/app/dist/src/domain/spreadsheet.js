"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sheetLimits = void 0;
exports.validateSpreadsheet = validateSpreadsheet;
/** Bounded local snapshots. Only bundled core plugin resources are accepted. */
exports.sheetLimits = {
    chars: 260000,
    rows: 1000,
    columns: 100,
    sheets: 8,
    cells: 20000,
    cellChars: 16000,
};
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function validateSpreadsheet(content) {
    if (content.length > exports.sheetLimits.chars)
        throw Error('SHEET_LIMIT');
    let book;
    try {
        book = JSON.parse(content);
    }
    catch {
        throw Error('INVALID_SHEET');
    }
    let nodes = 0;
    function safe(value, depth = 0) {
        if (++nodes > 180000 || depth > 32)
            throw Error('SHEET_LIMIT');
        if (typeof value === 'string' && (value.length > exports.sheetLimits.cellChars || value.includes('\0')))
            throw Error('SHEET_LIMIT');
        if (typeof value === 'number' && !Number.isFinite(value))
            throw Error('INVALID_SHEET');
        if (value && typeof value === 'object')
            for (const [key, child] of Object.entries(value)) {
                if ([
                    '__proto__',
                    'prototype',
                    'constructor',
                    'backgroundImage',
                    'custom',
                    'drawings',
                    'customRender',
                ].includes(key))
                    throw Error('UNSUPPORTED_SHEET_DATA');
                safe(child, depth + 1);
            }
    }
    safe(book);
    if (!object(book) ||
        typeof book.id !== 'string' ||
        !book.id ||
        !Array.isArray(book.sheetOrder) ||
        !object(book.sheets) ||
        !object(book.styles))
        throw Error('INVALID_SHEET');
    if (book.resources !== undefined) {
        const supported = [
            'SHEET_AuthzIoMockService_PLUGIN',
            'SHEET_NUMFMT_PLUGIN',
            'SHEET_RANGE_THEME_MODEL_PLUGIN',
            'SHEET_WORKSHEET_PROTECTION_PLUGIN',
            'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN',
            'SHEET_DEFINED_NAME_PLUGIN',
            'SHEET_RANGE_PROTECTION_PLUGIN',
        ];
        if (!Array.isArray(book.resources) || book.resources.length > supported.length)
            throw Error('UNSUPPORTED_SHEET_RESOURCE');
        for (const r of book.resources) {
            if (!object(r) || !supported.includes(r.name) || typeof r.data !== 'string')
                throw Error('UNSUPPORTED_SHEET_RESOURCE');
            let parsed;
            try {
                parsed = r.data ? JSON.parse(r.data) : null;
            }
            catch {
                throw Error('INVALID_SHEET');
            }
            safe(parsed);
        }
    }
    if (book.sheetOrder.length < 1 ||
        book.sheetOrder.length > exports.sheetLimits.sheets ||
        new Set(book.sheetOrder).size !== book.sheetOrder.length ||
        Object.keys(book.sheets).length !== book.sheetOrder.length)
        throw Error('SHEET_LIMIT');
    let count = 0;
    for (const id of book.sheetOrder) {
        const s = book.sheets[id];
        if (typeof id !== 'string' ||
            !object(s) ||
            s.id !== id ||
            typeof s.name !== 'string' ||
            !s.name.trim() ||
            s.name.length > 120)
            throw Error('INVALID_SHEET');
        if (!Number.isInteger(s.rowCount) ||
            s.rowCount < 1 ||
            s.rowCount > exports.sheetLimits.rows ||
            !Number.isInteger(s.columnCount) ||
            s.columnCount < 1 ||
            s.columnCount > exports.sheetLimits.columns ||
            !object(s.cellData))
            throw Error('SHEET_LIMIT');
        if (s.mergeData !== undefined) {
            if (!Array.isArray(s.mergeData) || s.mergeData.length > 2000)
                throw Error('SHEET_LIMIT');
            for (const range of s.mergeData)
                if (!object(range) ||
                    !['startRow', 'endRow', 'startColumn', 'endColumn'].every((k) => Number.isInteger(range[k]) && range[k] >= 0) ||
                    range.startRow > range.endRow ||
                    range.startColumn > range.endColumn ||
                    range.endRow >= s.rowCount ||
                    range.endColumn >= s.columnCount)
                    throw Error('INVALID_SHEET');
        }
        for (const [key, max] of [
            ['rowData', s.rowCount],
            ['columnData', s.columnCount],
        ]) {
            if (s[key] !== undefined) {
                if (!object(s[key]) ||
                    Object.keys(s[key]).some((index) => !/^\d+$/.test(index) || Number(index) >= max))
                    throw Error('INVALID_SHEET');
            }
        }
        for (const [row, columns] of Object.entries(s.cellData)) {
            if (!/^\d+$/.test(row) || Number(row) >= s.rowCount || !object(columns))
                throw Error('INVALID_SHEET');
            for (const [col, cell] of Object.entries(columns)) {
                if (!/^\d+$/.test(col) || Number(col) >= s.columnCount || ++count > exports.sheetLimits.cells)
                    throw Error('SHEET_LIMIT');
                if (cell === null)
                    continue;
                if (!object(cell))
                    throw Error('INVALID_SHEET');
                if (cell.v !== undefined &&
                    cell.v !== null &&
                    !['string', 'number', 'boolean'].includes(typeof cell.v))
                    throw Error('INVALID_SHEET');
                if (cell.f !== undefined &&
                    cell.f !== null &&
                    (typeof cell.f !== 'string' || cell.f.length > 2000 || !cell.f.startsWith('=')))
                    throw Error('INVALID_SHEET');
            }
        }
    }
}
//# sourceMappingURL=spreadsheet.js.map