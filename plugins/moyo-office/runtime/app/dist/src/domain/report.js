"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportLimit = void 0;
exports.briefReport = briefReport;
exports.reportLimit = 240;
/** Presentation limit, not a model summary: keep the original in its attachment. */
function briefReport(text) {
    const sentences = [...new Intl.Segmenter('ko', { granularity: 'sentence' }).segment(text.trim())]
        .slice(0, 2)
        .map((s) => s.segment.trim())
        .join(' ');
    return sentences.length > exports.reportLimit ? sentences.slice(0, exports.reportLimit - 1).trimEnd() + '…' : sentences;
}
//# sourceMappingURL=report.js.map