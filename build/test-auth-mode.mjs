import worker from '../worker/index.js';
function makeKV(){const m=new Map();return{async get(k){return m.has(k)?m.get(k):null},async put(k,v,o){m.set(k,v)},async delete(k){m.delete(k)},async list({prefix='',limit=1000}={}){return{keys:[...m.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name})),list_complete:true}}}}
let pass=0,fail=0;
const ok=(l,c,e='')=>{if(c){pass++;console.log('  ✓ '+l)}else{fail++;console.log('  ✗ '+l+(e?'  → '+e:''))}};
const post=async(env,b)=>{const r=await worker.fetch(new Request('https://t.workers.dev',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),env);const t=await r.text();try{return{status:r.status,data:JSON.parse(t)}}catch{return{status:r.status,data:{raw:t}}}};

console.log('\n【AUTH_MODE=google：邮箱登录必须关闭】');
const envG={KEYS:makeKV(),ADMIN_TOKEN:'TK',PAY_PROVIDER:'mock',AUTH_MODE:'google'};
for (const act of ['signup','verify','login','resend']) {
  const r = await post(envG, {action:act, email:'a@b.com', password:'password-123', code:'123456'});
  ok(act+' 被拒 (403)', r.status===403 && r.data.reason==='email-login-disabled', JSON.stringify(r.data).slice(0,80));
}
const r2 = await post(envG, {action:'me'});
ok('me 仍可用（不返回 403）', r2.status===200, String(r2.status));
const r3 = await post(envG, {action:'logout'});
ok('logout 仍可用', r3.data.ok === true);

console.log('\n【AUTH_MODE=both：邮箱登录恢复】');
const envB={KEYS:makeKV(),ADMIN_TOKEN:'TK',PAY_PROVIDER:'mock',AUTH_MODE:'both'};
const r4 = await post(envB, {action:'signup', email:'a@b.com', password:'password-123'});
ok('signup 成功', r4.data.ok === true, JSON.stringify(r4.data).slice(0,100));

console.log('\n【默认（未设 AUTH_MODE）也是 google】');
const envD={KEYS:makeKV(),ADMIN_TOKEN:'TK',PAY_PROVIDER:'mock'};
const r5 = await post(envD, {action:'signup', email:'a@b.com', password:'password-123'});
ok('默认关闭邮箱', r5.status===403 && r5.data.reason==='email-login-disabled');

console.log('\n'+(fail===0?'✅':'❌')+'  '+pass+' 通过 · '+fail+' 失败\n');
process.exit(fail===0?0:1);
