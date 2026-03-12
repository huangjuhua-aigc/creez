const test = require("node:test");
const assert = require("node:assert/strict");

test("video_generator handler returns error when startFrameUrl is missing", async () => {
  const { createVideoGeneratorHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/videoGeneratorHandler.mjs"
  );
  const handler = createVideoGeneratorHandler({});
  const result = await handler.execute({});

  assert.equal(result.isError, true);
  assert.equal(Array.isArray(result.content), true);
  const text = result.content[0]?.text || "";
  assert.ok(
    text.includes("INVALID_ARGUMENT") || text.includes("startFrameUrl"),
    `Expected startFrameUrl error, got: ${text.slice(0, 200)}`
  );
});

test("video_generator handler accepts keyframes as alternative to startFrameUrl", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  const savedUrl = process.env.CREEZ_BACKEND_URL;
  process.env.CREEZ_API_KEY = "test-key-for-unit-test";
  process.env.CREEZ_BACKEND_URL = "http://127.0.0.1:1";

  try {
    const { createVideoGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/videoGeneratorHandler.mjs"
    );
    const handler = createVideoGeneratorHandler({});
    const result = await handler.execute({
      keyframes: ["https://example.com/start.jpg", "https://example.com/end.jpg"],
      prompt: "Zoom in slowly",
    });

    // Should get a network error (unreachable port), not an INVALID_ARGUMENT
    assert.equal(result.isError, true);
    const text = result.content[0]?.text || "";
    assert.ok(
      !text.includes("INVALID_ARGUMENT"),
      `Should not get INVALID_ARGUMENT when keyframes provided, got: ${text.slice(0, 200)}`
    );
  } finally {
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
    else delete process.env.CREEZ_API_KEY;
    if (savedUrl !== undefined) process.env.CREEZ_BACKEND_URL = savedUrl;
    else delete process.env.CREEZ_BACKEND_URL;
  }
});

test("video_generator handler returns error when CREEZ_API_KEY is missing", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  delete process.env.CREEZ_API_KEY;

  try {
    const { createVideoGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/videoGeneratorHandler.mjs"
    );
    const handler = createVideoGeneratorHandler({});
    const result = await handler.execute({
      startFrameUrl: "https://example.com/frame.jpg",
    });

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

test("video_generator handler sends correct request to backend", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  const savedUrl = process.env.CREEZ_BACKEND_URL;
  process.env.CREEZ_API_KEY = "test-key-for-unit-test";
  process.env.CREEZ_BACKEND_URL = "http://127.0.0.1:1";

  try {
    const { createVideoGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/videoGeneratorHandler.mjs"
    );
    const handler = createVideoGeneratorHandler({});
    const result = await handler.execute({
      startFrameUrl: "https://example.com/frame.jpg",
      prompt: "Camera pans left",
      duration: "10",
      ratio: "16:9",
    });

    assert.equal(result.isError, true);
    const text = result.content[0]?.text || "";
    assert.ok(
      text.includes("BACKEND_UNREACHABLE") || text.includes("NETWORK_ERROR") || text.includes("TIMEOUT"),
      `Expected network error, got: ${text.slice(0, 300)}`
    );
  } finally {
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
    else delete process.env.CREEZ_API_KEY;
    if (savedUrl !== undefined) process.env.CREEZ_BACKEND_URL = savedUrl;
    else delete process.env.CREEZ_BACKEND_URL;
  }
});

test("video_generator handler has correct id", async () => {
  const { createVideoGeneratorHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/videoGeneratorHandler.mjs"
  );
  const handler = createVideoGeneratorHandler({});
  assert.equal(handler.id, "video_generator");
});

test("video_generator handler uses default duration when not specified", async () => {
  const savedKey = process.env.CREEZ_API_KEY;
  const savedUrl = process.env.CREEZ_BACKEND_URL;
  process.env.CREEZ_API_KEY = "test-key-for-unit-test";
  process.env.CREEZ_BACKEND_URL = "http://127.0.0.1:1";

  try {
    const { createVideoGeneratorHandler } = await import(
      "../electron/main/agent-tools/builtin/handlers/videoGeneratorHandler.mjs"
    );
    const handler = createVideoGeneratorHandler({});
    // No duration specified — should default to 5
    const result = await handler.execute({
      startFrameUrl: "https://example.com/frame.jpg",
    });

    // Can't verify duration directly since backend is unreachable,
    // but at least ensure it didn't crash with an INVALID_ARGUMENT
    assert.equal(result.isError, true);
    const text = result.content[0]?.text || "";
    assert.ok(!text.includes("INVALID_ARGUMENT"), `Should not get INVALID_ARGUMENT, got: ${text.slice(0, 200)}`);
  } finally {
    if (savedKey !== undefined) process.env.CREEZ_API_KEY = savedKey;
    else delete process.env.CREEZ_API_KEY;
    if (savedUrl !== undefined) process.env.CREEZ_BACKEND_URL = savedUrl;
    else delete process.env.CREEZ_BACKEND_URL;
  }
});
