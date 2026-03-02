# TODO (Backlog)

待规划与实现的功能项，供后续细化。

---

## 1. Skill: VC / RoundCloser 信息互换 (custom skill)

- **Goal**: 当 VC 与 RoundCloser 聊得比较深入时，引导 VC 发送其信息；将 VC 信息发到后端，并将「我的信息」发给 VC。
- **Deliverables** (TBD):
  - Custom skill（如 `exchange_contact` / `vc_lead_capture`）：模型在合适时机调用，收集 VC 信息并上报后端，同时可下发创始人/项目方信息给 VC。
  - 后端接口：接收 VC 信息并落库/通知；可选：下发待发送给前端的「我的信息」。
  - RoundCloser 侧 prompt 引导：在对话深入时引导 VC 留资并完成互换。
- **Acceptance**: VC 留资 → skill 执行 → 后端收到结构化数据；VC 侧可收到我方信息（形式待定）。

---

## 2. Sync：非默认 Bot 定时与后端拉取

- **Goal**: 对非默认 bot，定时与后端交互，检查后端是否有需要发给前端的信息（如通知、待办、后端触发的消息等）。
- **Deliverables** (TBD):
  - 前端或 Electron 侧：为非默认 bot 建立定时任务（如 setInterval / polling），调用后端「拉取待下发」类 API。
  - 后端：提供接口返回该 bot 下待推送给前端的条目（格式与业务待定）。
  - 前端收到后展示或处理（toast、侧栏红点、插入会话等，待设计）。
- **Acceptance**: 非默认 bot 会话存在时，周期性能从后端拉取并处理待下发内容。

---

## 3. Heartbeat：默认 Bot 心跳

- **Goal**: 对默认 bot 做某种「心跳」机制，具体能力与定义待定。
- **Notes**: 明天再想：心跳的用途（保活？状态上报？拉取配置？）、频率、与后端的契约、对前端的表现等。
- **Deliverables** (TBD): 待定义。
