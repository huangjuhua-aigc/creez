const test = require("node:test");
const assert = require("node:assert/strict");

test("web_fetch handler returns error when url is missing", async () => {
  const { createWebFetchHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/webFetchHandler.mjs"
  );
  const handler = createWebFetchHandler({});
  const result = await handler.execute({});

  assert.equal(result.isError, true);
  assert.equal(Array.isArray(result.content), true);
  const text = result.content[0]?.text || "";
  assert.ok(text.includes("url") || text.includes("INVALID_ARGUMENT"), `Expected url error, got: ${text.slice(0, 200)}`);
});

test("web_fetch handler returns error for non-http URL", async () => {
  const { createWebFetchHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/webFetchHandler.mjs"
  );
  const handler = createWebFetchHandler({});
  const result = await handler.execute({ url: "ftp://example.com/file.txt" });

  assert.equal(result.isError, true);
  const text = result.content[0]?.text || "";
  assert.ok(text.includes("INVALID_URL") || text.includes("http"), `Expected protocol error, got: ${text.slice(0, 200)}`);
});

test("web_fetch handler returns error for invalid URL format", async () => {
  const { createWebFetchHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/webFetchHandler.mjs"
  );
  const handler = createWebFetchHandler({});
  const result = await handler.execute({ url: "not a url at all" });

  assert.equal(result.isError, true);
  const text = result.content[0]?.text || "";
  assert.ok(text.includes("INVALID_URL") || text.includes("Invalid"), `Expected invalid URL error, got: ${text.slice(0, 200)}`);
});

test("web_fetch handler succeeds for a real URL", async () => {
  const { createWebFetchHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/webFetchHandler.mjs"
  );
  const handler = createWebFetchHandler({});
  const result = await handler.execute({ url: "https://httpbin.org/get" });

  assert.equal(result.isError, undefined);
  assert.equal(Array.isArray(result.content), true);
  const text = result.content[0]?.text || "";
  assert.ok(text.includes("BUILTIN_SKILL_OK"), `Expected success envelope, got: ${text.slice(0, 300)}`);
  assert.ok(text.includes("httpbin"), `Expected httpbin content, got: ${text.slice(0, 300)}`);
});

test("web_fetch handler handles HTML content", async () => {
  const { createWebFetchHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/webFetchHandler.mjs"
  );
  const handler = createWebFetchHandler({});
  const result = await handler.execute({ url: "https://httpbin.org/html" });

  // httpbin /html returns a simple HTML page
  if (!result.isError) {
    const text = result.content[0]?.text || "";
    assert.ok(text.includes("BUILTIN_SKILL_OK"), `Expected success, got: ${text.slice(0, 300)}`);
    const details = result.details;
    assert.ok(details?.data?.extractor === "html-strip", `Expected html-strip extractor, got: ${details?.data?.extractor}`);
  } else {
    // Network issue — skip gracefully
    const text = result.content[0]?.text || "";
    assert.ok(text.includes("NETWORK_ERROR") || text.includes("TIMEOUT") || text.includes("HTTP_ERROR"),
      `Unexpected error type: ${text.slice(0, 200)}`);
  }
});

test("web_fetch handler respects maxChars", async () => {
  const { createWebFetchHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/webFetchHandler.mjs"
  );
  const handler = createWebFetchHandler({});
  const result = await handler.execute({ url: "https://httpbin.org/get", maxChars: 200 });

  if (!result.isError) {
    const details = result.details;
    assert.ok(details?.data?.truncated === true, `Expected truncated=true for small maxChars`);
  } else {
    // Network issue — skip gracefully
    const text = result.content[0]?.text || "";
    assert.ok(text.includes("NETWORK_ERROR") || text.includes("TIMEOUT"),
      `Unexpected error type: ${text.slice(0, 200)}`);
  }
});
