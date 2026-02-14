# Creez Memory 与 Skill 现状与设计

## 一、当前支持情况概览

| 能力 | Creez 桌面端 (Electron) | mcp_host_backend (Web/API) |
|------|-------------------------|----------------------------|
| **Skill** | ✅ 已支持（存储 + 补全 + Agent 使用） | ✅ 已支持（项目沙盒内 `.pi/skills`） |
| **Memory** | ❌ 无独立「记忆」模块 | ❌ 无独立「记忆」模块 |
| **对话历史** | ✅ 有（前端 chatHistory + Pi session） | ✅ 有（Supabase `agent_sessions`） |

结论：**Agent 已支持 Skill；尚未支持独立的 Memory（长期记忆）**，仅有「对话历史」这种会话级上下文。

---

## 二、Skill 现状详解

### 2.1 数据与存储

- **位置**：工作目录下 `.pi/skills/<name>/SKILL.md`
- **格式**：YAML frontmatter（`name`, `description`）+ Markdown body
- **Creez 前端**：
  - `main.js`：`listSkills` / `readSkill` / `saveSkill` / `deleteSkill`（IPC）
  - 聊天输入支持 `/skill:xxx` 补全（`listSkillNames`）

### 2.2 桌面端 (Electron + pi-coding-agent)

- **agent-runner.mjs**：`DefaultResourceLoader` 使用 `cwd`（即 `config.workDir`），从 `cwd/.pi/skills` 和 `agentDir/skills` 加载 skills
- 用户输入若以 `/skill:name` 开头，会被 Pi 侧展开为技能正文再发给 LLM
- **结论**：桌面端 Skill 端到端已打通（存储 → 补全 → Agent 加载与展开）

### 2.3 后端 (mcp_host_backend)

- **Agent/resources/skills.py**：
  - `load_skills(*dirs)`：从多个目录（项目 `.pi/skills`、全局 `~/.pi-py/skills`、`~/.pi/agent/skills`）加载 `*/SKILL.md`
  - `expand_skill_command(text, skills)`：将 `/skill:name [args]` 展开为 `<skill name="..." location="...">...</skill>` + 可选 args
- **Agent/core/agent_session.py** 与 **agent_session_on_supabase.py**：
  - 每次 `prompt()` 前从 `cwd/.pi/skills` 等重新加载 skills，对用户文本做 `expand_skill_command`，再 `expand_prompt_template`
- **system_prompt**：会列出「技能名 + 描述 + 路径」，供模型知道有哪些技能
- **agentic_runner_agent.py**：`cwd` 为项目沙盒根目录 `~/.pi/ProjectContent/{project_id}/`，故技能来自该沙盒下的 `.pi/skills`（需在同步项目内容时包含 `.pi/skills`）

### 2.4 Skill 小结

- 两端的 **Skill 能力都已存在**：存储、加载、展开、system prompt 中列举。
- 若 Web 端希望使用「项目技能」，需保证同步到沙盒时包含 `project_id/.pi/skills/`。

---

## 三、Memory 现状与缺口

### 3.1 现有与「记忆」相关的部分

- **Session 持久化**（仅对话历史）：
  - 桌面端：Pi 的 `SessionManager`，会话目录与 workDir 相关（`agentDir/sessions/<encoded-workDir>/`）
  - 后端：`SupabaseSessionStore`，按 `user_id` / `chat_id` / `project_id` 存 `agent_sessions` 表，每条 message  append，turn 结束时 flush
- **用途**：多轮对话时把历史 message 发给 LLM，**没有**「长期记忆」的抽象（如用户偏好、项目事实、跨会话的 remember/recall）。

### 3.2 目前没有的能力

- 没有「记忆」的写入接口（例如：用户说「记住：本项目用 Vue3」）
- 没有「记忆」的读取与注入（例如：在 system 或 context 中注入「已知事实」）
- 没有按 scope 区分的记忆（用户级 / 项目级 / 会话级）
- 没有记忆的过期、编辑、删除策略

因此：**Agent 目前不支持 Memory**，只有会话级对话历史。

---

## 四、设计建议

### 4.1 Skill 可做的增强（可选）

1. **Web 端项目同步**：在 `sync_sandbox_to_db` / 项目文件树中显式包含 `.pi/skills`（及 `.pi/prompts`），确保云端项目也能用上技能。
2. **技能发现与提示**：在聊天输入区或设置里展示「当前工作目录下可用技能」列表（可复用 `listSkills`），减少用户记忆 `/skill:name`。
3. **Skill 版本/模板**：若需要从「技能市场」或模板创建技能，可再增加 skill 模板与安装流程（与现有 `readSkill`/`saveSkill` 兼容即可）。

### 4.2 Memory 设计建议

建议将 Memory 做成**独立于「对话历史」的模块**，与 Session 并列，供 Agent 在构造 system/context 时注入。

#### 4.2.1 存储形态

- **选项 A（简单）**：与项目/工作目录绑定，例如：
  - 桌面：`workDir/.pi/memory/` 下 JSON 或 JSONL（如 `user_prefs.json`、`project_facts.jsonl`）
  - Web：在 Supabase 增加表 `agent_memories`，字段如：`user_id`, `project_id`, `chat_id`（可选）, `key`/`type`, `content`, `created_at`，用 `(user_id, project_id, key)` 或类似做唯一/更新
- **选项 B（向量）**：需要语义检索时，用现有 `qdrant_integration` 存 embedding，按 project_id/user_id 做 namespace，在 prompt 前做 recall（top-k）注入 context。适合「大量事实、按语义检索」的场景。

建议先做 **选项 A**，再按需求加选项 B。

#### 4.2.2 作用域（Scope）

- **user**：用户级记忆（如「我的偏好是 TypeScript」），跨项目共享
- **project**：项目级（如「本项目用 Vue3 + Vite」），当前 project_id
- **chat**：会话级（可选），仅当前 chat_id，可与「对话历史」重叠，也可只存「高亮结论」类记忆

不同 scope 对应不同存储 key 或表字段（如 `scope + scope_id`）。

#### 4.2.3 Agent 侧接入

- **写入**：
  - 方式 1：由 LLM 在对话中输出结构化指令（如 `<remember scope="project">...</remember>`），后端解析后写入 Memory 存储。
  - 方式 2：提供显式 Tool，如 `remember(key, value, scope?)`，由模型在合适时机调用。
- **读取**：
  - 在每次 `prompt()` 或创建 session 时，根据当前 `user_id`/`project_id`/`chat_id` 从 Memory 存储取出条目，拼成一段「已知事实」注入 system prompt 或首条 context message。

这样 Agent 就「支持 Memory」：有写入、有按 scope 的读取、有注入到上下文的通路。

#### 4.2.4 与 Creez 前端的配合

- 若 Memory 存于 `workDir/.pi/memory/`：桌面端可像 skills 一样用 IPC 提供 `listMemories` / `readMemory` / `deleteMemory`（可选），便于设置页或「记忆管理」小面板查看/清理。
- Web 端：由后端 API 读写 Supabase（或 JSONL），前端仅通过对话或「设置」触发，无需直接读文件。

---

## 五、实现优先级建议

1. **短期**：保持现有 Skill 行为，确认 Web 端项目同步包含 `.pi/skills`（若尚未包含）。
2. **Memory 一期**：实现「项目级 + 用户级」的键值式记忆（选项 A），后端提供「读取并注入 system/context」+ 写入入口（Tool 或解析 LLM 的 remember 指令）。
3. **Memory 二期**：按需增加 scope（如 chat）、过期策略、前端记忆管理 UI；若需要语义检索再接入向量（选项 B）。

---

## 六、相关代码索引

| 能力 | 位置 |
|-----|------|
| Skill 加载与展开 | `mcp_host_backend/Agent/resources/skills.py` |
| Skill 在 session 中的使用 | `Agent/core/agent_session.py`，`Agent/core/agent_session_on_supabase.py` |
| System prompt 中技能列表 | `Agent/resources/system_prompt.py` |
| Creez 桌面 Skill CRUD | `Creez/src/main.js`（skills:*），`preload.js`（listSkills/readSkill/...) |
| 桌面 Agent 与 workDir | `Creez/src/agent-runner.mjs`（DefaultResourceLoader cwd） |
| 后端会话存储 | `Agent/session/supabase_store.py`，`Agent/session/local_jsonl.py` |
| 后端 Agent 入口 | `mcp_host_backend/agentic_runner_agent.py`（Supabase session + 项目沙盒） |

---

*文档版本：基于当前代码库梳理，便于后续实现 Memory 与增强 Skill 时对齐设计。*
