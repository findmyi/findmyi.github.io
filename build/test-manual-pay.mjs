import worker from '../worker/index.js';
function makeKV(){const m=new Map();return{async get(k){return m.has(k)?m.get(k):null},async put(k,v,o){m.set(k,v)},async delete(k){m.delete(k)},async list({prefix='',limit=1000}={}){return{keys:[...m.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name})),list_complete:true}}}}
let pass=0,fail=0;
const ok=(l,c,e='')=>{if(c){pass++;console.log('  ✓ '+l)}else{fail++;console.log('  ✗ '+l+(e?'  → '+e:''))}};
const env={KEYS:makeKV(),ADMIN_TOKEN:'TK',PAY_PROVIDER:'mock',AUTH_MODE:'both'};
const post=async(b)=>{const r=await worker.fetch(new Request('https://t.workers.dev',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),env);const t=await r.text();try{return JSON.parse(t)}catch{return{raw:t}}};
const E='a@b.com',P='password-123';

console.log('\n【人工确认收款全流程】');
let r=await post({action:'signup',email:E,password:P});
r=await post({action:'verify',email:E,code:r.devCode});
const S=r.token;
r=await post({action:'buy',tier:'PREM',session:S});
const NO=r.outTradeNo;
ok('下单成功', r.ok);

r=await post({action:'claim-paid',outTradeNo:NO});
ok('用户点已付款 → claimed', r.ok && r.status==='claimed', JSON.stringify(r));

r=await post({action:'pending',token:'TK'});
ok('后台能看到待确认', r.ok && r.orders.some(o=>o.no===NO), JSON.stringify(r.orders&&r.orders.length));
const one=(r.orders||[]).find(o=>o.no===NO);
ok('带邮箱', one && one.email===E);
ok('状态 claimed', one && one.status==='claimed');

r=await post({action:'unlock',session:S,ids:['qian']});
ok('确认前取不到', !r.ok && r.reason==='not-purchased', JSON.stringify(r));

r=await post({action:'confirm',token:'TK',outTradeNo:NO});
ok('管理员确认成功', r.ok, JSON.stringify(r));

await env.KEYS.put('content:qian','<p>正文</p>');
r=await post({action:'unlock',session:S,ids:['qian']});
ok('确认后能取正文', r.ok && (r.contents.qian||'').includes('正文'), JSON.stringify(r).slice(0,150));

r=await post({action:'pending',token:'wrong'});
ok('错误密钥被拒', !r.ok && r.reason==='forbidden');
r=await post({action:'confirm',token:'wrong',outTradeNo:NO});
ok('错误密钥不能确认', !r.ok);

console.log('\n'+(fail===0?'✅':'❌')+'  '+pass+' 通过 · '+fail+' 失败\n');
process.exit(fail===0?0:1);
