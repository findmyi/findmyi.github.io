# AGENTS.md — 给接手这个项目的 Agent

> 这份文件是写给 **AI Agent** 看的，不是写给人看的。
> 你接手时不需要问任何人，按这份文件就能继续工作。
> 最后更新：2026-10-21

---

## 一、这个项目是什么

一个《周易》六十四卦的解读站，带付费墙和自测工具。

```
线上地址    https://findmyi.github.io/
仓库        https://github.com/findmyi/findmyi.github.io
本地目录    D:\zhouyi-site
Worker      https://zhouyi-api.huangminzhe321.workers.dev
Cloudflare  账号 ID 3c42788f6e1e9a866634592a37ca0da2
KV 命名空间  ZHOUYI   id=6abf60ac747241b58df60e9d4ce11cdf
```

**产品形态**：
- 免费层：卦辞、彖传、大象传、六爻爻辞、白话解读、处世应用（不登录可看）
- 付费层：每卦的逐爻深度解读（约 9,500 字/卦），¥999 / ¥1999 终身买断
- 乾坤两卦整篇免费（做样品用）
- 处境自测：12 道题 → 定位到六阶段之一 → 给三条最像的处境
- 处境内核：384 条「处境 / 铁律 / 例外」，是全部内容的索引层

---

## 二、技术架构（先看懂这个再动手）

```
GitHub Pages（纯静态）
├─ index.html          单页应用外壳（hash 路由）
├─ assets/*.js|css     全部前端逻辑
├─ articles/<id>.html  正文【片段】（无 html/head，由 JS fetch 后插入）
├─ data/manifest.json  所有文章的元数据（TOC / 搜索 / 付费卡都读它）
├─ data/situ.json      384 条处境索引
└─ p/<id>.html         SEO 用的独立完整页面（含 head/canonical/JSON-LD）

Cloudflare Worker（zhouyi-api）+ KV
├─ 64 篇付费正文       content:<id>
├─ 授权码              key:<无连字符大写码>
├─ 用户 / 会话         user:<email> / sess:<token>
├─ 自测额度            credits:<email>
└─ 订单                order:<outTradeNo>
```

### 三个必须理解的约束

**1. 付费正文绝对不能进静态产物**
`content/premium-v3.mjs` 里的 depth 只在构建时进 `worker/content-kv.json`，
**永远不写进 `articles/*.html` 或 `manifest.json`**。
`build/test-paywall.mjs` 会扫全站检查泄漏，改代码后必须跑它。

**2. 乾坤是 free，其余 62 卦是 premium**
`build/build.mjs` 里的 `FREE_HEX = new Set(['qian','kun'])` 控制这个。
乾坤的 depth 直接内联进 `articles/qian.html`。

**3. 全站用相对路径，不能用 `/` 开头的绝对路径**
因为曾经部署在 `/zhouyi/` 子路径下，现在虽在根路径，但仍保持相对路径习惯。

---

## 三、构建与测试（每次改完必跑）

```powershell
cd D:\zhouyi-site

# 1. 构建（三个脚本，顺序不能乱）
node build\build.mjs          # 生成 manifest / articles/*.html / search.json
node build\build-situ.mjs     # 生成 data/situ.json（384 条处境）
node build\build-static.mjs   # 生成 p/*.html / sitemap.xml / robots.txt / llms.txt

# 2. 测试（7 个，全过才算改完）
node build\test-worker.mjs        # 22 项  授权码 / 下发 / 一码一人
node build\test-order.mjs         # 27 项  账号 / 购买 / 换设备恢复
node build\test-manual-pay.mjs    # 10 项  人工确认收款
node build\test-paywall.mjs       # 57 项  【最重要】付费内容不泄漏
node build\test-auth-mode.mjs     # 8 项   邮箱登录开关
node build\test-credits.mjs       # 18 项  自测额度与积分
node build\test-alipay-sign.mjs   # 17 项  支付宝 RSA2 签名验签
```

**合计 159 项。** 任何一个挂了都不许提交。

### Python 脚本（少用，需要时）

```
python build\export-content.py   # premium-v3.mjs → worker/content-kv.json
python build\md2premium.py       # content/v3/*.md → premium-v3.mjs
python build\verify-v3.py        # 内容字数/结构检查
python build\check-leak.py       # 泄漏扫描（备用）
python build\shiliao.py          # 一手史料检索（4386 卷）
```

Python 路径：
`C:\Users\谦哲\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`

### 本地预览

```powershell
node serve.mjs 8848
# → http://127.0.0.1:8848/
```

---

## 四、部署

### 静态站（GitHub Pages）

```powershell
git add -A
git commit -m "..."
git push
```

推上去后 GitHub Actions 自动构建部署（`.github/workflows/deploy.yml`）。

**注意**：deploy.yml 只发布 `index.html assets articles data p sitemap.xml robots.txt llms.txt privacy.html terms.html`。
**不会发布** `content/`（含付费正文）、`build/`、`worker/`、`docs/`。

### Worker

```powershell
cd D:\zhouyi-site\worker
$env:CLOUDFLARE_API_TOKEN = (Get-Content .cf-token -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = '3c42788f6e1e9a866634592a37ca0da2'
& 'D:\cache\npm-global\wrangler.cmd' deploy
```

### 灌付费正文到 KV

```powershell
python build\export-content.py
cd D:\zhouyi-site\worker
& 'D:\cache\npm-global\wrangler.cmd' kv bulk put --binding=KEYS content-kv.json --remote
```

---

## 五、凭据在哪（都不在 git 里）

| 凭据 | 位置 | 用途 |
|---|---|---|
| Cloudflare API Token | `worker\.cf-token` | wrangler 部署 |
| Worker 管理员密钥 | `worker\ADMIN_TOKEN.txt` | 生成/吊销授权码、确认订单 |
| Resend API Key | `worker\.resend-token` | 发验证邮件 |
| Google OAuth | Cloudflare Secret（不在本地） | Google 登录 |

**这四个都已加进 `.gitignore`，永远不会进版本库。**

Cloudflare 上现有的 Secrets：
```
ADMIN_TOKEN  GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET
MAIL_FROM    RESEND_API_KEY    SITE_URL
```

环境变量（wrangler.toml）：
```
PAY_PROVIDER = "mock"     ← 现在是模拟支付，真实收款靠收款码 + 人工确认
```

---

## 六、踩过的坑（别再踩一遍）

**1. 用 Google OAuth 的 redirect_uri 必须是 Worker 自己的域名**
不是站点的域名。只有 Worker 有 client_secret 能换 token。
代码里用 `url.origin` 拼，不要用 `SITE_URL`。

**2. wrangler 的 OAuth 登录在这台机器上会失败**
它的回调服务器只监听 IPv6 `::1`，浏览器走 IPv4 `127.0.0.1`，必然 ERR_CONNECTION_REFUSED。
**直接用 API Token，不要试 `wrangler login`。**

**3. Cloudflare 的 token 不能从截图里认**
`l/1/I`、`O/0` 极易混淆。要么读剪贴板，要么让用户跑 `Set-Content` 写文件。

**4. 个人收款码没有支付回调**
只能用「用户扫码 → 点我已付款 → 管理员在 `/admin` 确认 → 自动开通」。
`PAY_PROVIDER=alipay`（当面付）已经有代码，但需要个体户执照才能签。

**5. Chrome headless 的截图不能用来判断移动端布局**
`--window-size=414` 截图时右侧会假性截断，但实测 `scrollWidth` 溢出是 0。
**要判断布局，用 JS 读 `getBoundingClientRect` / `scrollWidth`，不要看截图。**

**6. `min-height: 100vh` 会让整页截图失真**
截图窗口设 4000px 高时，hero 会撑满 4000px，后面的内容全在画面外。
**要看全页，用 iframe 加载后注入 CSS 覆盖 `min-height`，再截 iframe。**

**7. 文案纪律：对外写「处境自测」，不写「测卦 / 算命 / 预测 / 吉凶」**
后者会触支付通道的封禁类目，也会和自家的服务条款矛盾。

**8. 题库的提示语不能暴露方法论**
不要写「英耀：叠叠问此事…」这种。用户会意识到自己在被解剖，答案就不真了。
提示只用来消除题面歧义。

---

## 七、当前状态与待办

### 已完成

```
✅ 64 卦深度解读 61 万字（content/v3/*.md）
✅ 付费墙：Worker 验码下发，静态产物零泄漏
✅ 账号：Google 登录（邮箱登录已关闭，代码保留）
✅ 站内购买 + 收款码 + 人工确认后台 /admin
✅ 支付宝当面付代码（待执照）
✅ 处境自测 12 题 × 3 套（工作 / 钱 / 感情）
✅ 积分体系（免费 3 次，¥9.9/3 次 起）
✅ 六阶段索引 + 384 条处境
✅ SEO：79 个独立页面 + sitemap + robots + llms.txt
✅ 分享卡片（Canvas，1080×1440，带二维码）
✅ 域名：findmyi.github.io
✅ 测试 159 项全过
```

### 待办（按优先级）

| # | 事项 | 说明 |
|---|---|---|
| 1 | **买域名 `findmyi.app`（约 ¥100/年）** | 现在 Resend 只能发到作者自己的邮箱，邮箱登录因此关着。买了域名并验证后，改 `AUTH_MODE=both` + `authMode:'both'` 就能开 |
| 2 | 静止落地页 `p/*.html` 加登录/购买入口 | 搜索进来的人落在静态页上，那里还没有引导 |
| 3 | `#/toc` 目录页的付费引导 | 点了卦才看到付费卡，目录页可以先给预期 |
| 4 | 修 `.hero-sample` 在 1180px 以下的三卡转竖排是否够好看 | 未实测移动端视觉 |
| 5 | 办个体户执照 → 签支付宝当面付 → `PAY_PROVIDER=alipay` | 全自动收款，去掉人工确认 |
| 6 | 内容分发素材 | 384 条处境 → 小红书/知乎可发布的内容 |

### 明确不做的事

- ❌ 不做算命 / 占卜 / 预测功能（合规红线）
- ❌ 不用免签支付（2025 年有判刑案例）
- ❌ 不把付费正文写进静态产物
- ❌ 不用 `wrangler login`（见坑 2）

---

## 八、代码地图

```
index.html                单页外壳，所有 <script> 在这里引入
assets/
  app.js                  【核心】路由、渲染、付费卡、自测、处境索引
  quiz.js                 题库 + 计分（12 题 × 3 套）
  share-card.js           Canvas 分享卡片
  auth-ui.js              登录弹层 / 账号菜单
  payment.js              定价、收款码、渠道配置
  license.js              授权码算法（前端校验）
  license-server.js       设备指纹 + 服务端校验
  qrcode.js              二维码生成（qrcode-generator，MIT）
  app.css / paywall.css / toc-variants.css

build/
  build.mjs               【最主要】manifest + articles 生成
  build-situ.mjs          384 条处境 → data/situ.json
  build-static.mjs        SEO 独立页 + sitemap + llms.txt
  test-*.mjs              7 个测试

worker/
  index.js                Worker 全部逻辑（下单/支付/授权/内容下发/自测额度）
  pay.js                  支付通道适配（mock / alipay / xorpay / afdian）
  auth.js                 用户系统（注册/验证/登录/会话/Google OAuth）
  wrangler.toml           部署配置
  ADMIN_TOKEN.txt         管理员密钥（gitignore）
  .cf-token               Cloudflare Token（gitignore）
  content-kv.json         64 篇付费正文（gitignore，绝不进 git）

content/
  v3/*.md                 64 篇深度解读的源文件（约 37 万汉字）
  premium-v3.mjs          由 md2premium.py 生成
  写作规则.md             内容规范

data/
  manifest.json           所有文章元数据（构建产物）
  situ.json               384 条处境（构建产物）
  search.json             搜索索引（构建产物）
```

---

## 九、与用户协作的方式

用户的特点（从历史交互总结）：

- **讨厌反复确认**。给了明确指令就直接执行，做完再报告发现
- **讨厌被问「要不要这样做」**。要么给判断，要么直接做
- **会指出错误**。他说你错了就是错了，先改再说原因
- **要求落盘核实**。工具报成功不算，要 `ls` / `Read` 复核后再报
- **交付要标绝对路径**，并 `Start-Process explorer.exe -ArgumentList '<path>'`

**报告风格**：先给结论，再给数据，不铺垫。

---

## 十、第一次接手时的自检清单

```powershell
# 1. 环境对不对
node --version                      # 应该 v22+
git status                          # 应该干净
node build\test-paywall.mjs         # 应该 57/57

# 2. 线上是不是活的
curl.exe -s https://findmyi.github.io/ | Select-Object -First 3
curl.exe -s https://zhouyi-api.huangminzhe321.workers.dev/health

# 3. 凭据在不在
Test-Path worker\.cf-token
Test-Path worker\ADMIN_TOKEN.txt

# 4. 确认 KV 里有内容
cd worker
& 'D:\cache\npm-global\wrangler.cmd' kv key list --binding=KEYS --remote
# 应该看到 64 个 content:* 和若干 key:*
```

**四项都对，就可以开始干活了。**
