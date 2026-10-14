// Preserve terminators: CRLF changes and the final newline are real differences.
const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const MAX_CELLS = 250000;
export function lineDiff(before, after) {
  const a = lines(before ?? ''),
    b = lines(after ?? '');
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end])
    end++;
  const x = a.slice(start, a.length - end),
    y = b.slice(start, b.length - end),
    ops = [];
  const add = (kind, text) => ops.push({kind, text});
  a.slice(0, start).forEach((t) => add('same', t));
  const coarse = (x.length + 1) * (y.length + 1) > MAX_CELLS;
  if (coarse) {
    x.forEach((t) => add('remove', t));
    y.forEach((t) => add('add', t));
  } else {
    const width = y.length + 1,
      table = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        table[i * width + j] =
          x[i] === y[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        add('same', x[i++]);
        j++;
      } else if (i < x.length && (j === y.length || table[(i + 1) * width + j] >= table[i * width + j + 1]))
        add('remove', x[i++]);
      else add('add', y[j++]);
    }
  }
  a.slice(a.length - end).forEach((t) => add('same', t));
  let old = 0,
    next = 0,
    added = 0,
    removed = 0;
  const rows = ops.map((row) => {
    if (row.kind === 'add') added++;
    if (row.kind === 'remove') removed++;
    return {...row, old: row.kind === 'add' ? null : ++old, next: row.kind === 'remove' ? null : ++next};
  });
  return {rows, added, removed, coarse};
}
