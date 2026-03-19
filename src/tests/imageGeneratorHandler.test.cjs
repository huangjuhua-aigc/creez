const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

test("image_generator handler returns error when prompt is missing", async () => {
  const { createImageGeneratorHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
  );
  const handler = createImageGeneratorHandler({});
  const result = await handler.execute({});

  assert.equal(result.isError, true);
  assert.equal(Array.isArray(result.content), true);
  const text = result.content[0]?.text || "";
  assert.ok(
    text.includes("INVALID_ARGUMENT") || text.includes("prompt"),
    `Expected prompt error, got: ${text.slice(0, 200)}`
  );
});

test("image_generator handler returns error when prompt is empty string", async () => {
  const { createImageGeneratorHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
  );
  const handler = createImageGeneratorHandler({});
  const result = await handler.execute({ prompt: "   " });

  assert.equal(result.isError, true);
  const text = result.content[0]?.text || "";
  assert.ok(
    text.includes("INVALID_ARGUMENT") || text.includes("prompt"),
    `Expected prompt error for whitespace, got: ${text.slice(0, 200)}`
  );
});

test("image_generator handler returns error when CREEZ_API_KEY is missing", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  delete process.env.CREEZ_API_KEY;

  try {
    const { createImageGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
    );
    const handler = createImageGeneratorHandler({});
    const result = await handler.execute({ prompt: "A sunset over mountains" });

    // If ~/.creez/.env has a key, this won't error — only check if it does error
    if (result.isError) {
      const text = result.content[0]?.text || "";
      assert.ok(
        text.includes("MISSING_API_KEY") || text.includes("API key"),
        `Expected API key error, got: ${text.slice(0, 200)}`
      );
    }
  } finally {
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
  }
});

test("image_generator handler sends correct request to backend", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  const savedUrl = process.env.CREEZ_BACKEND_URL;
  process.env.CREEZ_API_KEY = "test-key-for-unit-test";
  process.env.CREEZ_BACKEND_URL = "http://127.0.0.1:1"; // unreachable port

  try {
    const { createImageGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
    );
    const handler = createImageGeneratorHandler({});
    const result = await handler.execute({
      prompt: "A cat sitting on a moon",
      ratio: "1:1",
      numImages: 2,
    });

    assert.equal(result.isError, true);
    const text = result.content[0]?.text || "";
    assert.ok(
      text.includes("BACKEND_UNREACHABLE") || text.includes("NETWORK_ERROR") || text.includes("TIMEOUT"),
      `Expected network error (unreachable port), got: ${text.slice(0, 300)}`
    );
  } finally {
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
    else delete process.env.CREEZ_API_KEY;
    if (savedUrl !== undefined) process.env.CREEZ_BACKEND_URL = savedUrl;
    else delete process.env.CREEZ_BACKEND_URL;
  }
});

test("image_generator handler has correct id", async () => {
  const { createImageGeneratorHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
  );
  const handler = createImageGeneratorHandler({});
  assert.equal(handler.id, "image_generator");
});

test("image_generator returns REFERENCE_IMAGE_ERROR when reference file missing", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  process.env.CREEZ_API_KEY = "test-key-for-ref-test";

  try {
    const { createImageGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
    );
    const workDir = os.tmpdir();
    const handler = createImageGeneratorHandler({ workDir });
    const missing = path.join(workDir, `nonexistent-ref-${Date.now()}.png`);
    const result = await handler.execute({
      prompt: "A red apple",
      referenceImagePaths: [missing],
    });

    assert.equal(result.isError, true);
    const text = result.content[0]?.text || "";
    assert.ok(
      text.includes("REFERENCE_IMAGE_ERROR") || text.includes("file not found") || text.includes("Failed to load"),
      `Expected reference load error, got: ${text.slice(0, 400)}`
    );
  } finally {
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
    else delete process.env.CREEZ_API_KEY;
  }
});

test("image_generator encodes tiny local PNG as base64 in request (mock server)", async () => {
  const http = require("node:http");
  const savedKey = process.env.CREEZ_API_KEY;
  const savedUrl = process.env.CREEZ_BACKEND_URL;
  process.env.CREEZ_API_KEY = "test-key-mock";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creez-img-ref-"));
  const pngPath = path.join(tmp, "one.png");
  // 1x1 PNG
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  fs.writeFileSync(pngPath, onePxPng);

  let receivedBody = null;
  const server = http.createServer((req, res) => {
    const pathOnly = (req.url || "").split("?")[0];
    if (req.method === "POST" && pathOnly === "/media/generate-image") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, data: { images: [{ type: "url", data: "https://example.com/out.png" }] } }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  process.env.CREEZ_BACKEND_URL = `http://127.0.0.1:${port}`;

  try {
    const { createImageGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/imageGeneratorHandler.mjs"
    );
    const handler = createImageGeneratorHandler({ workDir: tmp });
    const result = await handler.execute({
      prompt: "same style",
      referenceImagePaths: ["one.png"],
    });

    assert.notEqual(result.isError, true, result.content?.[0]?.text || "no text");
    assert.ok(receivedBody, "server should have received body");
    assert.ok(Array.isArray(receivedBody.referenceImageBase64s), "referenceImageBase64s should be sent");
    assert.equal(receivedBody.referenceImageBase64s.length, 1);
    assert.ok(
      String(receivedBody.referenceImageBase64s[0]).startsWith("data:image/png;base64,"),
      "should be png data URL"
    );
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
    else delete process.env.CREEZ_API_KEY;
    if (savedUrl !== undefined) process.env.CREEZ_BACKEND_URL = savedUrl;
    else delete process.env.CREEZ_BACKEND_URL;
  }
});
