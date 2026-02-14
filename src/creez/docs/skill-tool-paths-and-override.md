# Creez：技能目录具体地址、skillsOverride 用法、技能沙盒与 Tool（仅 Pi/JS）

## 一、workDir/.pi/skills/ 和 agentDir/skills/ 具体是什么地址

在 Creez 里，这两个变量来自 **main.js** 传给 **agent:init** 的 config，再在 **agent-runner.mjs** 里使用：

| 变量 | 含义 | 在 Creez 中的具体值（示例） |
|------|------|-----------------------------|
| **workDir** | 用户在「设置」里选择的**工作目录** | 例如 `D:\Projects\MyProject` 或 `/home/user/my-project` |
| **agentDir** | 应用配置目录，写死在 main 里为 `CONFIG_DIR` | Windows: `C:\Users\<你的用户名>\.creez`<br>macOS/Linux: `/Users/<你的用户名>/.creez` |

因此两个技能目录的**实际路径**是：

- **workDir/.pi/skills/**  
  = 你选的工作目录下的 `.pi/skills`  
  例如：`D:\Projects\MyProject\.pi\skills` 或 `/home/user/my-project/.pi/skills`

- **agentDir/skills/**  
  = 用户主目录下的 Creez 配置目录里的 `skills`  
  例如：`C:\Users\<你的用户名>\.creez\skills` 或 `~/.creez/skills`

Pi 的 `DefaultResourceLoader` 会从**这两类位置**发现技能（以及包管理、settings 里配置的路径）：  
项目技能 = `cwd/.pi/skills`（这里 cwd = workDir），用户全局技能 = `agentDir/skills`。

---

## 二、“在 agent-runner.mjs 里配 skillsOverride”具体是什么操作

`skillsOverride` 是传给 `DefaultResourceLoader` 的一个**可选回调**。Pi 在内部先按默认规则扫描出所有技能，得到 `{ skills, diagnostics }`，再如果你传了 `skillsOverride`，就会用你的返回值**替换**这次扫描结果，从而做到「只保留工作目录技能」「过滤掉某些技能」或「再追加自定义技能」。

### 2.1 签名

```ts
skillsOverride?: (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
};
```

### 2.2 只保留「当前工作目录」下的技能（技能沙盒只在 workDir）

若希望**技能只来自 workDir/.pi/skills/**，不加载 `~/.creez/skills` 等，可以在 `agent-runner.mjs` 里给 `DefaultResourceLoader` 增加 `skillsOverride`，只保留 `filePath` 在 `cwd/.pi/skills` 下的技能：

```js
import path from "node:path";

// 在 createAndSubscribe 里，构造 DefaultResourceLoader 时：
const projectSkillsRoot = path.join(cwd, ".pi", "skills");

const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: resolvedAgentDir,
  settingsManager,
  noExtensions: true,
  skillsOverride: (current) => {
    const onlyProject = current.skills.filter((s) => {
      if (!s.filePath || typeof s.filePath !== "string") return false;
      const normalized = path.normalize(s.filePath);
      const root = path.normalize(projectSkillsRoot);
      return normalized === root || normalized.startsWith(root + path.sep);
    });
    return { skills: onlyProject, diagnostics: current.diagnostics };
  },
});
await resourceLoader.reload();
```

这样 Pi 侧只会加载「当前工作目录下的 .pi/skills」里的技能；写/删仍然由 **main.js** 的 `ensureInsideWorkDir(skillDir, workDir)` 限制在用户设置的工作目录内（见下一节）。

---

## 三、技能沙盒：只放在工作目录，写/删只限制在用户设置目录

你的需求可以拆成两点：

1. **技能只来自当前工作目录**  
   → 用上面第二节的 `skillsOverride` 只保留 `cwd/.pi/skills` 下的技能即可。
2. **写、删只允许在用户设置的目录下**  
   → 这部分 Creez **已经做了**：main.js 里 `skills:save` 和 `skills:delete` 都会对目标路径做 `ensureInsideWorkDir(skillDir, workDir)`，即只能写、删 `workDir` 内的路径；`workDir` 就是用户在设置里选的工作目录。

因此你只需要在 **agent-runner.mjs** 里加上面的 `skillsOverride`，就能做到：  
- 技能**只**从 workDir/.pi/skills 加载（沙盒在工作目录）；  
- 写/删继续由 main 限制在 workDir 内，无需改 Python。

---

## 四、Creez 里的 Tool（仅 Pi Agent，不涉及 Python）

你说的 tool 是 **Creez 这个项目里、基于 Pi Agent 的 tool**，不涉及后端 Python。在 Creez 里，Pi 的 tool 行为是这样的：

### 4.1 当前 Creez 的 Tool 来源

`agent-runner.mjs` 里**没有**传 `tools` 给 `createAgentSession`，因此 Pi 使用**默认工具集**，且用当前 `cwd`（即 workDir）作为执行目录：

- 默认工具名：`read`, `bash`, `edit`, `write` 等（Pi 内部 `defaultActiveToolNames` / `createAllTools(this._cwd)`）。
- 执行时的“根”就是用户设置的工作目录，所以读写在逻辑上已经限制在工作目录下（由 Pi 的实现保证）。

### 4.2 要在 Creez 里“加 Tool”的两种方式（仅 JS/Pi）

**方式 1：显式传 tools（仍用 Pi 内置工具）**

在 `createAgentSession` 里传入 `tools`，并保证这些工具绑定到当前 `cwd`（workDir），例如：

```js
import {
  createAgentSession,
  createCodingTools,
  SessionManager,
  // ...
} from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  cwd,
  tools: createCodingTools(cwd), // read, bash, edit, write 等，路径相对 cwd
  // ...
});
```

这样仍然是 Pi 自带的工具，只是显式指定「工具集」和「工作目录」。

**方式 2：用扩展注册自定义 Tool（pi.registerTool）**

Pi 的扩展可以在运行时注册**自定义 tool**，供模型调用。Creez 里没有默认加载 `.pi/extensions/` 下的文件（因为 `noExtensions: true`），但可以通过 `DefaultResourceLoader` 的 **extensionFactories** 内联注册扩展，在扩展里调用 `pi.registerTool(...)`：

1. 在 `agent-runner.mjs` 里给 `DefaultResourceLoader` 增加 `extensionFactories`：
   - 在工厂函数里拿到 `pi`（ExtensionAPI），调用 `pi.registerTool({ name, label, description, parameters, execute })`。
2. `execute` 的签名和 Pi 文档一致，返回 `{ content: [{ type: "text", text: "..." }], details: {} }`。

这样添加的 tool 是 **Creez 项目内、仅 Pi/JS 的实现**，不涉及任何 Python 代码。Pi 的扩展文档和示例在：

- `node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`（Custom tools、registerTool）
- `examples/extensions/` 下如 `tools.ts`、带 `registerTool` 的示例

如果你愿意，我可以根据你当前 `agent-runner.mjs` 的结构写一版**只保留工作目录技能**的 `skillsOverride` 补丁，以及一个**最小 extensionFactories + registerTool** 示例（仅 Creez + Pi，不涉及 Python）。
