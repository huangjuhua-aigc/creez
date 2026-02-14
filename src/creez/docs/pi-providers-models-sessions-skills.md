# Pi 集成：Provider / 模型 / Session 存储 / Skill

## 一、Pi 支持的 Provider（pi-ai KnownProvider）

来自 `@mariozechner/pi-ai` 的 `KnownProvider` 类型，`getModel(provider, modelId)` 只认这些 provider 及各自模型 id：

| Provider | 说明 |
|----------|------|
| `amazon-bedrock` | AWS Bedrock（含 Claude 等） |
| `anthropic` | Anthropic API（api.anthropic.com） |
| `google` | Google AI（Gemini） |
| `google-gemini-cli` | Google Gemini CLI |
| `google-antigravity` | Google Antigravity |
| `google-vertex` | Google Vertex AI |
| `openai` | OpenAI API |
| `azure-openai-responses` | Azure OpenAI Responses |
| `openai-codex` | OpenAI Codex |
| `github-copilot` | GitHub Copilot |
| `xai` | xAI (Grok) |
| `groq` | Groq |
| `cerebras` | Cerebras |
| `openrouter` | OpenRouter（多模型路由） |
| `vercel-ai-gateway` | Vercel AI Gateway |
| `zai` | Zai |
| `mistral` | Mistral |
| `minimax` / `minimax-cn` | Minimax |
| `opencode` | OpenCode |

**注意**：Creez 配置里的「供应商」需与上表一致（如 `openai`、`anthropic`、`openrouter`）。**豆包 (doubao)** 在 Creez 内通过自定义 model 支持：复用 pi-ai 的 `openai-completions` API，仅设置 `provider: "doubao"` 与豆包 baseUrl，无需在 pi-ai 中新增独立 provider 实现。

---

## 二、常用 Provider 与模型 ID 示例

模型 ID 以 pi-ai 的 `models.generated` 为准，配置时需填 **modelId**（不是显示名）。

### openai
- `gpt-4`, `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- `gpt-3.5-turbo`, `codex-mini-latest`
- 具体 id 以 pi-ai 包内列表为准。

### anthropic
- `claude-3-5-haiku-20241022`, `claude-3-5-haiku-latest`
- `claude-3-5-sonnet-20240620`, `claude-3-5-sonnet-20241022-v2`
- `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307`
- 新版本 id 见 pi-ai 的 `MODELS["anthropic"]`。

### openrouter（走 OpenRouter，多模型）
- `openai/gpt-4o`, `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `anthropic/claude-3-5-sonnet-...` 等
- 使用 OpenRouter 时 provider 填 `openrouter`，modelId 填 openrouter 的模型 slug。

### groq / xai / mistral / 其他
- 各 provider 下具体 id 见 pi-ai 的 `models.generated.ts` 或运行时用 `getModels(provider)` 查询。

---

## 三、Session Manager 与存储路径（已启用）

Creez 已改为使用 **SessionManager.create(cwd, sessionDir)**，会话会持久化到磁盘。

- **目录规则**：`<agentDir>/sessions/<encoded-workDir>/`
- **agentDir**：主进程传入的 `CONFIG_DIR`，即 **`~/.creez`**（Windows 为 `%USERPROFILE%\.creez`）。
- **encoded-workDir**：对当前工作目录做安全编码，形如 `--D-dir-myproject----`（路径中的 `/`、`\`、`:` 被替换为 `-`）。
- **单条会话文件**：该目录下的 `YYYY-MM-DDTHH-mm-ss-sss_<sessionId>.jsonl`，每轮新会话一个文件。

因此：
- 会话数据存在：**`~/.creez/sessions/--<编码后工作目录>--/`** 下的 `.jsonl` 文件中。
- 不同工作目录对应不同子目录，互不覆盖；同一工作目录下可有多条会话（多个 jsonl 文件）。

---

## 四、Skill 支持情况（已支持）

**当前 Creez 已支持 skills**，端到端可用。

- **agent-runner** 使用 **DefaultResourceLoader**，传入 `cwd`（工作目录）、`agentDir`（如 `~/.creez`），`await resourceLoader.reload()` 会从以下位置加载 skill：
  - **项目**：`<workDir>/.pi/skills/`（每个技能一个目录，内含 **SKILL.md**，带 frontmatter：name、description 等，符合 [Agent Skills 规范](https://agentskills.io/specification)）
  - **全局**：`<agentDir>/skills/`（即 `~/.creez/skills/`）
- **Session** 在构建系统提示时会调用 `resourceLoader.getSkills().skills`，将技能描述写入系统提示；用户发送的消息中的 **`/skill:技能名 [参数]`** 会在 `prompt()` 时由 Pi 的 `_expandSkillCommand` 展开为对应 skill 内容。
- **前端**：设置里可打开「Skills」弹窗，对当前工作目录下的 skill 进行列表、新建、编辑、删除；对话输入框支持输入 `/skill:` 触发技能名补全。技能持久化在 **`<workDir>/.pi/skills/<name>/SKILL.md`**，与 Pi 加载路径一致。

---

## 五、可执行任务的「沙箱」目录

- **Creez（Node Pi）**：可执行任务（读文件、写文件、bash 等）的**工作范围**就是配置里的 **工作路径 (workDir)**。  
  - `createAgentSession({ cwd: workDir, ... })` 传入的 `cwd` 即 Pi 的 session 工作目录，所有工具在该目录下执行。  
  - 主进程 `main.js` 的 **ensureInsideWorkDir** 会校验所有 fs 相关 IPC（读/写/创建/重命名/删除等），确保路径不越出 workDir，相当于一层沙箱边界。

- **与 Python 版本对应**：  
  - Python 侧（如 `mcp_host_backend/Agent`）使用 **LocalSandbox(root=resolved_cwd)**，所有工具（ReadFileTool、WriteFileTool、EditFileTool、BashTool）都通过 sandbox 解析路径，保证不越界。  
  - Creez 的 workDir + ensureInsideWorkDir 与 Python 的 `LocalSandbox(root=cwd)` 语义一致：**可执行任务的沙箱目录 = 用户选择的工作路径**。  

- **Node Pi 可选 OS 级沙箱**：  
  - Pi 官方示例里有一个 **Sandbox 扩展**（`examples/extensions/sandbox`），基于 `@anthropic-ai/sandbox-runtime`，对 bash 做网络/文件系统限制。  
  - Creez 当前未启用该扩展（`noExtensions: true`），仅依赖 workDir + ensureInsideWorkDir 做边界控制。

---

## 六、沙箱/工具执行代码位置

### Creez（Node Pi）— 在 node_modules 内

| 作用 | 路径（相对于 Creez 项目） |
|------|---------------------------|
| 工具创建（read/bash/edit/write，绑定 cwd） | `node_modules/@mariozechner/pi-coding-agent/dist/core/tools/index.js` → `createAllTools(cwd)` |
| Session 用 cwd 创建工具并注册 | `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js` 约 1446–1452 行：`createAllTools(this._cwd, ...)` → `_baseToolRegistry` |
| Bash 工具执行（spawn 时传入 cwd） | `node_modules/@mariozechner/pi-coding-agent/dist/core/tools/bash.js` → `defaultBashOperations.exec(command, cwd, ...)`，内部 `spawn(shell, args, { cwd, ... })` |
| 通用 bash 执行（流式/取消） | `node_modules/@mariozechner/pi-coding-agent/dist/core/bash-executor.js` → `executeBash` / `executeBashWithOperations` |
| 读/写文件工具（路径相对 cwd 解析） | `node_modules/@mariozechner/pi-coding-agent/dist/core/tools/read.js`、`write.js`（内部用 `resolveToCwd(path, cwd)` 等） |
| Creez 侧传入沙箱目录 | `src/agent-runner.mjs`：`createAgentSession({ cwd })`，`cwd = workDir \|\| process.cwd()` |
| 主进程路径越界校验 | `src/main.js`：`ensureInsideWorkDir(targetPath, workDir)`，所有 fs IPC 都会校验 |

### Python（mcp_host_backend/Agent）— 本地源码

| 作用 | 路径 |
|------|------|
| 沙箱定义（根目录 + 路径解析） | `mcp_host_backend/Agent/tools/sandbox.py` → `LocalSandbox(root)`, `resolve_path()` |
| Session 创建沙箱与工具 | `mcp_host_backend/Agent/core/agent_session.py` → `LocalSandbox(root=resolved_cwd)`，`ReadFileTool(sandbox)`、`WriteFileTool(sandbox)`、`EditFileTool(sandbox)`、`BashTool(sandbox)` |
| Bash 在沙箱根目录执行 | `mcp_host_backend/Agent/tools/bash.py` → `BashTool.execute` 里 `cwd=str(self.sandbox.root)`，`asyncio.create_subprocess_shell(...)` |
| 读/写文件经 sandbox 解析路径 | `mcp_host_backend/Agent/tools/fs.py` → `ReadFileTool` / `WriteFileTool` / `EditFileTool` 的 `execute` 里 `self.sandbox.resolve_path(args["path"])` |
