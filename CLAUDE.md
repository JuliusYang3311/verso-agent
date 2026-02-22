# Verso 项目指南

## 项目概述

Verso（原 OpenClaw）是一个多渠道 AI 网关和个人 AI 助手平台。
TypeScript/Node.js，pnpm monorepo，Node.js ≥22.12.0，pnpm 10.23.0。
核心框架：`@mariozechner/pi-agent-core` 0.52.9。

## 保留渠道

Telegram, Discord, Slack, WhatsApp, 飞书

## 保留 Skills（20个）

evolver（已融合到 src/evolver/）, github, coding-agent, twitter, videogeneration,
gmail, calendar, notion, obsidian, 1password, crypto-trading,
webhook, cron, weather, nano-pdf, worldmonitor, google,
web-search, brave-search, novel-writer

## 保留能力

- 浏览器控制（browser tool）
- 前端/gateway
- config/onboard
- cron job, heartbeat
- AGENT.md, SOUL.md, MEMORY.md, identity.md，User.md

---

# 架构重构实施计划 V3

## 核心原则

- **动态优于固定**：所有阈值、数量均动态调整，不硬编码
- **渐进式实施**：每个阶段独立可验证
- **安全第一**：沙盒测试 → 部署 → 失败回滚 → 错误记录

---

## 阶段 1: Evolve 能力增强（已完成 — 融合到 src/evolver/）

**目标**: 让 Evolve 能够安全地优化 src/ 核心代码

**已完成**: Evolver 已从 `skills/evolver-1.10.0/` 完全融合到 `src/evolver/`，配置简化为仅保留 `review` 开关。

**保留**: `/evolve` 命令及逻辑完整保留（开启/关闭/查看 status）

### 1.1 Evolver 集成架构

**核心文件**（均在 `src/evolver/`）:

- `runner.ts` — 集成 TypeScript runner（替代原 index.js + daemon）
- `daemon-entry.ts` — daemon 启动入口（由 `src/agents/evolver.ts` spawn）
- `code-agent.ts` — 代码修改能力（create/edit/delete + sandbox 验证 + 回滚）
- `evolve.js` — 核心进化引擎

**GEP 协议**（`src/evolver/gep/`）:

- `src-optimizer.ts` — src/ 优化器，6 个预定义 Genes
- `sandbox-runner.ts` — 沙盒测试（Docker / 子进程隔离 / tmpdir 副本）
- `solidify.ts` — 验证 + 沙盒测试 → 部署/回滚
- `signals.ts` — 信号提取（含 SLOW_RESPONSE, MEMORY_LEAK, HIGH_TOKEN_USAGE 等）
- `prompt.ts`, `mutation.ts`, `crossover.ts`, `capsule.ts` 等

**运维模块**（`src/evolver/ops/`）:

- `lifecycle.ts` — 进程生命周期管理
- `build-verify.ts` — 构建验证
- `error-record.ts` — 错误记录

**资产文件**（`src/evolver/assets/gep/`）:

- `errors.jsonl` — 失败详情记录（改动文件、测试输出、堆栈）
- `feedback.jsonl` — 用户反馈（隐式 + 显式）
- `context_params.json` — 动态上下文超参数

**用户反馈采集**:

- 隐式：重复提问、纠正回复、中断工具、对话轮次异常多
- 显式：`/feedback` 命令，关联 context_params 快照
- 反馈信号注入 Memory Graph，影响参数调优方向

### 1.2 CI/CD 集成

- `.github/workflows/evolver-validate.yml` — 监控 src/ 变更
- Evolver Daemon 支持 `src-optimize` 模式
- 单线程运行，后台沙盒，出错自动重启

---

## 阶段 2: Skills 兼容性验证

**目标**: 确保 15 个核心 skills 与新架构兼容

### 2.1 兼容性测试套件

- **新建**: `test/skills-compatibility.test.ts`
- 测试：加载、异步工具兼容、向量化输出、单session兼容

### 2.2 运行测试并适配

- 检查 subagent 依赖（预期无）
- 如需适配则创建迁移指南

---

## 阶段 3: 架构改造

### 3.1 单一 Session 锁定（已完成 ✅）

**新建**: `src/agents/session-lock.ts`

**已完成**:

- ✅ 新建 `session-lock.ts` — 单 session 写锁（含 symlink 解析、stale 回收、信号清理）
- ✅ 移除 subagent 工具注册（openclaw-tools.ts, verso-tools.ts — sessions-spawn/list/send）
- ✅ 移除 gateway subagent init（server.impl.ts — initSubagentRegistry）
- ✅ 移除 abort 中 subagent stop 逻辑（abort.ts — stopSubagentsForRequester）
- ✅ 移除 status 中 subagent 显示（commands-status.ts）
- ✅ 移除 session 中 subagent 引用（commands-session.ts, commands-core.ts）
- ✅ 移除 cron 中 subagent announce 流程（isolated-agent/run.ts — 改为 deliverOutboundPayloads）
- ✅ 移除 gateway sessions.delete 中 stopSubagentsForRequester 调用
- ✅ 保留 backward-compat stubs（pi-tools.policy.ts, session-key-utils.ts）

**已删除（30+ 文件）**:

- `src/agents/subagent-registry.ts`, `subagent-registry.store.ts`, `subagent-announce.ts`
- `src/agents/subagent-announce-queue.ts`, `subagents-utils.ts`
- `src/agents/tools/sessions-spawn-tool.ts`, `sessions-list-tool.ts`, `sessions-send-tool.ts`
- `src/agents/tools/sessions-send-tool.a2a.ts`, `sessions-announce-target.ts`, `sessions-send-helpers.ts`, `sessions-helpers.ts`
- 12 subagent spawn test files（openclaw-tools.subagents._.test.ts × 6, verso-tools.subagents._.test.ts × 6）
- `docs/tools/subagents.md`, `docs/zh-CN/tools/subagents.md`
- All related test files (registry persistence, announce format, etc.)

---

### 3.2 动态上下文检索（核心改造 — 已完成 ✅）

**核心设计**: 不使用固定 top-k 或固定近期消息数，一切动态。

#### 3.2.1 动态上下文构建器（已完成 ✅）

**新建**: `src/agents/dynamic-context.ts` — 340 LOC，全英文注释

已实现:

- ✅ `buildDynamicContext()` — 主入口，动态合并近期消息 + 向量检索
- ✅ `selectRecentMessages()` — 基于 token 预算动态保留近期消息
- ✅ `filterRetrievedChunks()` — 基于相似度阈值动态过滤 + MMR 多样性选择
- ✅ `mmrSelect()` — MMR 贪心选择，最大化边际信息量（λ _ relevance - (1-λ) _ max_sim）
- ✅ `bigramJaccard()` — bigram Jaccard 相似度，作为 MMR 中 chunk 间相似度代理
- ✅ `computeDynamicRecentRatio()` — 根据对话节奏动态调整比例
- ✅ `timeDecayFactor()` — 时间衰减：exp(-λ \* hoursAgo)
- ✅ `loadContextParams()` — 从 evolver assets 加载可调超参数
- ✅ 集成到 `pi-embedded-runner/run/attempt.ts`（feature-gated: `dynamicContext !== false`）
- ✅ retrievedChunks 注入：检索到的记忆片段作为 `<memory-context>` 合成消息注入 finalMessages
- ✅ 写入端信息增益过滤：`indexFile` 中跨文件去重（同 source），cosine distance < 0.05 的冗余 chunk 跳过写入
- ✅ 新增 cache trace stage: `session:dynamic-context`
- ✅ 配置类型扩展: `types.agent-defaults.ts` 增加 `dynamicContext?: boolean`

上下文由两部分动态合并：

**A. 动态近期消息保留**:

- 不固定保留 N 条消息，而是根据「token 预算」动态截取
- 最近的消息权重最高，完整保留
- 越往前的消息权重越低，优先被截断/摘要化
- 算法：
  ```
  budget = totalContextLimit * recentRatio  // recentRatio 动态调整
  从最新消息开始向前累加 token
  当累计 token < budget 时，完整保留
  超出 budget 的消息不直接保留，交给向量检索
  ```
- recentRatio 动态调整依据：
  - 对话节奏快（连续短消息）→ ratio 升高，保留更多近期消息
  - 对话中包含大量工具调用结果 → ratio 降低，为检索留空间
  - 用户明确引用历史话题 → ratio 降低，检索权重增加

**B. L0/L1/L2 渐进式向量检索**（参考 OpenViking 架构）:

三层信息粒度，渐进加载：

| 层级 | 内容              | Token | 生成时机                     | 用途                    |
| ---- | ----------------- | ----- | ---------------------------- | ----------------------- |
| L0   | 摘要（首句/标题） | ~100  | 索引时同步生成（无 LLM）     | 文件级预过滤 + 向量搜索 |
| L1   | 结构化概览        | ~500  | 后台异步生成（启发式或 LLM） | 中等粒度上下文填充      |
| L2   | 完整原文          | 无限  | 已有（chunk text）           | 按需加载高价值片段      |

- 不使用固定 top-k，基于**相似度阈值**动态返回（保留原有阈值机制）
- 检索结果经 **MMR（Maximal Marginal Relevance）** 多样性重排序，最大化边际信息量：
  - `MMR(cᵢ) = λ * relevance(cᵢ) - (1-λ) * max_{cⱼ ∈ selected} sim(cᵢ, cⱼ)`
  - 使用 bigram Jaccard 作为 chunk 间相似度代理（无需 embedding 向量）
  - λ = `mmrLambda`（默认 0.6），可由 evolver 调优
- 检索采用**分层算法**（可选，`hierarchicalSearch` flag 控制）：

  ```
  Phase 1: 文件级预过滤
    1. 用 query embedding 在 files_vec 中搜索 → top-N 文件
    2. 在 files_fts 中关键词搜索 → top-N 文件
    3. 混合合并（fileVectorWeight * vector + fileBm25Weight * bm25）

  Phase 2: Chunk 级搜索 + 分数传播
    1. 在 top 文件的 chunks 中搜索
    2. 分数传播: final_score = α * chunk_score + (1-α) * file_score
    3. 提前终止: top-k 连续 convergenceRounds 轮不变 → 停止
  ```

- 分层检索为默认模式，flat search 仅作为错误回退
- 时间衰减：`score *= exp(-λ * hoursAgo)`, λ = timeDecayLambda

**C. 渐进式加载 + 合并策略**:

```
totalBudget = contextLimit - systemPromptTokens - reserveForReply
recentBudget = totalBudget * dynamicRecentRatio()
retrievalBudget = totalBudget - recentBudget

渐进式加载（progressiveLoadingEnabled = true 时启用）：
  1. 所有候选先通过阈值过滤 + 时间衰减
  2. MMR 多样性重排序（最大化边际信息量，消除冗余）
  3. 按 MMR 排序，逐个装入 retrievalBudget：
     - 优先 L2（全文 snippet），放得下则用
     - 放不下 → L1（概览），可用且放得下
     - 放不下 → L0（摘要），一定放得下
  4. 最大化 budget 内的信息密度和多样性

context = [
  ...systemPrompt,
  ...compactionSummary (if exists),
  <memory-context>retrievedChunks</memory-context> (合成 user message，L0/L1/L2 混合),
  ...recentMessages (动态保留的近期消息),
  currentUserMessage
]
```

**关键实现文件**:

- `src/agents/dynamic-context.ts` — 上下文构建器 + 渐进式加载 ✅
- `src/agents/pi-embedded-runner/run/attempt.ts` — 集成动态上下文 ✅
- `src/evolver/assets/gep/context_params.json` — 超参数配置 ✅
- `src/memory/manager.ts` — 索引流程（L0 生成 + 文件级向量 + 信息增益过滤）+ 搜索分层调度
- `src/memory/manager-search.ts` — chunk 级 + 文件级检索
- `src/memory/manager-hierarchical-search.ts` — 分层检索（Phase 1 + Phase 2 + 分数传播）
- `src/memory/manager-l1-generator.ts` — L1 后台生成器（启发式 + 可选 LLM）
- `src/memory/internal.ts` — L0 生成函数（`generateL0Abstract`, `generateFileL0`）

#### 3.2.2 实时向量化 + 信息增益过滤

**修改**: `src/memory/manager.ts`

- 每轮对话结束后，立即将新消息向量化存入 sqlite-vec
- 使用现有 hybrid search 架构（Vector 0.7 + BM25 0.3）
- 利用现有 embedding provider（OpenAI/Gemini/Voyage/Local）
- **写入端信息增益过滤**：`indexFile` 在写入前检查每个新 chunk 是否与同 source 已有 chunk 冗余
  - 用 sqlite-vec ANN 搜索最近邻，cosine distance < `1 - redundancyThreshold`（默认 0.05）→ 跳过写入
  - 排除同文件（同文件内 chunk 更新是正常的），只跨文件去重
  - sqlite-vec 不可用时跳过去重，保持原有行为

#### 3.2.3 Compact/Flush 角色调整

Compact 和 Flush 从「防止历史溢出」转变为「安全网」：

- **触发条件改变**: 不再基于消息历史长度，而是基于：
  - 系统提示膨胀
  - 单次工具返回结果过大
  - 动态上下文构建后仍超限（极端情况）
- **Flush**: 仍在 compact 前保存重要信息到 memory/
- **Compact**: 生成摘要存入 compactionSummary，作为上下文的一部分

#### 3.2.4 超参数自动调优（Evolver 驱动 — 配置已就绪 ✅）

所有动态上下文参数均可被 Evolver 根据实际使用情况自动优化：

**可调参数清单**:

```
context_params.json:
{
  // 基础检索参数
  "baseThreshold": 0.72,        // 向量检索相似度阈值
  "thresholdFloor": 0.5,        // 阈值下限（无结果时降级）
  "timeDecayLambda": 0.01,      // 时间衰减系数 λ
  "recentRatioBase": 0.4,       // 近期消息基础占比
  "recentRatioMin": 0.2,        // 近期消息最低占比
  "recentRatioMax": 0.7,        // 近期消息最高占比
  "hybridVectorWeight": 0.7,    // 混合检索中向量权重
  "hybridBm25Weight": 0.3,      // 混合检索中 BM25 权重
  "compactSafetyMargin": 1.2,   // compact 安全系数
  "flushSoftThreshold": 4000,   // flush 软阈值 tokens

  // 分层检索参数
  "hierarchicalSearch": true,            // 分层检索（默认启用，文件级预过滤 → chunk 级搜索）
  "hierarchicalFileLimit": 10,           // Phase 1 返回的 top-N 文件数
  "hierarchicalAlpha": 0.7,              // 分数传播系数 α（chunk vs file 权重）
  "hierarchicalConvergenceRounds": 3,    // 提前终止：top-k 不变轮数
  "fileVectorWeight": 0.7,              // 文件级混合检索向量权重
  "fileBm25Weight": 0.3,               // 文件级混合检索 BM25 权重

  // L0/L1 生成参数
  "l0EmbeddingEnabled": true,           // 生成并存储文件级 L0 embedding
  "l1GenerationEnabled": true,          // 启用 L1 后台生成
  "l1UseLlm": false,                    // L1 使用 LLM 生成（true）还是启发式（false）
  "l1LlmRateLimitMs": 10000,           // L1 LLM 调用最小间隔

  // 渐进式加载参数
  "progressiveLoadingEnabled": true,    // 启用 L0/L1/L2 渐进式加载
  "progressiveL2MaxChunks": 5,         // L2 全文加载的最大 chunk 数

  // 信息论优化参数
  "mmrLambda": 0.6,                    // MMR 多样性权重（0=纯多样性, 1=纯相关性）
  "redundancyThreshold": 0.95          // 写入端去重阈值（cosine similarity > 此值视为冗余）
}
```

**优化机制**:

- **存储**: `src/evolver/assets/gep/context_params.json`
- **信号采集**: Evolver 从运行日志中提取效果指标：
  - 检索命中率（用户后续引用了检索到的内容？）
  - token 使用效率（input tokens / 回复质量）
  - compact 触发频率（越低越好）
  - 上下文丢失率（用户重复提问相同内容的频率）
- **调优策略**: GEP Mutation，每次只调整 1-2 个参数，小步变动（±5-10%）
- **验证**: 对比调整前后 N 轮对话的效果指标
- **回滚**: 指标恶化 → 自动回滚参数 → 记录到 errors.jsonl
- **新增 Gene**: `context_hyperparameter_tuning`，加入 src-optimizer.js 的 Gene 池

---

### 3.3 异步 Agent Turn 执行（已完成 ✅）

**核心设计**：整个 agent turn（包含多次 tool_use → tool_result 自驱动循环）作为一个完整的异步任务运行。Turn 执行层与消息 I/O 层完全解耦。

**已实现**:

- ✅ `dispatch-from-config.ts` — I/O 层异步化：opt-in `asyncDispatch` flag
  - 有 active run → `queueEmbeddedPiMessage()` steer 注入
  - 无 active run → fire-and-forget 启动新 turn
  - 默认同步（保留原有行为），`cfg.agents.defaults.asyncDispatch === true` 启用
- ✅ `tool-resume.ts` — Turn 完成后的通知和状态恢复逻辑
- ✅ `dispatch-from-config.async.test.ts` — 4 个测试用例（sync/steer/fire-and-forget/fallback）
- ✅ 配置类型扩展: `types.agent-defaults.ts` 增加 `asyncDispatch?: boolean`

**分层架构**：

```
┌─────────────────────────────────────────────────────────┐
│              消息 I/O 层 (Message I/O Layer)              │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ 用户消息  │    │ Agent 回复│    │ 工具执行状态通知  │   │
│  │ (inbound) │    │(outbound)│    │ (status updates) │   │
│  └────┬─────┘    └────▲─────┘    └────────▲─────────┘   │
│       │               │                   │             │
│       │    steer()     │    stream()       │             │
└───────┼───────────────┼───────────────────┼─────────────┘
        │               │                   │
┌───────▼───────────────┼───────────────────┼─────────────┐
│         异步 Agent Turn 执行层 (Async Turn Layer)        │
│                                                         │
│  activeSession.prompt() →                               │
│    [LLM → text_delta → 推到 I/O 层（agent 回复用户）]    │
│    [LLM → tool_use → 执行工具 → tool_result → 继续]     │
│    [LLM → text_delta → 推到 I/O 层（agent 回复用户）]    │
│    ... 自驱动循环直到 end_turn                            │
└─────────────────────────────────────────────────────────┘
```

**两层职责明确分离**：

1. **Turn 执行层**（纯计算）：
   - 管理 LLM 调用循环：prompt → tool_use → 执行工具 → tool_result → 继续 → ... → end_turn
   - 每次 stop_reason 为 tool_use 时，自动执行工具并将 tool_result 注入，自发进入下一轮
   - 持续自驱动直到 stop_reason 为 end_turn
   - 不直接与用户交互，只通过事件通道推送

2. **消息 I/O 层**（纯通信）：
   - 接收用户消息 → 通过 steer() 注入到 active turn
   - 接收 agent 的 text_delta → 流式推送给用户（各渠道 adapter）
   - 接收工具执行状态 → 通知用户（typing indicator / 状态更新）
   - 不关心 turn 内部执行逻辑

**当前架构**（阻塞式，I/O 和 Turn 耦合）：

```
用户消息 → dispatchReplyFromConfig → await runEmbeddedPiAgent →
  session lock → activeSession.prompt() →
  [SDK 内部循环: LLM→tool_use→tool执行→LLM→...→end_turn] →
  release lock → 返回（此期间阻塞新消息处理）
```

**目标架构**（异步式，I/O 和 Turn 解耦）：

```
I/O 层:
  用户消息到达 → 检查 active run →
    有 active run → steer() 注入（不阻塞）
    无 active run → 触发新 turn（fire-and-forget）

Turn 层 (后台运行):
  session lock → activeSession.prompt() →
  [SDK 自驱动循环:
    LLM → text_delta → 事件推送到 I/O 层 → agent 回复用户
    LLM → tool_use → 执行工具 → tool_result → 自动进入下一轮
    LLM → text_delta → 事件推送到 I/O 层 → agent 回复用户
    ... 持续直到 end_turn] →
  release lock → 发送完成事件到 I/O 层
```

**关键要点**：

- Agent turn 内部由 SDK (`pi-agent-core`) 自动驱动 tool_use → tool_result 循环
- `activeSession.prompt()` 已经包含完整的 agent turn 直到 `end_turn`
- Agent 在 turn 期间通过事件通道产生 text_delta，I/O 层负责推送给用户
- 新用户消息通过 I/O 层的 `steer()` 注入到 turn（不干扰 turn 执行逻辑）
- I/O 层不需要知道 turn 内部状态（tool_use / end_turn 等），只处理消息流

**修改文件**:

- `src/auto-reply/reply/dispatch-from-config.ts` — I/O 层：将 `await runEmbeddedPiAgent()` 改为 fire-and-forget
- `src/auto-reply/reply/agent-runner-execution.ts` — Turn 层：异步化 turn 执行
- `src/agents/pi-embedded-runner/runs.ts` — I/O 层：消息路由，新消息优先 steer() 到 active run
- `src/agents/pi-embedded-subscribe.handlers.messages.ts` — I/O 层：text_delta 事件转发

**新建**:

- `src/agents/tool-resume.ts` — Turn 完成后的通知和状态恢复逻辑

**复用现有基础设施**:

- `activeSession.prompt()` — SDK 已处理 tool_use 自驱动循环
- `queueEmbeddedPiMessage()` + `steer()` — 已有消息注入机制
- `setActiveEmbeddedRun()` / `clearActiveEmbeddedRun()` — 已有 active run 追踪
- 事件订阅系统（message*update / tool_execution*\* / agent_end） — 已有 I/O 事件通道

### 3.4 System Prompt 优化：移除 Memory Folder 搜索

**背景**：既然消息已即时向量化到 sqlite-vec，不再需要在 system prompt 中指示 agent 手动搜索 memory 文件夹。

**修改**:

- `src/agents/system-prompt.ts` — 移除 `buildMemorySection()` 中的 memory_search 指示
- 保留 MEMORY.md / identity 文件加载（用于身份和配置，不是对话记忆）
- memory_search / memory_get 工具保留（用于显式记忆操作），但不再在 system prompt 中强制要求使用

---

## 阶段 4: 代码瘦身（已完成）

**保留不动**:

- `src/gateway/` — 前端/Web UI 及 gateway 完整保留
- `src/wizard/` — config/onboarding 流程完整保留
- `src/config/` — 配置体系完整保留
- cron job / heartbeat 机制 — 完整保留
- `AGENT.md` / `SOUL.md`/ `MEMORY.md` / `identity.md`/`User.md` 等身份/记忆文件 — 完整保留

### 4.1 移除非保留渠道（已完成 ✅）

- ✅ 删除 Signal（src/signal/, extensions/signal/, plugins）
- ✅ 删除 iMessage（src/imessage/, extensions/imessage/, plugins）
- ✅ 删除 Line（src/line/, extensions/line/）
- ✅ 清理 types.ts, config/schema.ts, plugin-sdk/index.ts 等残留引用
- 保留：Telegram, Discord, Slack, WhatsApp, 飞书

### 4.2 移除废弃代码（已完成 ✅）

- ✅ 移除所有 Signal/iMessage/Line 相关代码和引用
- ✅ 清理 deliver.ts, outbound-session.ts, route-reply.ts 中的死分支
- ✅ 修复 types.ts 残留 `types.imessage.js` / `types.signal.js` re-export
- ✅ 删除 skills/evolver-1.10.0/（已融合到 src/evolver/）
- ✅ 删除 canvas/（死目录，仅 1 个 HTML）
- ✅ 删除 ghost/（死目录，单个分析 HTML）

### 4.3 依赖清理（已完成 ✅）

- ✅ 移除 `@line/bot-sdk`
- ✅ 确认 `signal-utils` 是 UI 响应式库（非 Signal 渠道），保留

### 4.4 spawn EBADF 优化（已完成 ✅）

- 并发限制: DEFAULT_MAX_CONCURRENT=50（env: PI_BASH_MAX_CONCURRENT）
- `canSpawnProcess()` / `waitForSpawnSlot()` 门控（满时等 30s）
- `cleanupChildStreams()` 进程退出时显式释放 FD
- sweeper 自动回收 >10min 未退出的僵尸进程
- spawn-utils.ts 重试延迟改为指数退避 200ms\*(index+1)

---

## 阶段 5: 结构性重构

**目标**: 降低模块复杂度，减少耦合，提升开发效率

### 当前代码体量（重构前基线）

| 模块     | 体量 | 文件数 | 核心问题                                           |
| -------- | ---- | ------ | -------------------------------------------------- |
| agents/  | 3.9M | 336    | 混合 runner/bash/PI/auth，高耦合                   |
| evolver/ | 3.2M | 混合   | JS+TS 双语言（GEP 全是 JS）                        |
| gateway/ | 1.7M | 高     | 消息路由 + WebSocket + model profiles 交织         |
| config/  | 980K | 127    | 279 个 config 类型；15+ legacy 迁移文件            |
| infra/   | 1.4M | 127    | 杂物抽屉：dedupe/heartbeat/exec-approvals/env 混杂 |
| memory/  | 416K | -      | manager.ts 2411 LOC 单体                           |

### 5.1 Config 模块精简

**问题**: 127 文件，15+ legacy 迁移文件（legacy.ts, legacy.migrations.part-1~3.ts 等），9 个 legacy 测试

**方案**:

- 归档 `legacy.*.ts` 系列（15+文件） → 单文件 `legacy-compat.ts` + feature flag
- 目标：127 文件 → ~30-40 文件，体量减少 40-50%

**涉及文件**: legacy.ts, legacy.shared.ts, legacy.migrations.ts, legacy.migrations.part-1~3.ts, legacy-migrate.ts, legacy.rules.ts, doctor-legacy-config.ts + test, config.legacy-config-detection.\*.test.ts (9个)

### 5.2 Infra 模块拆分（已完成 ✅）

**问题**: 127 文件混杂不相关功能

**已完成**: 按领域重组

```
src/infra/ → 精简为核心基础设施
src/approval/ ← exec-approvals.ts, exec-approval-forwarder.ts, exec-host.ts, exec-safety.ts, exec-command-parser.ts ✅
src/heartbeat/ ← heartbeat-runner.ts, heartbeat-events.ts, heartbeat-visibility.ts, heartbeat-wake.ts ✅
src/env/ ← dotenv.ts, home-dir.ts, path-env.ts, shell-env.ts ✅
```

### 5.3 单体文件分解（>1000 LOC）（已完成 ✅）

| 文件                      | 原 LOC | 现 LOC | 拆分结果                                                                                                                                                   |
| ------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| telegram/bot.test.ts      | 3029   | 已删除 | → 10 个独立测试文件 + bot-test-helpers.ts                                                                                                                  |
| memory/manager.ts         | 2411   | 1452   | → manager-vectors.ts + manager-session-delta.ts + manager-embeddings.ts + manager-batch-failure.ts + manager-embedding-cache.ts + manager-session-files.ts |
| agents/bash-tools.exec.ts | 1692   | 564    | → exec-spawn.ts + exec-approval-check.ts + exec-run-process.ts + exec-env.ts                                                                               |
| tts/tts.ts                | 1579   | 596    | → tts-config.ts + tts-providers.ts + tts-validators.ts + tts-preprocessor.ts                                                                               |
| node-host/runner.ts       | 1307   | 119    | → runner-ipc.ts + runner-exec-security.ts + runner-invoke.ts                                                                                               |
| cli/update-cli.ts         | 1356   | 279    | → update-cli-command.ts + update-cli-progress.ts                                                                                                           |
| infra/exec-approvals.ts   | 1541   | -      | 已在阶段 5.2 infra 拆分中处理（→ approval/ 模块）                                                                                                          |

### 5.4 重复逻辑统一（已完成 ✅）

**Deduplication 分析结果**: 4 处 dedupe 实现各有不同职责，非真正重复：

- `src/infra/dedupe.ts` — 通用 TTL+LRU 缓存工具（5 importers），基础设施
- `src/web/inbound/dedupe.ts` — WhatsApp 专用入站去重（1 importer），✅ 已内联到 monitor.ts
- `src/auto-reply/reply/inbound-dedupe.ts` — 多渠道入站去重（41 importers），独立职责
- `src/agents/pi-embedded-helpers/messaging-dedupe.ts` — 出站文本去重+归一化（3 importers），独立职责

**Test 工具合并**: `src/test-helpers/` 已移至 `src/test-utils/` ✅

### 5.5 Evolver GEP JS→TS 转换（已完成 ✅）

所有 GEP 文件已转换为 TypeScript，零残留 .js 文件：

- `src/evolver/gep/` — 21 个 .ts 文件（solidify.ts 33K, memoryGraph.ts 36K, prompt.ts 15K 等）
- `src/evolver/ops/` — 7 个 .ts 文件
- `src/evolver/` 根目录 — 4 个 .ts 文件（evolve.ts 44K, runner.ts, daemon-entry.ts, code-agent.ts）

### 5.6 死目录清理（已完成 ✅）

| 目录            | 状态                   | 处置                   |
| --------------- | ---------------------- | ---------------------- |
| canvas/         | 仅 1 个 HTML，无 TS    | ✅ 已删除              |
| ghost/          | 单个 17K HTML 分析文件 | ✅ 已删除              |
| packages/verso/ | 兼容 shim，仅 16 行    | 内联到主代码（待评估） |
| vendor/a2ui/    | 3.2M UI 规格，仅文档用 | 考虑外部依赖化         |

### 5.7 模块边界与导入规范

**问题**: 3,330 个跨模块父级导入（`../../../infra/...`），边界模糊

**方案**: 为核心模块定义 barrel export（index.ts），减少跨 3 层以上的相对导入，目标 < 500

### 5.8 Extensions 现状（32 个活跃）

渠道扩展（均健康）: telegram, discord, slack, whatsapp, feishu, mattermost, matrix, googlechat, twitch 等
功能扩展: device-pairing, phone-control, voice, copilot-proxy, diagnostics 等

无死 extension（Signal/iMessage/Line 已在阶段 4 移除）

### 5.9 Skills 现状（65 个，~20 核心保留）

**大型 skills**: videogeneration (312K), xiaohongshu (120K), novel-writer (80K), skill-creator (56K)
**小型 skills**: 28 个 <20K（健康粒度）
**待评估**: 剩余 ~45 个非核心 skills 可按需归档

---

## 关键文件清单

### 阶段 1（Evolve 增强 — 已融合到 src/evolver/）

**核心**: runner.ts, daemon-entry.ts, code-agent.ts, evolve.ts
**GEP**: src-optimizer.ts, sandbox-runner.ts, signals.ts, solidify.ts, prompt.ts, mutation.ts 等（全部已转 TypeScript）
**运维**: lifecycle.ts, build-verify.ts, error-record.ts
**资产**: errors.jsonl, feedback.jsonl, context_params.json
**CI**: evolver-validate.yml

### 阶段 2（Skills 兼容性）

**新建**: skills-compatibility.test.ts

### 阶段 3（架构改造 — 已完成 ✅）

**新建**: session-lock.ts, dynamic-context.ts, tool-resume.ts, dispatch-from-config.async.test.ts, context*params.json
**修改**: attempt.ts (dynamic context integration), dispatch-from-config.ts (async dispatch), types.agent-defaults.ts, cache-trace.ts
**删除**: subagent-*.ts (5+), sessions-\_-tool.ts (6+), subagent test files (12+), docs/tools/subagents.md
**Stubs**: pi-tools.policy.ts (resolveSubagentToolPolicy), session-key-utils.ts (isSubagentSessionKey)

### 阶段 4（代码瘦身 — 已完成 ✅）

**已删除**: src/signal/, src/imessage/, src/line/, extensions/signal|imessage|line/, skills/evolver-1.10.0/, canvas/, ghost/
**已修改**: types.ts, types.channels.ts, schema.ts, deliver.ts, outbound-session.ts, plugin-sdk/index.ts, bash-process-registry.ts, bash-tools.exec.ts, spawn-utils.ts 等 20+ 文件
**已移除依赖**: @line/bot-sdk

### 阶段 5（结构性重构 — 已完成 ✅）

**Config 精简**: legacy._.ts 分析完毕，均有活跃调用者，无需归档 ✅
**Infra 拆分**: infra/ → infra/ + approval/ + heartbeat/ + env/ ✅
**死目录**: canvas/, ghost/ 已删除 ✅
**残留引用清理**: openclaw→verso (hooks/tests), imsg tests 已修复 ✅
**重复统一**: 4 处 dedupe 分析完毕，各有独立职责（非真正重复），web/inbound/dedupe.ts 已内联 ✅
**GEP 转换**: evolver/gep/_.js 全部已转 TypeScript（21 个 .ts 文件，零残留 .js）✅
**单体分解**: ✅ 已完成

- telegram/bot.test.ts (3029→删除，拆分为 9 个测试文件)
- memory/manager.ts (2411→1451，提取 manager-vectors.ts, manager-session-delta.ts, manager-embeddings.ts, manager-batch-failure.ts)
- bash-tools.exec.ts (1679→564，提取 exec-run-process.ts, exec-approval-check.ts, exec-env.ts)
- tts/tts.ts (1579→596，提取 tts-config.ts, tts-providers.ts, tts-validators.ts, tts-preprocessor.ts)
- node-host/runner.ts (1307→119，提取 runner-invoke.ts, runner-ipc.ts, runner-exec-security.ts)
- update-cli.ts (1001→279，提取 update-cli-command.ts, update-cli-progress.ts)

---

## 验证标准

- Evolve 沙盒测试成功率 > 95%，失败自动回滚 100%
- 15 个核心 skills 100% 兼容
- `pnpm build` 0 错误，`pnpm test` 通过率 > 95%
- Input token 消耗降低 60-80%（动态上下文 vs 全量上下文）
- 异步工具执行成功率 > 99%，消息不丢失
- spawn EBADF：并发进程 ≤50，僵尸进程 10min 内回收

---

**计划版本**: 4.4
**创建日期**: 2026-02-14
**最后更新**: 2026-02-17
**当前状态**: 阶段 1-5 全部完成。信息论优化已实施：写入端信息增益过滤（跨文件去重）、检索端 MMR 多样性选择、retrievedChunks 注入修复。
**测试基线**: 998 files, 6785 tests, 0 failures
