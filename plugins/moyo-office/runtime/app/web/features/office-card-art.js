/** Original code-native illustrations; game pieces do not depend on remote assets. */
export function officeCardArt(id) {
  const shapes = [
    '<path d="M18 25h27v16a9 9 0 0 1-9 9h-9a9 9 0 0 1-9-9z" fill="#ddb792"/><path d="M45 29h4a7 7 0 0 1 0 14h-4"/><path d="M24 19v-5m9 5v-7m8 7v-5"/>',
    '<path d="M23 43h20l-3 13H26z" fill="#d8b7a0"/><path d="M33 44V19"/><ellipse cx="24" cy="25" rx="8" ry="13" fill="#99b99d" transform="rotate(-30 24 25)"/><ellipse cx="41" cy="28" rx="8" ry="14" fill="#739b80" transform="rotate(30 41 28)"/>',
    '<rect x="11" y="16" width="43" height="29" rx="4" fill="#b4d1d1"/><path d="M26 45v7h13v-7m-19 8h26"/><path d="m27 25-5 5 5 5m10-10 5 5-5 5"/>',
    '<path d="M13 16h29l8 6v32H20l-7-7z" fill="#bccbb8"/><path d="M20 22h30M20 22v32M28 32h14m-14 7h14m-14 7h9"/>',
    '<path d="M16 35v-5a16 16 0 0 1 32 0v5"/><rect x="12" y="31" width="10" height="19" rx="5" fill="#c8b5cb"/><rect x="42" y="31" width="10" height="19" rx="5" fill="#c8b5cb"/>',
    '<circle cx="32" cy="34" r="21" fill="#e4c099"/><circle cx="32" cy="32" r="16" fill="#dfb5b9"/><circle cx="32" cy="32" r="6" fill="#faf6ec"/><path d="m20 27 3 2m20 5-4 1m-11 9 1-3m5-19-1 3"/>',
    '<path d="M24 44h16v8H24z" fill="#c5d2cb"/><path d="M24 44c0-7-9-9-9-19a17 17 0 1 1 34 0c0 10-9 12-9 19" fill="#e9d39d"/><path d="M27 56h10m-5-37v15m-4-8 4 8 4-8"/>',
    '<path d="m32 12 7 14 16 3-11 11 2 16-14-7-14 7 2-16L9 29l16-3z" fill="#dccc98"/>',
  ];
  return `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#597568" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shapes[id % 8]}</svg>`;
}
