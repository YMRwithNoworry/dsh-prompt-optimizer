# DSH Prompt Optimizer

**把随手写的一句话，变成 Agent 真正能执行的任务定义。**

它是 DeepSeek Harness 的通用 Prompt 优化器，插在「用户输入」和「主 Agent 执行」之间：

```
用户输入  →  Prompt Optimizer  →  用户检查  →  Composer Draft  →  用户自己按发送  →  主 Agent
```

在 Composer 右下角点一下「✨ 优化提示词」，插件读取当前草稿、识别任务领域、按强度补全结构与约束，
把结果放进一个预览弹窗（含并排对比与逐行 Diff）。**只有你点「采用优化结果」时，文字才会写回输入框；
插件永远不会替你发送消息。**

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [安装](#安装)
- [使用](#使用)
- [设置](#设置)
- [工作原理](#工作原理)
- [领域策略](#领域策略)
- [上下文](#上下文)
- [模型配置](#模型配置)
- [HTTP 接口](#http-接口)
- [开发](#开发)
- [测试](#测试)
- [安全与边界](#安全与边界)
- [排错](#排错)
- [与 DSH 版本的关系](#与-dsh-版本的关系)

---

## 它解决什么问题

人对 Agent 说话时天然省略信息。`帮我做个好看的管理后台` 这句话里，没有信息层级、没有主要 CTA、
没有响应式要求、没有验收标准——Agent 只能猜，猜错就返工。

这个插件不做「润色」，也不做「把一句话变长」。它做的是：

**理解 → 结构化 → 补全 → 约束 → 明确验收标准。**

同时严格守住一条线：**增强意图，绝不改变意图。**

它不会因为你写了一句「做个数据库」就替你决定用 PostgreSQL，也不会因为你说「好看」就往提示词里
堆玻璃拟态、渐变和光效。它只把**你说了但没写全的**补齐，把**含糊的**说清楚，把**该有的约束**列出来。

---

## 安装

### 前置

- DSH `0.1.7-rc.2`（`@deepseek-ai/dsh`）
- 一个带 Web 界面的 profile（`web` 或 `desktop`）——客户端按钮依赖 web 的 client module 系统
- pnpm 在 PATH 上（`dsh plugin` 会把参数转发给 pnpm）

### 方式一：从本地目录安装（开发/自用）

```bash
# 1) 装进 profile（本地路径必须是绝对路径）
dsh plugin --profile web add "D:/code/dsh插件/dsh-prompt-optimizer"

# 2) 把它选进 bundle 层
#    注意：dsh plugin add 只跑 pnpm，不会自动写 dsh.profile.bundles
```

然后编辑 `~/.dsh/profiles/web/package.json`，把包名加进 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-prompt-optimizer"
      ]
    }
  }
}
```

重启 `dsh --profile web` 即可。

> **桌面版（Electron）**：`desktop` profile 由应用自己管理，CLI 会拒绝
> （`error: profile "desktop" is managed exclusively by the Electron application`）。
> 在应用的 Plugin Hub 里安装本目录，或手工编辑
> `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles`，
> 然后重启应用。

### 方式二：从 git 安装

```bash
dsh plugin --profile web add "git+https://github.com/YMRwithNoworry/dsh-prompt-optimizer.git"
```

同样需要手工把 `dsh-prompt-optimizer` 加进 `dsh.profile.bundles`。

### 安装后自检

重启后打开设置面板，左侧应出现「提示词优化器」一节；Composer 右下角（模型选择器左边）应出现
「✨ 优化提示词」按钮。宿主侧还会在启动日志里打一行：

```
dsh-prompt-optimizer: active — model current, intensity balanced, language auto, domain detection on
```

---

## 使用

1. 在输入框里随便写，越随意越好：`帮我做个好看的管理后台`
2. 点 **✨ 优化提示词**
3. 弹窗里出现左右两栏：**原始 Prompt** / **优化后的 Prompt**，顶部有领域、复杂度、强度、语言标签
4. 切到 **差异对比** 可以看逐行增删
5. 选一个：
   - **取消** —— 什么都不改
   - **重新优化** —— 同一草稿再跑一次
   - **采用优化结果** —— 写回输入框
6. 检查一下，然后**自己**按发送

> 如果你在优化期间改了输入框，弹窗会提示「输入内容在优化期间发生了变化」，并额外给出
> **保留当前内容** 与 **应用优化结果** 两个选项——它不会悄悄覆盖你刚打的字。

### 什么时候它什么都不做

这是**正确行为**，不是失败：

- `你好` / `谢谢` / `好的` / `继续` —— 直接原样返回
- 空输入 —— 按钮本身就是灰的
- Light 强度下的极短草稿 —— 没有可修的东西

弹窗会显示「原提示词已经足够清晰，已按原样返回」以及「已跳过模型调用」。

---

## 设置

设置面板里可以改，也可以直接编辑 `~/.dsh/prompt-optimizer.json`。

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| **优化模型** | `current` | 下拉框，直接列出 DSH 已配置的 **provider / model**；`current` = 复用当前会话的模型 |
| **思考强度** | 跟随模型默认 | 选中模型支持的推理档位（如 medium / high / max）；选「默认」则由该模型自己决定 |
| **优化强度** | `balanced` | `light` 只修表达 / `balanced` 补全约束并结构化 / `deep` 建立目标、标准与验收条件 |
| **优化语言** | `auto` | `auto` 跟随原文 / `chinese` / `english` / `original` |
| **自动识别领域** | 开 | 关闭后一律使用通用策略 |
| **优化后先预览** | 开 | 关闭后点击按钮直接写入输入框 |
| **参考会话上下文** | 开 | 仅用于消解「那个东西」之类的指代，不复制整段历史 |
| **参考项目规则** | 开 | 读取工作区规则文件（见下），**不读源码** |
| **Minecraft 专项优化** | 开 | 启用 Minecraft 领域策略 |
| **视觉上下文** | 开 | 草稿附带图片时保留引用，不凭空描述图片内容 |
| **自定义优化规则** | 空 | 例如「所有 UI 设计都优先考虑简洁和高信息密度」 |

### 三个强度的实际差别

- **Light**：只修语法、指代、缺失的动作对象。保留你的原句和语序。**不新增章节、不新增要求、不新增约束。**
- **Balanced**（默认）：让意图无歧义，把你**明显暗示但没写出来**的要求写出来。多步骤任务才结构化。
- **Deep**：完整推演——目标、上下文、执行要求、质量标准、限制、验收条件，以及执行者本来要猜的歧义。
  对每个空缺选择最贴近原意的解释，并把**真正关键的假设**在行内标出来。仍然禁止新增功能、技术、范围。

---

## 工作原理

```
点击按钮
  ↓  读取 useInput().draft（不发送）
  ↓  POST /prompt-optimizer/optimize
  ↓
  纯函数规划（无网络、无模型）
    · detectDomain      领域打分
    · analyzeComplexity 复杂度 + 字符预算
    · shouldNoop        是否原样返回
  ↓  no-op → 直接返回原文，不调模型
  ↓
  组装 Prompt Architect System Prompt
    · 身份与十原则
    · 领域检查清单（只列该领域专家会问的问题）
    · 强度策略
    · 复杂度与硬性字符上限
    · 语言规则
    · 可选上下文块（项目规则 / 用户规则 / 会话 / 附件）
    · 输出契约
  ↓  ctx.llm.stream()（复用 DSH 的 provider / 认证 / 重试）
  ↓  清洗模型输出（去掉前言与代码围栏）
  ↓  返回 { optimized, original, plan }
  ↓
  预览弹窗（并排 / Diff）
  ↓  用户点「采用优化结果」
  ↓  inputActions.setDraft(optimized)   ← 插件唯一的写入
  ↓
  用户自己按发送
```

### 目录结构

```
dsh-prompt-optimizer/
├── package.json          dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      profile bundle patch：插入宿主插件行
├── lib/
│   └── client.js         浏览器半：手写 __ModuleLoader__ bundle，无需构建
├── src/
│   ├── index.ts          宿主半入口：挂路由、管设置
│   ├── route.ts          HTTP 接口（/settings、/optimize、/health）
│   ├── settings.ts       默认值、归一化、原子写盘、model 路由解析
│   ├── config.ts         schemastery 配置 schema（全部 volatile）
│   ├── optimizer/
│   │   ├── optimizer.ts      规划 → 调用 → 清洗
│   │   ├── system-prompt.ts  Prompt Architect System Prompt
│   │   ├── domain-detector.ts 领域打分
│   │   ├── complexity.ts     复杂度与字符预算
│   │   ├── provider.ts       与 DSH LLM 服务的桥接
│   │   ├── assembler.ts      零依赖的流式文本装配
│   │   └── domains/index.ts  领域策略注册表
│   ├── context/
│   │   ├── project.ts        项目规则文件白名单读取
│   │   └── conversation.ts   会话上下文裁剪
│   └── shared/types.ts       两端共享的类型
└── test/                 187 个测试
```

---

## 领域策略

领域不是关键词表，而是**检查清单**：该领域专家动手前会问的问题，以及该领域最容易犯的错。
系统提示词明确要求模型**丢掉用户意图不支持的那些问题**——这是「增强意图」不滑向「发明任务」的关键。

内置策略（`src/optimizer/domains/index.ts`）：

| 领域 | 典型触发 | 它会补什么 |
| --- | --- | --- |
| `minecraft` | Minecraft / NeoForge / 材质 / 模组 / SRP | 原版视觉语言、像素网格、游戏内可读性、Mod 实现约束 |
| `ui-design` | 界面 / 首页 / 后台 / 设计系统 | 信息层级、主要 CTA、交互状态、响应式、可访问性 |
| `image-generation` | 生图 / 插画 / 概念图 / 立绘 | 构图、视觉焦点、风格锚点、色彩与明度结构、比例 |
| `game-development` | 玩法 / 战斗 / 数值 / 关卡 | 核心循环、输入→反馈→奖励、数值交互、边界情况 |
| `coding` | 代码 / bug / 重构 / 架构 / 数据库 / CI | 可观察行为、既有约定、影响面、错误处理、验证方式 |
| `writing` | 写作 / 文案 / 文档 / 翻译 / 总结 | 受众、目的、语气锚点、结构、篇幅与平台 |
| `research` | 调研 / 分析 / 对比 / 竞品 | 要支撑的决策、对比维度、信息源与时效、不确定性标注 |
| `data-analysis` | 数据 / 指标 / 报表 / 统计 | 要回答的问题、输入形态、指标定义、缺失值处理 |
| `education` | 讲解 / 教程 / 习题 | 学习者起点、具体产出、顺序、可验证的练习 |
| `business` | 产品 / 项目 / 运营 / 营销 | 业务结果、成功指标、约束、干系人、风险 |
| `general` | 其它一切 | 通用三问 |

### 加一个领域

只需在 `DOMAINS` 数组里加一个对象，检测器和提示词构建器会自动使用它：

```ts
{
  id: 'video-production',
  label: 'Video Production',
  when: '剪辑、分镜、调色、字幕、导出。',
  signals: ['剪辑', '分镜', 'premiere', 'davinci', '调色', 'timeline'],
  considerations: [
    '成片时长与投放平台。',
    '叙事结构：开场钩子、信息密度、收尾。',
    '素材规格与帧率，以及输出编码要求。',
  ],
  sections: ['Design Direction', 'Output'],
  avoid: ['只堆形容词而不给节奏与镜头决策。'],
}
```

不需要改动任何其它文件。

---

## 上下文

### 项目规则（可选，默认开）

插件从会话工作目录读取一个**固定白名单**：

`AGENTS.md` · `PROMPT_RULES.md` · `.prompt-rules` · `DESIGN.md` · `CLAUDE.md` · `CONTRIBUTING.md` · `README.md`

- 每个文件最多 16 KB，合计最多 32 KB
- **源码文件永远不在白名单里**
- 读不到就跳过，绝不因为读文件失败而让优化失败

这让项目可以拥有自己的 Prompt 风格、设计语言与输出规则：

```
全局规则（AGENTS.md / 设置里的自定义规则）
  ↓
项目规则（.prompt-rules / DESIGN.md）
  ↓
领域规则（Domain Strategy）
  ↓
当前任务
  ↓
最终 Prompt
```

### 会话上下文（可选，默认开）

只保留最近 6 轮、单轮最多 1200 字符、合计最多 4000 字符，并且**只用于消解指代**。
系统提示词明确禁止把历史复述进输出。

例如你前面说过「我要做一个恐怖生存 Mod」，后面写「给这个怪物加个技能」，优化器知道「这个怪物」
指前面讨论的生物，**不会要求你重复一遍**。

### 视觉上下文

草稿附带图片时，插件把文件名传给优化器，并明确要求它：

> 以「附件的 <name>」引用它们，**不要描述或猜测其内容**。

插件自身不读取图片内容，也不做任何视觉推断——那需要 DSH 已安装的视觉插件。

---

## 模型配置

插件**不硬编码任何模型**，也不要求你重新配 API Key。

设置面板里的「优化模型」是一个下拉框，选项来自 DSH 自己的 LLM 服务：插件调用
`ctx.llm.listProviders()` 与 `listModels()` 枚举当前 profile 真正连得上的路由，再对每个路由调用
`resolveModelInfo()` 取它支持的**思考强度**。结果是：

- 你在 DSH 里配置过的模型，这里直接可选，不需要手打 `provider/model`；
- 换模型时「思考强度」自动切换成该模型支持的档位；
- 切到一个不支持当前强度的模型时，该强度会被自动清空（强度 id 是路由私有的）；
- 两个模型都支持的强度在切换后保留。

路由解析顺序：

1. 设置里显式选定的 `provider/model`
2. 调用会话当前使用的模型（连同它在会话里选的思考强度）
3. harness 全局默认模型（`ctx.agentDefaultModel`）

解析结果交给 `ctx.llm.stream()`，所以认证、重试、代理、适配器行为**完全复用 DSH 现有的那套**。

思考强度**只在非空时**才传给适配器。多数 provider 不暴露任何档位，传一个空字符串会让它们直接拒绝请求，
所以「默认」是真的不传。

温度固定为 `0.2`：架构师要的是可复现，不是创造力。

### 为什么下拉框里是空的

设置面板会说明原因，而不是只给一个空列表：

| `discovery.llmAvailable` | `providerCount` | 含义 |
| --- | --- | --- |
| `false` | — | 该 profile 没有挂载 LLM 服务（`llm` / `llm-pi-ai` / `llm-deepseek`） |
| `true` | `0` | 有服务，但没有任何 adapter 注册路由 |
| `true` | `>0` | 正常；`failedProviders` 里的 provider 表示它的 `listModels` 抛错或超时 |

无论哪种情况 `current` 始终可选，插件其余功能不受影响。

> **实现注意**：cordis 只会把服务交给在 `inject` 里声明过它的 fiber。直接读 `ctx.llm` 拿到的是
> `undefined`——不报错，只是所有 LLM 功能静默失效。又因为本插件必须在没有模型的 profile 里也能启动，
> 它不能把 `llm` 写进 `inject`（那会变成**必需**依赖，插件会永远 pending）。
> 所以三个可选服务统一通过 `ctx.inject([name], scoped => …)` 惰性解析，见 `resolveServices`。
> `test/plugin-face.test.ts` 会断言源码里不存在任何 `ctx.llm` / `ctx.webServer` 直接读取。

---

## HTTP 接口

宿主半在 profile 的 web server 上注册一个 **prefix** 路由 `/prompt-optimizer`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/prompt-optimizer/settings` | 当前设置、默认值、可发现的 provider/model 路由 |
| `POST` | `/prompt-optimizer/settings` | 保存设置（归一化后原子写盘） |
| `POST` | `/prompt-optimizer/optimize` | 执行一次优化 |
| `GET` | `/prompt-optimizer/health` | 存活探测 |

所有 POST 都做同源检查：

- 没有 `Origin` → 允许（桌面 shell 转发时会剥掉它）
- `Origin` 是 `dsh-app://` → 允许（桌面页面）
- 其它 → `Origin` 必须与 `Host` 一致，否则 403

失败一律返回 HTTP 200 + 稳定的错误码（`EMPTY_DRAFT`、`NO_ROUTE`、`AUTH`、`RATE_LIMIT`、
`EMPTY_OUTPUT`、`TRUNCATED`、`ABORTED`、`PROVIDER_ERROR`、`ROUTE_ERROR`…），
客户端把它们映射成人话。**任何失败都不会清空你的原始文本。**

---

## 开发

```bash
npm install     # 只装 typescript 与 @types/node（开发期依赖）
npm run build   # tsc 编译 src/ -> dist/
npm test        # 先 build，再跑 201 个测试
```

### 为什么需要 build

宿主半是 TypeScript，但 **Node 拒绝为 `node_modules` 下的文件做类型擦除**：

```
Error: Stripping types is currently unsupported for files under node_modules
```

所以插件被 profile 安装后不能直接跑 `.ts`，必须提供编译产物。`scripts/build.mjs` 做两件事：

1. `tsc` 把 `src/**/*.ts` 编译到 `dist/`，并把显式的 `.ts` 导入说明符改写成 `.js`
2. 复制 `src/config.js`（唯一一个不带类型标注的模块，见其文件头注释），并把它的
   `./settings.ts` 改写成 `./settings.js`

构建结束前会扫描 `dist/`，**只要还有一个 `.ts` 说明符就报错退出**，避免把必然运行失败的产物发出去。

浏览器半不需要构建：它是手写的 `window.__ModuleLoader__.load({ id, factory })` bundle，
只 `require("react")`（platform seed 表里的模块）。

`dist/` 是提交进仓库的，这样 `git` 安装无需构建步骤。改完源码记得 `npm run build`——
`test/packaging.test.ts` 会检查 `dist/` 是否比源码旧。

### ⚠️ 在应用运行时不要对 profile 跑 `pnpm install`

pnpm 换目录是「先删旧的、再改名新的」。如果目标目录正被占用——DSH 桌面应用运行时就会占用
它加载的插件目录——这次换目录会**中途失败**，被删掉的包可能只留下一个空壳。

本插件在一次开发中就这样损坏了 desktop profile 的 `dsh-plugin-product-design`（它的
`skills/` 目录被应用持有）。`pnpm install` 无法自愈，因为它会撞上同一把锁并报
`failed to remove existing directory ... prior to swap`。

**正确做法**：安装插件前先完全退出 DSH。若已经损坏：

```bash
# 1. 完全退出 DSH 桌面应用
# 2. 让挂起的删除完成，然后修复
npm run repair:product-design -- desktop

# 或者用 pnpm 重装（仅在没有 DSH 运行时）
cd ~/.dsh/profiles/desktop && pnpm install
```

`repair:product-design` 会检查包是否完整；若 `skills/` 缺失就就地恢复，并在目录仍被占用时
明确告诉你先退出应用，而不是静默失败。pnpm 在换目录失败时会把被移除的包留在
`node_modules/.ignored/`，所以数据通常是可以找回的。

### 本地迭代

profile 用 `file:` 安装时 pnpm 默认是**拷贝**而不是软链，所以改完代码要重新装一次：

```bash
cd ~/.dsh/profiles/desktop && pnpm install
```

想免去这一步就用 `link:`：

```bash
dsh plugin --profile web add "link:D:/code/dsh插件/dsh-prompt-optimizer"
```

### 它用到的 DSH 扩展点

| 能力 | 用到的 API |
| --- | --- |
| 按钮位置 | `ctx.slots.inject("conversation.input.right")` + `ctx.slots.register()` |
| 预览弹窗 | `ctx.slots.inject("conversation.input.overlay")` |
| 设置页面 | `ctx.slots.inject("settings.section")` |
| 读取草稿 | slot 的标准 props：`useInput(s => s.draft)` |
| 写回草稿 | `inputActions.setDraft(text)` |
| 模型调用 | `ctx.llm.stream()` |
| 默认模型 | `ctx.agentDefaultModel.currentSelection()` |
| HTTP 路由 | `ctx.inject(["webServer"], …)` + `webServer.register({ kind, path, handler })` |
| 配置表单 | `Config` schema（全部字段 `.volatile()`） |

**没有**使用 `querySelector` 注入按钮、`MutationObserver`、DOM 结构硬编码、fetch/XHR 劫持、
webpack 修改或任何 DSH 源码补丁。测试会断言这些模式不出现在客户端 bundle 里。

---

## 测试

```bash
cd dsh-prompt-optimizer
npm test              # 187 个测试
npm run test:verbose  # 逐条列出
```

覆盖范围：

| 文件 | 覆盖 |
| --- | --- |
| `domain-detector.test.ts` | 领域识别、优先级、`minecraftOptimization` 开关、注册表不变量 |
| `complexity.test.ts` | 问候语→trivial、一句话→simple、多部分→complex、字符预算 |
| `optimizer.test.ts` | 规划纯度、no-op 判定、路由解析（显式/会话/默认/无）、供应商失败、空输出、取消、输出清洗 |
| `system-prompt.test.ts` | 十原则、禁止新增功能与事实、禁止填充词、强度策略、语言规则、上下文块、草稿 JSON 转义防注入 |
| `settings.test.ts` | 默认值、逐字段降级、原子写、损坏文件、路由解析边界 |
| `config.test.ts` | schema 构建、默认值一致、**每个字段都是 volatile**、字段集合完整 |
| `context.test.ts` | 规则文件白名单（源码不可读）、体积上限、会话裁剪 |
| `route.test.ts` | 设置读写、优化成功/失败、空草稿与 no-op 不调模型、同源检查、超大 body |
| `client.test.ts` | 按钮注册与三个 slot、空输入禁用、**点击永不 submit**、采用写入、竞态保护、全部失败路径 |
| `client-render.test.ts` | 渲染结果本身：计划标签、Diff 切换与增删摘要、错误文案、no-op 说明、模型与思考强度下拉框的全部行为 |
| `model-routes.test.ts` | 模型发现：provider/model 枚举、强度元数据、超时与抛错的降级、路由上限、取消 |
| `copy.test.ts` | 文案表无重复键、静态引用的文案键都已定义 |
| `plugin-face.test.ts` | `inject` 形状（复刻 cordis 的 `Inject.resolve`）、**禁止直接读 `ctx.llm` 等可选服务**、两端导出的插件面 |
| `packaging.test.ts` | 相对导入必须有扩展名、`dist/` 存在且无残留 `.ts` 说明符、bundle patch 与 `exports` 一致 |

其中几条是**回归测试**，对应开发中真实出现过的 bug：

- **`inject` 声明形状错误**：`{ optional: [...] }` 被 cordis 当成一个名为 `optional` 的必需服务，
  插件会永远 pending、静默不加载。现在 `plugin-face.test.ts` 复刻了 `Inject.resolve` 来钉住语义。
- **直接读 `ctx.llm` 拿到 undefined**：cordis 只把服务交给声明过它的 fiber。这个 bug 让模型发现
  返回 0 条路由、`/optimize` 必然 `NO_ROUTE`，而日志里**没有任何线索**。现在服务统一走
  `ctx.inject([name], scoped => …)` 惰性解析，并有源码级断言禁止直接读取。
- **宿主半无法在 `node_modules` 下做类型擦除**：改为编译到 `dist/`，构建末尾会扫描产物，
  只要还剩一个 `.ts` 说明符就报错退出。
- 客户端 factory 少了一个闭合花括号
- `optimize()` 没有解析设置里的 `provider/model`，显式路由被忽略
- `TEXT.original` 被语言选项的同名键覆盖，导致 Diff 栏标题显示成「原文语言」
- 设置加载失败后界面卡在「加载中…」，错误信息不显示

### 测试替身的一个坑

`client-render.test.ts` 里的 React 替身最初把 children 放在元素节点上（`node.children`），
而 React 实际放在 `props.children`。后果是 `Pane` 里 `props.children !== undefined` 恒为 false，
Diff 视图的子内容被静默丢弃——测试却"通过"了，因为它只检查了 diff 开关的状态。
替身现在与 React 一致：children 进 `props.children`，展开后为空则删除该属性。
教训写在这里，是因为这类替身偏差不会报错，只会让测试失去意义。

---

## 安全与边界

- **永不自动发送。** 客户端 bundle 里没有 `submit()`、没有 `agent.followup`、没有 `agent.steer`。
  唯一的写入是 `inputActions.setDraft()`。测试对源码做字符串断言来守住这条线。
- **草稿是数据，不是指令。** 用户草稿以 JSON 编码后放进 `<draft>` 标签；即使草稿里出现
  `</draft>`，它也只是字符串内容，无法闭合真正的定界符（有测试覆盖）。
- **不读源码。** 项目上下文只读固定白名单里的声明式文件。
- **不碰 `settings.yaml`。** 插件只写自己的 `~/.dsh/prompt-optimizer.json`，用临时文件 + rename 原子写入。
- **不改 DSH。** 全部通过公开扩展点接入。
- **模型输出不进入 shell、文件系统或工具调用。** 它只被写回输入框，由用户审阅。

---

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 找不到按钮 | profile 没有 client module 系统（只有 web 系 profile 有）；或包名没加进 `dsh.profile.bundles` |
| 按钮是灰的 | 输入框为空，或正在提交中，或 composer 被锁定 |
| `找不到可用的模型路由` | 设置里填了 `current` 但当前会话没有选中模型；改成显式 `provider/model` |
| `模型认证失败` | DSH 的凭据配置问题，与本插件无关 |
| 启动日志 `skipping profile bundle "dsh-prompt-optimizer"` | bundle 解析失败——检查 `package.json` 的 `dsh.bundle.patch` 与文件是否存在 |
| `declares dsh.client but exports no "./client" bundle` | `exports["./client"]` 缺失或指向不存在的文件 |
| `require("…") missed the module table` | 客户端 `require` 了 platform seed 表之外的模块；本插件只 `require("react")` |
| 设置页没有「提示词优化器」 | 客户端 bundle 没加载；看浏览器控制台 |
| 优化结果被包在代码围栏里 | 已被 `normalizeModelOutput` 处理；若仍出现请提 issue |

---

## 与 DSH 版本的关系

针对 **DSH `0.1.7-rc.2`** 开发并验证。用到的都是这一版本真实存在的公开扩展点：

- `conversation.input.right` / `conversation.input.overlay` / `settings.section` 槽
- `InputZone`（`{ session, input }`）与 `InputActions.setDraft`
- `webServer.register({ kind: 'exact' | 'prefix', path, handler })`
- `ctx.llm.stream()`、`ctx.agentDefaultModel.currentSelection()`
- `Config` schema 的 `.volatile()` 语义
- `window.__ModuleLoader__.load({ id, factory })` 客户端模块契约

若未来 DSH 改变其中任一项，需要同步修改的地方在「它用到的 DSH 扩展点」表里已逐项列出。

---

## License

MIT
