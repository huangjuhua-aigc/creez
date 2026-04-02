/**
 * SessionTracker: monitors idle external-bot channel sessions.
 *
 * State machine per session: active → idle_pending → sending → sent
 *   - active:       receiving messages, lastActivityAt kept fresh
 *   - idle_pending:  idle > IDLE_TIMEOUT_MS, ready for summary
 *   - sending:      summary generation in progress (CAS lock)
 *   - sent:         summary delivered to owner, terminal state
 *
 * Runs entirely in the main (backend) process.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  summarizeTranscriptWithDefaultPiAssistant,
  appendToDefaultAssistantMainChat,
  resolveWorkDir: resolveWorkDirSummary,
  DEFAULT_WORKSPACE_ROOT: DEFAULT_WORKSPACE_SUMMARY,
} = require("./transcriptSummaryService.cjs");

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SCAN_INTERVAL_MS = 60 * 1000;

function trackerLog(message) {
  const line = `[${new Date().toISOString()}] [SessionTracker] ${message}`;
  console.log(line);
  try {
    const logDir = path.join(os.homedir(), ".creez", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "startup.log"), line + "\n", "utf8");
  } catch {}
}

const resolveWorkDir = resolveWorkDirSummary;
const DEFAULT_WORKSPACE_ROOT = DEFAULT_WORKSPACE_SUMMARY;

class SessionTracker {
  constructor(deps) {
    this._deps = deps;
    this._sessions = new Map();
    this._timer = null;
  }

  /**
   * Called by adapters on every inbound/outbound message for a non-default bot session.
   */
  touch({ sessionKey, botId, channelType, externalChatId, chatId }) {
    const existing = this._sessions.get(sessionKey);
    if (existing) {
      if (existing.state === "sent" || existing.state === "sending") {
        return;
      }
      existing.lastActivityAt = Date.now();
      existing.state = "active";
      return;
    }
    this._sessions.set(sessionKey, {
      sessionKey,
      botId,
      channelType,
      externalChatId,
      chatId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      state: "active",
    });
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
    trackerLog("started (interval=" + SCAN_INTERVAL_MS + "ms, idle=" + IDLE_TIMEOUT_MS + "ms)");
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    trackerLog("stopped");
  }

  async _scan() {
    const now = Date.now();
    for (const [key, session] of this._sessions) {
      if (session.state !== "active") continue;
      if (now - session.lastActivityAt >= IDLE_TIMEOUT_MS) {
        session.state = "idle_pending";
        trackerLog("idle detected: " + key);
        this._finalize(session).catch((err) => {
          trackerLog("finalize error for " + key + ": " + (err?.message || String(err)));
          if (session.state === "sending") {
            session.state = "active";
            session.lastActivityAt = Date.now();
          }
        });
      }
    }
  }

  async _finalize(session) {
    if (session.state !== "idle_pending") return;
    session.state = "sending";

    const { chatRepository, contactRepository, assistantConfigRepository, appStateStore } = this._deps;

    const botContact = contactRepository.getById(session.botId);
    const botName = botContact?.name || session.botId;

    const historyRows = chatRepository.getMessages({ chatId: session.chatId, limit: 200 });
    const messages = (historyRows?.items || []).reverse();

    if (messages.length === 0) {
      session.state = "sent";
      trackerLog("no messages to summarize for " + session.sessionKey);
      return;
    }

    const transcript = messages
      .map((m) => `[${m.sender}] ${m.content}`)
      .join("\n\n");

    const appState = appStateStore ? await appStateStore.getState() : {};
    const rawRoot = appState?.workspaceRoot ?? null;
    const workDir = resolveWorkDir(rawRoot) || DEFAULT_WORKSPACE_ROOT;

    const sessionId = session.externalChatId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const summaryDir = path.join(workDir, "channel-summaries", botName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff -]/g, "_"), `${dateStr}_${sessionId}`);

    await fsp.mkdir(summaryDir, { recursive: true });

    const transcriptPath = path.join(summaryDir, "transcript.md");
    const summaryPath = path.join(summaryDir, "summary.md");
    const metaPath = path.join(summaryDir, "meta.json");

    const startTime = new Date(session.createdAt).toISOString();
    const endTime = new Date(session.lastActivityAt).toISOString();

    await fsp.writeFile(transcriptPath, `# Conversation Transcript\n\n**Bot:** ${botName}\n**Channel:** ${session.channelType}\n**External Chat:** ${session.externalChatId}\n**Period:** ${startTime} — ${endTime}\n\n---\n\n${transcript}\n`, "utf8");

    let summaryText = "";
    try {
      summaryText = await this._generateSummary(session, transcript, botName);
    } catch (err) {
      trackerLog("LLM summary failed, using fallback: " + (err?.message || String(err)));
      const msgCount = messages.length;
      const userMsgs = messages.filter((m) => m.sender === "user").length;
      summaryText = `## 会话摘要\n\n- **Agent:** ${botName}\n- **渠道:** ${session.channelType}\n- **消息数:** ${msgCount} (用户 ${userMsgs} 条)\n- **时间段:** ${startTime} — ${endTime}\n\n> 自动摘要生成失败，请查看完整记录: transcript.md`;
    }

    await fsp.writeFile(summaryPath, summaryText + "\n", "utf8");

    await fsp.writeFile(metaPath, JSON.stringify({
      sessionKey: session.sessionKey,
      botId: session.botId,
      botName,
      channelType: session.channelType,
      externalChatId: session.externalChatId,
      chatId: session.chatId,
      startTime,
      endTime,
      messageCount: messages.length,
      summarySentAt: new Date().toISOString(),
    }, null, 2) + "\n", "utf8");

    trackerLog("summary written to " + summaryDir);

    try {
      await this._notifyOwner(session, summaryText, summaryPath, transcriptPath, botName);
    } catch (err) {
      trackerLog("owner notification failed: " + (err?.message || String(err)));
    }

    session.state = "sent";
    trackerLog("finalized: " + session.sessionKey);
  }

  async _generateSummary(session, transcript, botName) {
    const { contactRepository, assistantConfigRepository, appStateStore } = this._deps;
    return summarizeTranscriptWithDefaultPiAssistant(
      { contactRepository, assistantConfigRepository, appStateStore },
      {
        transcript,
        botName,
        channelType: session.channelType,
        scenarioDescription: `这是 Agent "${botName}" 通过 **${session.channelType}** 渠道与外部用户的对话。`,
        summarySessionKeyPrefix: `summary:${session.sessionKey}`,
      },
    );
  }

  async _notifyOwner(session, summaryText, summaryPath, transcriptPath, botName) {
    const { chatRepository, contactRepository } = this._deps;

    const startTime = new Date(session.createdAt).toISOString().slice(0, 19).replace("T", " ");
    const endTime = new Date(session.lastActivityAt).toISOString().slice(0, 19).replace("T", " ");

    const condensed = (summaryText || "").slice(0, 1000);

    const notificationContent = [
      `📋 **外部会话总结通知**`,
      "",
      `你的 Agent **${botName}** 刚完成了一段外部会话。`,
      "",
      `- **渠道：** ${session.channelType}`,
      `- **外部会话：** ${session.externalChatId}`,
      `- **时间段：** ${startTime} — ${endTime}`,
      "",
      "**摘要：**",
      condensed,
      "",
      `📁 **摘要文件：** ${summaryPath}`,
      `📁 **完整记录：** ${transcriptPath}`,
    ].join("\n");

    appendToDefaultAssistantMainChat(
      { contactRepository, chatRepository },
      { content: notificationContent },
    );
    trackerLog("owner notified (default assistant main chat)");
  }
}

module.exports = { SessionTracker };
