const fs = require('fs');
const p = 'D:/zhouyi-site/worker/index.js';
let s = fs.readFileSync(p, 'utf8');
const old = `function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

`;
if (!s.includes(old)) {
  console.error('old json not found');
  process.exit(1);
}
s = s.replace(old, '');
fs.writeFileSync(p, s);
console.log('removed old json');
