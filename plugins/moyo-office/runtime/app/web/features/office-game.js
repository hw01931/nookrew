export function gameWinner(board) {
  for (const [a, b, c] of [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ])
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? 'draw' : '';
}
export function gameMove(board, index, mark) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 8 ||
    board[index] ||
    gameWinner(board) ||
    !['X', 'O'].includes(mark)
  )
    throw Error('INVALID_MOVE');
  const next = [...board];
  next[index] = mark;
  return next;
}
/** Local opponent: no token spending, native messages or business-state changes. */
export function computerMove(board) {
  const score = (b, turn, depth) => {
    const winner = gameWinner(b);
    if (winner) return winner === 'O' ? 10 - depth : winner === 'X' ? depth - 10 : 0;
    const values = b.flatMap((v, i) =>
      v ? [] : [score(gameMove(b, i, turn), turn === 'O' ? 'X' : 'O', depth + 1)],
    );
    return turn === 'O' ? Math.max(...values) : Math.min(...values);
  };
  let best = -Infinity,
    at = -1;
  for (const i of [4, 0, 2, 6, 8, 1, 3, 5, 7])
    if (!board[i] && !gameWinner(board)) {
      const value = score(gameMove(board, i, 'O'), 'X', 0);
      if (value > best) {
        best = value;
        at = i;
      }
    }
  return at;
}
export function gamePaused(game, people) {
  return !!game?.opponent && !people.some((p) => p.id === game.opponent && p.status === 'IDLE');
}

export function memoryGame(opponent = '', random = Math.random) {
  const cards = Array.from({length: 16}, (_, i) => i % 8);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return {
    type: 'memory',
    opponent,
    cards,
    found: [],
    revealed: [],
    seen: {},
    actor: 'user',
    scores: {user: 0, computer: 0},
    attempts: 0,
    waiting: false,
  };
}
export function memoryFlip(game, index, actor = 'user') {
  if (
    game.type !== 'memory' ||
    game.waiting ||
    game.actor !== actor ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 16 ||
    game.found.includes(index) ||
    game.revealed.includes(index)
  )
    throw Error('INVALID_MOVE');
  const revealed = [...game.revealed, index];
  return {
    ...game,
    revealed,
    seen: {...game.seen, [index]: game.cards[index]},
    waiting: revealed.length === 2,
    attempts: game.attempts + (revealed.length === 2 ? 1 : 0),
  };
}
export function memoryResolve(game) {
  if (!game.waiting || game.revealed.length !== 2) return game;
  const [a, b] = game.revealed,
    match = game.cards[a] === game.cards[b];
  return {
    ...game,
    found: match ? [...game.found, a, b] : game.found,
    revealed: [],
    waiting: false,
    scores: match ? {...game.scores, [game.actor]: game.scores[game.actor] + 1} : game.scores,
    actor: match || !game.opponent ? game.actor : game.actor === 'user' ? 'computer' : 'user',
  };
}
/** Opponent remembers only previously revealed cards. Unseen values do not affect its choice. */
export function memoryChoice(game) {
  const available = Array.from({length: 16}, (_, i) => i).filter(
    (i) => !game.found.includes(i) && !game.revealed.includes(i),
  );
  if (game.revealed.length) {
    const known = game.seen[game.revealed[0]];
    const match = available.find((i) => game.seen[i] === known);
    if (match !== undefined) return match;
  } else
    for (const a of available)
      if (game.seen[a] !== undefined && available.some((b) => b !== a && game.seen[b] === game.seen[a]))
        return a;
  return available.find((i) => game.seen[i] === undefined) ?? available[0] ?? -1;
}
