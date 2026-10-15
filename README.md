# 周易六十四卦 · 白话全解

一个纯静态的《周易》网站。架构参考 [hotel-ai-bluebook](https://zhangshixin97.github.io/hotel-ai-bluebook/)。

**结构：前置 14 篇（体）+ 六十四卦（用）**

六十四卦是「术」，但术需要「体」才能施行。没有前置基础，读者只会把六十四卦当成占卜签文。所以本站把「怎么读、怎么看、吉凶是什么」放在六十四卦之前——对应参考站的「卷首 + 使用篇」。

| 分组 | 篇数 | 内容 |
|---|---|---|
| 卷首 | 3 | 写在前面、本书怎么用、术语速查 |
| 基础篇 · 体 | 7 | 阴阳、八卦、六十四卦如何生成、爻位、错卦综卦互卦、成书流变、如何读一卦 |
| 方法篇 · 用 | 4 | 占卜与决策、常见误区、常见问题、索引与检索 |
| 上经 | 30 | 乾坤至坎离 |
| 下经 | 34 | 咸恒至未济 |

## 本地预览

```bash
node serve.mjs          # 默认 http://127.0.0.1:8848/
node serve.mjs 9000     # 指定端口
```

> ⚠️ 必须用 HTTP 服务器打开。直接双击 `index.html`（`file://` 协议）会被浏览器阻止读取 `data/*.json`。

## 构建

数据源在 `build/`，正文与索引由脚本生成：

```bash
node build/build.mjs      # 生成 manifest / search / articles
node build/verify.mjs     # 校验 13 项功能代码是否齐备
```

会输出：
- `data/manifest.json` —— 目录与全部条目元数据（`front` + `articles`）
- `data/search.json` —— 全文搜索索引
- `articles/{id}.html` —— 78 个正文片段（14 前置 + 64 卦）

## 结构

```
├─ index.html              三视图外壳（封面 / 目录 / 正文）
├─ serve.mjs               本地静态服务器
├─ assets/
│  ├─ app.css              样式（明暗双主题）
│  ├─ app.js               hash 路由 + 渲染 + 搜索
│  └─ img/favicon.svg
├─ data/                   构建生成
│  ├─ manifest.json
│  └─ search.json
├─ articles/               78 个正文片段（构建生成）
└─ build/
   ├─ bagua.mjs            八卦基础
   ├─ front.mjs            前置 14 篇（卷首/基础/方法）
   ├─ hex-01-16.mjs        ┐
   ├─ hex-17-32.mjs        │ 六十四卦数据源
   ├─ hex-33-48.mjs        │
   ├─ hex-49-64.mjs        ┘
   ├─ build.mjs            合并 + 校验 + 生成
   └─ verify.mjs           功能代码自检
```

## 路由

| hash | 视图 |
|---|---|
| `#/` | 封面 |
| `#/toc` | 六十四卦大目录 |
| `#/toc/{group}` | 目录（定位到分组） |
| `#/p/{id}` | 卦正文 |

## 每卦内容

卦象符号 · 卦序 · 卦名 · 全称 · 上下卦 · **卦辞** · **彖传** · **大象传** · **六爻爻辞** · **六爻小象** · **白话解读** · **处世应用** · 关键词。

乾、坤两卦另附「用九 / 用六」。

## 功能

- 明暗双主题（跟随系统，可手动切换，记忆在 localStorage）
- 全文搜索（⌘K / Ctrl+K），命中卦名、卦辞、爻辞、白话
- 本页目录 + 滚动高亮
- 阅读进度条
- 上一卦 / 下一卦导航
- 卦象浮动速览面板（右下角）
- 阅读位置记忆（「继续阅读」）
- 响应式 + 打印样式

## 数据说明

经文（卦辞、彖传、大象传、爻辞、小象）依据**通行本《周易》**；白话解读与处世应用为现代汉语转写。

构建脚本会做完整性校验：卦数 64、序号连续、id 唯一、每卦六爻、卦象符号与 Unicode 码点一致。校验不通过则拒绝生成。

## 部署

纯静态，直接把仓库根目录（不含 `build/`）丢到任意静态托管即可：

- GitHub Pages：推送到仓库，Settings → Pages 选分支根目录
- Netlify / Vercel / Cloudflare Pages：直接连接仓库，无需构建命令
- 任意对象存储 / Nginx：上传 `index.html`、`assets/`、`data/`、`articles/`

因使用 hash 路由，无需服务端 rewrite 规则。
