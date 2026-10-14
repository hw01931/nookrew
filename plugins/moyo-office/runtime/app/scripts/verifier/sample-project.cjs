// Actual local model calls and isolated verification. No synthetic employee output.
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const base = 'http://127.0.0.1:4417';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let token;
async function get(path = '/api/office') {
  const r = await fetch(base + path);
  if (!r.ok) throw Error(await r.text());
  return r.json();
}
async function post(input) {
  const r = await fetch(base + '/api/office', {
    method: 'POST',
    headers: {Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': token},
    body: JSON.stringify({key: randomUUID(), version: 0, ...input}),
  });
  const value = await r.json();
  if (!r.ok) throw Error(JSON.stringify(value));
  return value;
}
async function job(role, mode, prompt) {
  const s = await get(),
    employee = s.entities.find((e) => e.kind === 'employee' && e.data.role === role),
    room = s.entities.find((e) => e.kind === 'room' && e.data.type === 'leadership');
  const run = await post({action: 'start', employeeId: employee.id, roomId: room.id, mode, prompt});
  console.log('START', role, run.id, run.modelId);
  for (let i = 0; i < 120; i++) {
    await pause(5000);
    const current = (await get()).jobs.find((j) => j.id === run.id);
    if (!['QUEUED', 'RUNNING'].includes(current.status)) {
      console.log('END', JSON.stringify(current));
      return current;
    }
  }
  throw Error('JOB_WAIT_TIMEOUT');
}
(async () => {
  token = (await get('/api/state')).token;
  const checks = await get('/api/office/checks');
  await post({
    action: 'checks-update',
    version: checks.version,
    content:
      "const t=require('node:test'),a=require('node:assert/strict'),{calculate}=require('../src/calc.js');t('totals and boundaries',()=>{a.equal(calculate([]),0);a.equal(calculate([{hours:2,rate:30000},{hours:1.5,rate:40000}]),120000);a.equal(calculate([{hours:0,rate:100}]),0);for(const row of [{hours:-1,rate:3},{hours:1,rate:-2},{hours:NaN,rate:2},{hours:1,rate:Infinity},{hours:'2',rate:3}])a.throws(()=>calculate([row]));});",
  });
  await job(
    '기획 담당',
    'plan',
    '견적 계산기 기획안을 500자 이내로 artifact.write에 저장하세요. 항목별 이름·시간·시급, 항목 추가/삭제, 합계, localStorage 복원, 음수·비정상 숫자 거부. 확정된 구현은 아직 없습니다.',
  );
  await job(
    '디자인 담당',
    'design',
    '견적 계산기 HTML/CSS 시안을 artifact.write에 저장하세요. 한 화면에 항목 이름·시간·시급 입력, 합계, 추가/삭제 버튼. 짧은 시안 1200자 이내, 스크립트 없이.',
  );
  await job(
    '개발 담당',
    'develop',
    '견적 계산기 계산 모듈만 구현하세요. project.list로 현재 파일 확인 후 change.propose로 신규 src/calc.js를 제안하세요. exports.calculate(items): [{hours:number,rate:number}] 합계 숫자 반환. 빈 배열 0, 0 허용, 음수/NaN/Infinity/숫자 아닌 입력은 throw. 브라우저에서도 window.calculate 제공 (typeof module 검사). 파일 신규 beforeHash:null. 아직 테스트 실행/반영하지 않았다고 보고하세요.',
  );
  let s = await get();
  for (const c of s.changes.filter((c) => c.state === 'PROPOSED')) {
    await post({action: 'verify', id: c.id, version: c.version});
    let result;
    for (let i = 0; i < 50; i++) {
      await pause(3000);
      result = (await get()).changes.find((x) => x.id === c.id);
      if (result.state !== 'VERIFYING') break;
    }
    console.log('VERIFY', JSON.stringify(result));
    if (result.state !== 'VERIFIED') continue;
    const approved = await post({action: 'approve', id: c.id, version: result.version});
    console.log('APPLY', JSON.stringify(await post({action: 'apply', id: c.id, version: approved.version})));
  }
  fs.writeFileSync('.aiorchestra/sample-project-state.json', JSON.stringify(await get(), null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
