# Creez MVP

基于 Electron 的本地创作工作台 MVP。

## 运行方式

1. 进入项目目录：
   - `cd src/Creez`
2. 安装依赖：
   - `npm install`
3. 启动（二选一）：
   - **直接运行当前代码（推荐日常使用）**：`npm run start:fresh`  
     会先执行 `npm run build`（Vite 打前端 + 复制主进程到 `dist/`），再以 `electron dist/main.js` 启动，**这样你改过的前端与主进程代码都会生效**。
   - **开发模式（改一点就刷新看效果）**：`npm run dev`  
     同时启动 Vite 和 Electron，窗口从开发服务器加载；改完 `src/renderer/` 后保存，在 **Creez 窗口**里按 **Ctrl+Shift+R** 强制刷新。
   - 若只运行 `npm start`：会从已存在的 `dist/renderer` 加载；若没跑过 build 或 dist 是旧的，界面会是旧版，需先执行 `npm run build` 或改用 `npm run start:fresh`。

## 配置文件

点击左下角齿轮按钮打开配置弹窗，填写模型供应商、API Key、模型名称与工作目录。
配置会写入 `~/.creez/config.json`。

## 主要能力（MVP）

- 配置弹窗：模型信息、工作目录。
- 主页面三栏布局：文件目录 / 工作面板 / 对话。
- 文件目录：右键菜单支持新建、移动、删除、重命名、复制路径、在文件夹显示。
- 工作面板：文本、scene_board、time_line 文件可编辑并提供简易可视化预览，其它类型只读预览。
- 对话框：支持 @ 文件引用、拖拽文件到对话框、上传多模态文件入口，支持流式返回。
- Skills：内置技能在 `skills/`，首次在对话中使用 `/skill:xxx` 时会自动复制到 `~/.creez/skills`；工作区技能在 `工作目录/.pi/skills`。

## 打包（跨平台）

使用 [electron-builder](https://www.electron.build/) 打包为桌面安装包：

- 安装依赖后执行：
  - **当前平台**：`npm run dist`
  - **仅 Windows**：`npm run dist:win`
  - **仅 macOS**：`npm run dist:mac`
  - **仅 Linux**：`npm run dist:linux`
- 输出目录：`release/`。Windows 默认生成 NSIS 安装包与 portable 便携版；mac 为 dmg/zip；Linux 为 AppImage/deb。
- 需在对应系统上打对应包（例如在 Windows 上打 Windows 包）；mac 上可打 mac 与 Linux 包。

## 打包后调试（键盘无法输入、fetch failed）

1. **看主进程日志（后端请求失败时）**  
   打包版会把请求 URL 和错误写入 **`~/.creez/creez-debug.log`**（Windows：`%USERPROFILE%\.creez\creez-debug.log`）。触发一次生图/生视频失败后，打开该文件即可看到具体报错（如 `url=... err=... code=ENOTFOUND` 等），便于区分网络、DNS、证书等问题。

2. **开开发者工具（看渲染进程报错、试键盘）**  
   - 在 Creez 窗口按 **F12** 打开/关闭 DevTools，在 Console 里看是否有报错。  
   - 若希望启动时自动打开 DevTools，可设置环境变量后再运行 exe，例如 PowerShell：
     ```powershell
     $env:CREEZ_DEBUG = "1"
     & "D:\code\LightOn\src\Creez\release\win-unpacked\Creez.exe"
     ```
     此时会同时写 `~/.creez/creez-debug.log`，且启动时打开 DevTools。

3. **键盘无法输入**  
   - 先点一下输入框/聊天框再打字，确认焦点在页面内而不是别处。  
   - 按 F12 看 Console 是否有与 input、focus、IME 相关的报错。  
   - 若本机有多个输入法，可尝试切换英文输入或默认英文再试。

4. **fetch failed / 后端连不上**  
   - 看 `~/.creez/creez-debug.log` 里的 `url=` 和 `err=`，确认请求的地址和错误码。  
   - 打包版默认请求 **https://int-creez.lighton.video**；若需改地址，可设环境变量后再运行 exe，例如：
     ```powershell
     $env:IMAGE_GEN_BASE_URL = "https://你的后端地址"
     & ".\release\win-unpacked\Creez.exe"
     ```
   - 若为证书/HTTPS 问题，日志中常见 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 或 `CERT_*` 等。

## 说明

- 右侧对话面板已预留交互流程，后续可接入 pi-mono 的流式返回接口与自定义 skills。
- 对话面板已接入 `lightonmodel/chat/completions` SSE，支持心跳包与 `file_tree_update` 刷新。
