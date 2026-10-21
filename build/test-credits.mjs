import worker from '../worker/index.js';
function makeKV(){const m=new Map();return{async get(k){return m.has(k)?m.get(k):null},async put(k,v,o){m.set(k,v)},async delete(k){m.delete(k)},async list({prefix='',limit=1000}={}){return{keys:[...m.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name})),list_complete:true}}}}
let pass=0,fail=0;
const ok=(l,c,e='')=>{if(c){pass++;console.log('  ✓ '+l)}else{fail++;console.log('  ✗ '+l+(e?'  → '+e:''))}};
const env={KEYS:makeKV(),ADMIN_TOKEN:'TK',PAY_PROVIDER:'mock',AUTH_MODE:'both'};
const post=async(b)=>{const r=await worker.fetch(new Request('https://t.workers.dev',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),env);const t=await r.text();try{return JSON.parse(t)}catch{return{raw:t}}};
const E='q@b.com',P='password-123';

console.log('\n【处境自测：额度与积分】');
let r=await post({action:'signup',email:E,password:P});
r=await post({action:'verify',email:E,code:r.devCode});
const S=r.token;
ok('登录成功', !!S);

r=await post({action:'credits',session:S});
ok('新用户 3 次', r.ok && r.remaining===3, JSON.stringify(r).slice(0,90));
ok('不是不限', r.unlimited===false);
ok('返回三档套餐', Array.isArray(r.packs) && r.packs.length===3, String((r.packs||[]).length));
console.log('    套餐: '+(r.packs||[]).map(p=>p.id+'='+(p.price/100)+'元/'+p.count+'次').join('  '));

console.log('\n【用完 3 次】');
for (let i=1;i<=3;i++){
  r=await post({action:'quiz',session:S,stage:'P3'});
  ok('第 '+i+' 次通过，剩余 '+(3-i), r.ok && r.remaining===3-i, JSON.stringify(r));
}
r=await post({action:'quiz',session:S,stage:'P3'});
ok('第 4 次被拒', !r.ok && r.reason==='no-credits', JSON.stringify(r));

console.log('\n【买 3 次包】');
r=await post({action:'buy',tier:'C3',session:S});
ok('下单 9.9 元', r.ok && r.amount===990, JSON.stringify(r).slice(0,90));
const NO=r.outTradeNo;
r=await post({action:'mock-pay',outTradeNo:NO});
ok('付款成功', r.ok, JSON.stringify(r));
r=await post({action:'credits',session:S});
ok('额度恢复到 3', r.ok && r.remaining===3, JSON.stringify(r).slice(0,80));
r=await post({action:'quiz',session:S,stage:'P1'});
ok('又能测了', r.ok, JSON.stringify(r));

console.log('\n【买内容后不限次】');
r=await post({action:'buy',tier:'PREM',session:S});
r=await post({action:'mock-pay',outTradeNo:r.outTradeNo});
ok('内容付款成功', !!r.key);
r=await post({action:'credits',session:S});
ok('变成不限次', r.ok && r.remaining===-1 && r.unlimited===true, JSON.stringify(r).slice(0,80));
for (let i=0;i<3;i++) r=await post({action:'quiz',session:S,stage:'P5'});
ok('不限次下连测不受限', r.ok, JSON.stringify(r));

console.log('\n【校验】');
r=await post({action:'quiz',session:S,stage:'X9'});
ok('非法阶段被拒', !r.ok && r.reason==='badstage', JSON.stringify(r));
r=await post({action:'quiz',session:'',stage:'P1'});
ok('未登录被拒', !r.ok && r.reason==='need-login');
r=await post({action:'credits',session:''});
ok('未登录取不到额度', !r.ok);

console.log('\n'+(fail===0?'✅':'❌')+'  '+pass+' 通过 · '+fail+' 失败\n');
process.exit(fail===0?0:1);
