# 交接给下一个 Agent

> 给接手人的操作手册。**先读 `AGENTS.md`，再读这份。**
> 最后更新：2026-10-21

---

## 一、你要给 MiMo 什么

### 必给的（缺一样它就跑不起来）

| # | 东西 | 怎么给 | 为什么 |
|---|---|---|---|
| 1 | **项目目录** | `D:\zhouyi-site` 整个文件夹 | 包括 `.git`，别漏 |
| 2 | **`AGENTS.md`** | 已在项目根目录 | Agent 会自动读，这是它的说明书 |
| 3 | **三个凭据文件** | `worker\.cf-token`、`worker\ADMIN_TOKEN.txt`、`worker\.resend-token` | 这三个不在 git 里，必须单独拷 |
| 4 | **GitHub 权限** | 让它能在 `findmyi/findmyi.github.io` 推送 | 或者给它一个 PAT |
| 5 | **Cloudflare 账号访问** | 至少能看 KV 和 Worker | 排障要用 |

### 建议给的

| # | 东西 | 为什么 |
|---|---|---|
| 6 | 本对话的关键决策记录 | 它不知道「为什么不做算命功能」这类背景 |
| 7 | `docs/产品评审-2026-10-19.md` | 已有，里面有产品层面的判断 |
| 8 | 用户自己的偏好说明 | 见 `AGENTS.md` 第九节 |

---

## 二、MiMo 需要什么环境能力

### 硬需求（没有就做不了）

| 能力 | 用途 | 检查方法 |
|---|---|---|
| **命令行执行** | 跑 `node build\*.mjs`、`git`、`wrangler` | 能跑 `node --version` |
| **文件读写** | 改代码、读数据 | 能读 `D:\zhouyi-site\index.html` |
| **Node.js v22+** | 构建脚本用 ESM、`crypto.subtle` | `node --version` |
| **Git** | 提交推送 | `git status` |
| **网络出口** | npm、wrangler、GitHub | `curl https://api.cloudflare.com` |

### 可选（有更好）

| 能力 | 用途 |
|---|---|
| 浏览器自动化 | 验证前端渲染。**没有也能干活**，用 `curl` + `node` 也能测 |
| Python 3 | 只有 `build/*.py` 那几个脚本需要，可以绕过 |

---

## 三、MCP / Skill 要不要装

### 结论：**基本不用装**

这个项目是「文件 + 命令行 + HTTP」三件事，**任何有 shell 和文件系统的 Agent 都能干**。

### 如果 MiMo 是通用 Agent，可能缺这些

| 缺什么 | 装什么 | 必要性 |
|---|---|---|
| 不能跑命令 | Shell / Terminal MCP | **必需** |
| 不能读写任意路径 | Filesystem MCP（授予 `D:\zhouyi-site`） | **必需** |
| 不能上网 | Fetch / HTTP MCP | **必需**（查 Cloudflare 文档、GitHub API） |
| 不能操作浏览器 | Playwright / Puppeteer MCP | 可选，验证 UI 用 |
| 不能调 git | 已有 shell 就不需要专门的 MCP | — |

### Skill 层面

**这个项目没有专属 Skill，也不需要。**

但如果 MiMo 支持 Skill，可以给它装这两类（通用价值）：

```
· 前端/设计类  —— 改 UI 时需要（design-taste-frontend 之类）
· 内容写作类   —— 改文案时需要
```

**但要注意**：这个项目的视觉风格已经定型（宣纸底 + 宋体 + 朱砂红），
**新 Skill 不能把风格改跑偏**。改之前先看 `assets/app.css` 顶部的 CSS 变量。

---

## 四、交接时最容易漏的三件事

### ① 那三个凭据文件不在 git 里

```
worker\.cf-token          Cloudflare API Token
worker\ADMIN_TOKEN.txt    Worker 管理员密钥
worker\.resend-token      Resend API Key
```

**只拷文件夹的话，这三个不会跟过去**（`.gitignore` 排除了）。
**必须单独确认它们在新环境里存在。**

### ② `worker\content-kv.json` 也不在 git 里

那是 64 篇付费正文，1.44 MB。新环境要重新生成：

```powershell
python build\export-content.py
```

或者从旧机器拷过去。

### ③ Cloudflare 上的 Secrets 不在任何文件里

```
ADMIN_TOKEN  GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET
MAIL_FROM    RESEND_API_KEY    SITE_URL
```

这些存在 Cloudflare 云端。**只要账���访问权给了，它们就在。**
但如果 MiMo 要重新部署 Worker，它需要能读 `worker\.cf-token` 才能跑 wrangler。

---

## 五、交接后的验收测试

让 MiMo 跑这四条，**全过才算交接成功**：

```powershell
cd D:\zhouyi-site

# 1. 环境
node --version                 # v22+
git status                     # 干净（或只有预期改动）

# 2. 测试全绿（159 项）
node build\test-paywall.mjs    # 57/57 —— 最关键的一个
node build\test-credits.mjs    # 18/18

# 3. 构建能跑
node build\build.mjs
node build\build-static.mjs

# 4. 线上活着
curl.exe -s https://zhouyi-api.huangminzhe321.workers.dev/health
# 应该返回 {"ok":true,...}
```

**如果第 2 条挂了** → 说明环境有问题（Node 版本、依赖、路径）
**如果第 4 条挂了** → 先不管，线上是独立的，不影响本地开发

---

## 六、给 MiMo 的第一条指令（可直接复制）

```
你现在接手一个已上线的项目：《周易》六十四卦解读站。

先做三件事，不要改任何代码：
1. 读 D:\zhouyi-site\AGENTS.md（这是你的说明书）
2. 跑 node build\test-paywall.mjs，确认 57/57 通过
3. 用 3 句话告诉我：这个项目的技术架构是什么、付费内容怎么保护的、
   当前最重要的待办是什么

做完这三件事再等我下一步指令。
```

**为什么先不改代码**：它需要先建立对项目的理解，否则改出来的东西会和现有设计冲突。

---

## 七、注意事项

**1. 别让它重做视觉**
视觉已经定型，改 UI 要先读 `assets/app.css` 顶部的 CSS 变量，沿用同一套。

**2. 别让它动 `content/` 目录**
那是 37 万字的源文件，改一个字都要跑完整的重新生成流程。

**3. 别让它碰支付合规红线**
不做算命/占卜/预测功能，不用免签支付。`AGENTS.md` 第七节写了。

**4. 测试不过不许提交**
`test-paywall.mjs` 挂了说明付费正文可能泄漏，这是产品生死线。
