const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');const assert=require('node:assert/strict');
const folder=path.resolve(process.argv[2]||''),runtime=path.join(folder,'runtime');
const target=JSON.parse(fs.readFileSync(path.join(runtime,'target.json')));
assert.equal(target.target,process.platform+'-'+process.arch);
const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'nookrew-test-'));
const projects=['프로젝트 A','Project B'].map(n=>{const p=path.join(base,n);fs.mkdirSync(p);return p});
const child=spawn(path.join(runtime,'bin',process.platform==='win32'?'node.exe':'node'),[path.join(runtime,'office-launcher.cjs'),'--mcp'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PATH:process.platform==='win32'?process.env.SystemRoot+'\\System32':'/usr/bin:/bin'}});
let buffer='',seq=0;const pending=new Map();child.stderr.resume();
child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const v=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result)}}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('MCP_TIMEOUT')),40000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})}
async function tool(name,project,key){const r=await call('tools/call',{name,arguments:{project,...(key?{key}:{})}});if(r.isError)throw Error(r.structuredContent?.error||'TOOL_FAILED');return r.structuredContent}
(async()=>{let a,b;try{
 const init=await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'portable-acceptance',version:'1'}});assert.equal(init.serverInfo.name,'moyo-office');child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 assert.equal((await call('tools/list')).tools.length,3);
 const key=randomUUID();a=await tool('office_open',projects[0],key);assert.equal(a.project,projects[0]);assert.deepEqual(await tool('office_open',projects[0],key),a);await assert.rejects(tool('office_open',projects[1],key),/IDEMPOTENCY_CONFLICT/);
 const page=await fetch(a.url);assert.equal(page.status,200);
 b=await tool('office_open',projects[1],randomUUID());assert.notEqual(a.url,b.url);await tool('office_close',projects[0],randomUUID());a=null;assert.equal((await tool('office_status',projects[1])).running,true);await tool('office_close',projects[1],randomUUID());b=null;
 console.log('PASS '+target.target+': bundled Node, MCP, real HTTP office, Unicode paths, replay, cross-project key denial, independent close; no model calls');
 }finally{if(a)await tool('office_close',projects[0],randomUUID()).catch(()=>{});if(b)await tool('office_close',projects[1],randomUUID()).catch(()=>{});child.stdin.end();child.kill();}})().catch(e=>{console.error(e.message);process.exitCode=1});
