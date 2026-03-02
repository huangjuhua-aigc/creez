const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadBuiltinModules() {
  const registryPath = pathToFileURL(path.join(__dirname, "..", "electron", "main", "agent-tools", "builtin", "registry.mjs")).href;
  const executorPath = pathToFileURL(path.join(__dirname, "..", "electron", "main", "agent-tools", "builtin", "executor.mjs")).href;
  const [{ createBuiltinSkillRegistry }, { createBuiltinSkillExecutor }] = await Promise.all([
    import(registryPath),
    import(executorPath),
  ]);
  return { createBuiltinSkillRegistry, createBuiltinSkillExecutor };
}

function createMockKnowledgeServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: { message: error?.message || "handler failed" } }));
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

test("knowledge_search e2e: non-default bot success path", async () => {
  const { createBuiltinSkillRegistry, createBuiltinSkillExecutor } = await loadBuiltinModules();
  const receivedBodies = [];
  const { server, baseUrl } = await createMockKnowledgeServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/knowledge/search");
    const body = await readJsonBody(req);
    receivedBodies.push(body);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      data: {
        matches: [
          {
            id: "p1",
            score: 0.918,
            payload: {
              text: "ARR reached 120k with 18% MoM growth.",
              source_id: "investor_deck_q1",
              metadata: { period: "2026Q1" },
            },
          },
        ],
      },
    }));
  });

  const prevBase = process.env.CREEZ_KNOWLEDGE_API_BASE;
  process.env.CREEZ_KNOWLEDGE_API_BASE = baseUrl;
  const events = [];

  try {
    const registry = createBuiltinSkillRegistry();
    const executor = createBuiltinSkillExecutor({
      registry,
      runtimeContext: {
        contactId: "bot_roundcloser",
        assistantConfigId: 2,
        chatId: "chat_abc",
      },
      onEvent: (ev) => events.push(ev),
    });

    const knowledgeTool = executor.listEnabledToolDefinitions().find((t) => t.name === "knowledge_search");
    assert.ok(knowledgeTool);

    const result = await knowledgeTool.execute("tc_knowledge_1", { query: "What is current ARR?", topK: 3 });
    assert.equal(Boolean(result?.isError), false);
    assert.equal(result?.details?.ok, true);
    assert.equal(result?.details?.data?.botId, "bot_roundcloser");
    assert.equal(result?.details?.data?.count, 1);
    assert.equal(receivedBodies.length, 1);
    assert.equal(receivedBodies[0].botId, "bot_roundcloser");
    assert.equal(receivedBodies[0].query, "What is current ARR?");
    assert.equal(receivedBodies[0].topK, 3);

    const text = String(result?.content?.[0]?.text || "");
    assert.match(text, /BUILTIN_SKILL_OK/);
    assert.match(text, /ARR reached 120k/);

    assert.equal(events[0]?.type, "builtin_tool_start");
    assert.equal(events[0]?.toolName, "knowledge_search");
    assert.equal(events[1]?.type, "builtin_tool_end");
    assert.equal(events[1]?.isError, false);
  } finally {
    process.env.CREEZ_KNOWLEDGE_API_BASE = prevBase;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("knowledge_search e2e: empty matches returns structured protocol error", async () => {
  const { createBuiltinSkillRegistry, createBuiltinSkillExecutor } = await loadBuiltinModules();
  const { server, baseUrl } = await createMockKnowledgeServer(async (_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, data: { matches: [] } }));
  });

  const prevBase = process.env.CREEZ_KNOWLEDGE_API_BASE;
  process.env.CREEZ_KNOWLEDGE_API_BASE = baseUrl;

  try {
    const registry = createBuiltinSkillRegistry();
    const executor = createBuiltinSkillExecutor({
      registry,
      runtimeContext: {
        contactId: "bot_roundcloser",
        assistantConfigId: 2,
        chatId: "chat_empty",
      },
    });
    const knowledgeTool = executor.listEnabledToolDefinitions().find((t) => t.name === "knowledge_search");
    assert.ok(knowledgeTool);

    const result = await knowledgeTool.execute("tc_knowledge_2", { query: "give me verified metrics" });
    assert.equal(result?.isError, true);
    assert.equal(result?.details?.ok, false);
    assert.equal(result?.details?.error?.code, "NO_RESULTS");
    assert.equal(result?.details?.error?.retryable, false);
    assert.match(String(result?.content?.[0]?.text || ""), /BUILTIN_SKILL_ERROR/);
  } finally {
    process.env.CREEZ_KNOWLEDGE_API_BASE = prevBase;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("knowledge_search e2e: default bot should not expose builtin tool", async () => {
  const { createBuiltinSkillRegistry, createBuiltinSkillExecutor } = await loadBuiltinModules();
  const prevAllowDefault = process.env.CREEZ_ENABLE_DEFAULT_BOT_KNOWLEDGE;
  delete process.env.CREEZ_ENABLE_DEFAULT_BOT_KNOWLEDGE;

  try {
    const registry = createBuiltinSkillRegistry();
    const executor = createBuiltinSkillExecutor({
      registry,
      runtimeContext: {
        contactId: "bot_default",
        assistantConfigId: 1,
        chatId: "chat_default",
      },
    });

    const toolNames = executor.listEnabledToolDefinitions().map((t) => t.name);
    assert.deepEqual(toolNames, []);
  } finally {
    process.env.CREEZ_ENABLE_DEFAULT_BOT_KNOWLEDGE = prevAllowDefault;
  }
});
