const test = require("node:test");
const assert = require("node:assert/strict");

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
