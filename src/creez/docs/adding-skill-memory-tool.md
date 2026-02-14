# Creez：如何添加 Skill、Memory、Tool

本文在「深入看一遍」代码的基础上，说明三块能力的数据流、接入点，以及**你要加这些功能时具体该怎么做**。

---

## 一、Skill 深入与添加方式

### 1.1 数据流概览

```
[用户输入] → 可能包含 /skill:name 或 /template:name
       ↓
[展开] expand_skill_command(text, skills)  →  /skill:name [args] 变为 <skill ...>...</skill> + args
       ↓
[展开] expand_prompt_template(expanded, templates)  →  /xxx 模板替换
       ↓
[Agent] agent.prompt(expanded)  → 进入 LLM 上下文
```

同时，**system prompt** 里会列出「当前有哪些技能」：`build_system_prompt(..., skills=skills)` 会拼一段 `# Skills`，列出 `name + description + file_path`，让模型知道可以引用哪些技能。

### 1.2 桌面端 (Electron + pi-coding-agent)

- **技能来源**：`DefaultResourceLoader` 从以下位置发现 `*/SKILL.md`：
  - `cwd`（即 `config.workDir`）下的 `.pi/skills/`
  - `agentDir`（如 `.creez` 或 CONFIG_DIR）下的 `skills/`
  - 以及 Pi 默认的 `~/.pi/agent/skills` 等（若未关掉）
- **agent-runner.mjs** 里没有传 `tools`，所以用的是 Pi 默认的 `defaultActiveToolNames`（read, bash, edit, write）；也没有传 `skillsOverride`，所以技能完全由 `DefaultResourceLoader` 从目录发现。
- **如何添加新技能（桌面端）**：
  1. **方式 A（推荐）**：在工作目录下新建目录与文件：
     - `workDir/.pi/skills/<skill-name>/SKILL.md`
     - 内容：YAML frontmatter（`name`, `description`）+ Markdown body（给模型的说明与步骤）。
  2. **方式 B**：在 `agent-runner.mjs` 里给 `DefaultResourceLoader` 传 `skillsOverride`，在现有技能列表上追加或过滤（参考 pi 的 examples/sdk/04-skills.ts）：
     - `skillsOverride: (current) => ({ skills: [...current.skills, customSkill], diagnostics: current.diagnostics })`
  3. 前端已有 `/skill:xxx` 补全，会调 `window.creez.listSkills(workDir)`，只要 `SKILL.md` 在 `workDir/.pi/skills/<name>/` 下就会出现在补全里。

### 1.3 后端 (mcp_host_backend)

- **技能加载**：`Agent/resources/skills.py` 的 `load_skills(*dirs)` 接受多个 `Path`，在每个目录下做 `*/SKILL.md` 的 glob，解析 frontmatter + body，返回 `list[Skill]`。
- **当前传入的目录**（见 `agent_session_on_supabase.py` 和 `agent_session.py`）：
  - 项目：`resolved_cwd / ".pi" / "skills"`（即沙盒根下的 `.pi/skills`）
  - 全局：`data_dir / "skills"`（如 `~/.pi-py/skills`）、`Path.home() / ".pi" / "agent" / "skills"`
- **如何添加新技能（后端）**：
  1. **方式 A**：在「项目沙盒」里放技能——保证 `~/.pi/ProjectContent/{project_id}/.pi/skills/<name>/SKILL.md` 存在；即同步项目内容到沙盒时包含 `.pi/skills` 目录。
  2. **方式 B**：在全局目录放技能——在 `~/.pi-py/skills/` 或 `~/.pi/agent/skills/` 下新建 `<name>/SKILL.md`，所有项目共用。
  3. **方式 C**：代码里增加一个技能来源目录：在 `load_skills(...)` 的调用处多传一个 `Path`（例如从配置或环境变量读的目录）。

### 1.4 Skill 小结

| 端 | 添加方式 |
|----|----------|
| 桌面端 | 在 `workDir/.pi/skills/<name>/SKILL.md` 新建；或 `agent-runner.mjs` 里用 `skillsOverride` 注入 |
| 后端 | 在沙盒 `cwd/.pi/skills/<name>/SKILL.md` 或全局 `~/.pi-py/skills/`、`~/.pi/agent/skills/` 下新建；或扩展 `load_skills` 的目录列表 |

---

## 二、Tool 深入与添加方式

### 2.1 后端 (mcp_host_backend) 的 Tool 链

- **定义**：每个 Tool 是 `Agent/tools/base.py` 里 `Tool` 的子类，必须实现：
  - 类属性/成员：`name`, `description`, `parameters`（JSON Schema 对象）
  - 方法：`async def execute(self, tool_call_id, args, *, on_update=None, abort=None) -> ToolResult`
- **注册**：在 `Agent/core/agent_session_on_supabase.py`（以及 `agent_session.py`）的 `create()` 里，用 `ToolRegistry([...])` 把工具列表传给 `Agent`；当前列表是：
  - `ReadFileTool(sandbox)`, `WriteFileTool(sandbox)`, `EditFileTool(sandbox)`, `BashTool(sandbox)`
- **执行**：`Agent/agent/loop.py` 的 `agent_loop` 里，当模型返回 tool call 时，`config.tools.get(tc.name)` 取工具，然后 `tool.execute(tc.id, args)`，其中 `args` 会先与 `config.extra_tool_args`（即 `run_context`：user_id, chat_id, project_id）合并，因此你的 tool 可以从 args 里拿到这些上下文。
- **沙盒**：所有文件类工具都通过 `LocalSandbox(sandbox.root)` 解析路径，禁止逃逸到 root 外。

**添加新 Tool（后端）步骤：**

1. 在 `Agent/tools/` 下新建一个模块（或写在现有 `fs.py` / `bash.py` 旁），定义类，继承 `Tool`，实现 `name`、`description`、`parameters`、`execute`。
2. 若需要访问文件系统，注入 `LocalSandbox`（或项目沙盒），在 `execute` 里用 `self.sandbox.resolve_path(args["path"])` 等安全解析路径。
3. 在 `Agent/core/agent_session_on_supabase.py` 的 `ToolRegistry([...])` 里加入你的工具实例；若用本地 session，同样在 `agent_session.py` 里加入。
4. 在 `Agent/tools/__init__.py` 的 `__all__` 里导出新类（可选，便于统一导入）。

示例（仅示意）：

```python
# Agent/tools/my_tool.py
from Agent.tools.base import Tool, ToolResult
from Agent.models import TextContent

class MyTool(Tool):
    name = "my_tool"
    description = "做某件事"
    parameters = {"type": "object", "properties": {"key": {"type": "string"}}, "required": ["key"]}

    async def execute(self, tool_call_id: str, args: dict, *, on_update=None, abort=None) -> ToolResult:
        key = args.get("key", "")
        return ToolResult(content=[TextContent(text=f"Done: {key}")], details={})
```

然后在 session 的 `create()` 里：`ToolRegistry([..., MyTool()])`。

### 2.2 桌面端 (Pi) 的 Tool

- Creez 的 `agent-runner.mjs` 调用 `createAgentSession({ cwd, agentDir, model, sessionManager, resourceLoader, ... })`，**没有传 `tools`**，因此 Pi 使用默认工具集（read, bash, edit, write 等），且这些工具会使用传入的 `cwd` 作为工作目录。
- **要加自定义工具（桌面端）**有两种方式：
  1. **传 `tools`**：像 Pi 的 05-tools 示例，使用 `createCodingTools(cwd)` 或 `[createReadTool(cwd), createBashTool(cwd), ...]`；若要「只读」可传 `readOnlyTools`。这样仍然是 Pi 内置工具，只是显式指定集合和 cwd。
  2. **扩展里注册**：通过 `DefaultResourceLoader` 的 `extensionFactories` 或额外扩展路径，在扩展里调用 `pi.registerTool({ name, label, description, parameters, execute })`（见 06-extensions.ts）。扩展会在 `resourceLoader.reload()` 时加载，因此需要在 `createAndSubscribe` 里给 `DefaultResourceLoader` 传 `additionalExtensionPaths` 或 `extensionFactories`，在工厂里拿到 `pi` 并 `registerTool`。

---

## 三、Memory 深入与添加方式

### 3.1 当前「记忆」相关实现

- **会话历史（对话历史）**：
  - **后端**：`SupabaseSessionStore` 按 `user_id`/`chat_id`/`project_id` 存每条 message；`append()` 写 cache + buffer，`flush()` 把 buffer 插入 DB。但有一个重要缺口：**创建 session 和调用 `prompt()` 时，并没有从 store 里 `load()` 历史消息并灌进 `agent.state.messages`**，因此每次请求的 context 都是「空历史 + 当前一条用户消息」，多轮对话的连续性在后端目前是断的。
  - **桌面端**：Pi 的 `SessionManager` 持久化在 `agentDir/sessions/<encoded-workDir>/`，由 Pi 内部在会话恢复时加载，所以桌面端多轮是连贯的。
- **长期记忆**：目前没有「记住/回忆」的抽象，没有 key-value 或向量记忆模块。

### 3.2 若要添加「对话历史」连续性（后端）

目标：每次 `prompt(text)` 时，先加载该会话已有消息，再拼上当前用户消息，这样 LLM 能看到完整多轮。

**建议改法：**

1. 在 `AgentSessionOnSupabase.prompt()` 里、调用 `await self.agent.prompt(expanded)` **之前**，从 session 加载历史并写入 agent state：
   - `history = self.session_store.load(self.session_ref)`
   - 将 `history` 转成 `Message` 列表（若 store 返回的已是 `Message` 则直接用），然后设到 `self.agent.state.messages`（注意：Agent 的 `_state.messages` 可能是只读属性，若没有 setter，需要在 Agent 上增加一个 `set_messages` 或类似方法，或在创建 Agent 时通过 `initial_state=AgentState(messages=...)` 传入；更稳妥的是在 session 的 `prompt()` 里先 `self.agent.state.messages.clear()` 再 `self.agent.state.messages.extend(history)`，若 state 暴露的是 list 引用）。
2. 查一下 `AgentState` 的 `messages` 是否是 `field(default_factory=list)` 的可变 list；若是，则可以在 session 里直接 `self.agent._state.messages.clear()` 与 `self.agent._state.messages.extend(history)`，再 `await self.agent.prompt(expanded)`。这样本次 loop 的 `context.messages` 就会是「历史 + 当前用户消息」。
3. 注意：当前实现里每次请求都会 `AgentSessionOnSupabase.create()` 一个新 session（见 `agentic_runner_agent.py` 的 `_create_agent_session_for_project`），所以每次都是新 agent、新 state；若希望多轮连续，要么在同一个 session 上多次 `prompt()`（即复用同一个 AgentSession 实例），要么在每次创建后、第一次 `prompt()` 前按上面方式加载该 chat 的 history 进 state。

若你希望「每次 HTTP 请求仍创建新 session 实例」，则更合适的做法是：在 `prompt()` 开头加载历史到 `agent.state.messages`，再 append 当前用户消息并调用 `agent.prompt(expanded)`（或直接 `prompt_messages([user_msg])` 且保证 state.messages 里已有历史）。这样无需改「每次创建 session」的架构，只需在 prompt 路径上补一次 load。

### 3.3 若要添加「长期记忆」（跨轮、跨会话）

需要单独一块存储和两个能力：**写入**、**读取并注入**。

**存储形态建议：**

- **键值型**：例如 Supabase 表 `agent_memories`，字段如 `user_id`, `project_id`, `scope`（user|project|chat）, `key`, `content`, `updated_at`；或桌面端用 `workDir/.pi/memory/*.json`。
- **向量型**（可选）：用现有 `qdrant_integration`，按 project_id/user_id 做 namespace，存 embedding，检索时 recall top-k 再注入 context。

**写入方式二选一或并存：**

1. **Tool**：提供 `remember(key, value, scope?)`（及可选的 `forget(key)`），由模型在对话中调用。
2. **解析 LLM 输出**：在 assistant 回复里识别结构化标记（如 `<remember scope="project">...</remember>`），后端解析后写入 memory 存储，再在下一轮或本轮的 context 里可见（若你在同轮内做二次注入则需自己设计好顺序）。

**读取与注入：**

- 在**构建 system prompt** 或**在首条 user message 前插入一条 system/user 消息**时，根据当前 `user_id`/`project_id`/`chat_id` 从 memory 存储取出条目，格式化成一段「已知事实」文本，拼进 system 或作为一条只读的 context message。

**实现步骤建议：**

1. 定义 memory 存储接口（如 `list(user_id, project_id, scope)`、`get`、`set`、`delete`），后端用 Supabase 表或 JSON 文件实现，桌面端用 `.pi/memory/` 下文件实现。
2. 在后端 `build_system_prompt` 中增加一个参数 `memory_snippet: str | None`，在 session 的 `create()` 里调用 memory 的 list/get，拼成 `memory_snippet` 传入；或在 `prompt()` 里每次拼 context 时拉取 memory 并注入。
3. 若要通过 tool 写入：在 `Agent/tools/` 里加 `RememberTool`（和可选的 `RecallTool`），在 execute 里调 memory 存储的 set/get，并在 session 的 ToolRegistry 里注册。
4. 前端如需「记忆管理」界面，可增加 IPC/API：列出、删除指定 key 或 scope 的记忆。

---

## 四、对照表：我要加 XX，该动哪里

| 目标 | 桌面端 (Creez Electron) | 后端 (mcp_host_backend) |
|------|--------------------------|---------------------------|
| **新 Skill** | 在 `workDir/.pi/skills/<name>/SKILL.md` 新建；或改 `agent-runner.mjs` 的 `DefaultResourceLoader` 的 `skillsOverride` | 在沙盒或全局 `.pi/skills/<name>/SKILL.md` 新建；或在 `load_skills()` 调用处增加目录 |
| **新 Tool** | 在 `agent-runner.mjs` 用 `extensionFactories` 里 `pi.registerTool(...)`；或传 `tools: createCodingTools(cwd)` 等 | 在 `Agent/tools/` 新写 Tool 子类，并在 `agent_session_on_supabase.py` 的 `ToolRegistry([...])` 里注册 |
| **对话历史连续（多轮）** | 已由 Pi SessionManager 负责 | 在 `AgentSessionOnSupabase.prompt()` 开头 `session_store.load(session_ref)` 灌入 `agent.state.messages`，再 prompt |
| **长期 Memory** | 定义 `.pi/memory/` 格式 + IPC；可选在扩展里提供 remember/recall tool | 新表/存储 + `build_system_prompt` 注入 memory 文本 + 可选 `RememberTool`/`RecallTool` |

---

## 五、关键文件索引

| 能力 | 桌面端 | 后端 |
|------|--------|------|
| Skill 加载/展开 | `agent-runner.mjs`（DefaultResourceLoader）, Pi 内部 | `Agent/resources/skills.py`, `Agent/core/agent_session_on_supabase.py`（load_skills, expand_skill_command） |
| Skill 列表/CRUD 前端 | `main.js`（skills:*）, `renderer/modules/chat/index.js`（/skill: 补全） | - |
| Tool 注册与执行 | Pi 默认工具 或 扩展 `pi.registerTool` | `Agent/tools/*.py`, `Agent/core/agent_session_on_supabase.py`（ToolRegistry）, `Agent/agent/loop.py`（execute） |
| 会话存储 | Pi SessionManager（`agent-runner.mjs` 里 sessionDir） | `Agent/session/supabase_store.py`, `Agent/core/agent_session_on_supabase.py` |
| System prompt | Pi 内部 | `Agent/resources/system_prompt.py`（build_system_prompt） |

按上述索引和步骤，即可在 Creez 中系统性地添加或扩展 Skill、Tool 和 Memory。
