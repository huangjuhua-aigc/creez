const test = require("node:test");
const assert = require("node:assert/strict");
const { ConversationAdapter } = require("../ConversationAdapter.cjs");

const adapter = new ConversationAdapter();

test("toEngineInput extracts text", () => {
  const result = adapter.toEngineInput({ content: "hello world", contentType: "text/plain" });
  assert.equal(result.text, "hello world");
  assert.deepEqual(result.images, []);
});

test("toEngineInput handles empty content", () => {
  const result = adapter.toEngineInput({});
  assert.equal(result.text, "");
});

test("toA2AOutput wraps string", () => {
  const result = adapter.toA2AOutput("bot reply");
  assert.equal(result.content, "bot reply");
  assert.equal(result.contentType, "text/plain");
});

test("toA2AOutput handles non-string", () => {
  const result = adapter.toA2AOutput(null);
  assert.equal(result.content, "");
});

test("extractReplyFromEvent with string content", () => {
  const text = adapter.extractReplyFromEvent({
    message: { content: "Hi there!" },
  });
  assert.equal(text, "Hi there!");
});

test("extractReplyFromEvent with array content", () => {
  const text = adapter.extractReplyFromEvent({
    message: {
      content: [
        { type: "text", text: "Part 1. " },
        { type: "image", url: "..." },
        { type: "text", text: "Part 2." },
      ],
    },
  });
  assert.equal(text, "Part 1. Part 2.");
});

test("extractReplyFromEvent with missing content", () => {
  assert.equal(adapter.extractReplyFromEvent({}), "");
  assert.equal(adapter.extractReplyFromEvent(null), "");
  assert.equal(adapter.extractReplyFromEvent({ message: {} }), "");
});

test("detectEndSignal finds [end] keyword", () => {
  assert.equal(adapter.detectEndSignal("That's all. [END]"), true);
  assert.equal(adapter.detectEndSignal("Goodbye! [bye]"), true);
  assert.equal(adapter.detectEndSignal("Conversation Complete."), true);
});

test("detectEndSignal returns false for normal text", () => {
  assert.equal(adapter.detectEndSignal("Hello, how can I help?"), false);
  assert.equal(adapter.detectEndSignal(""), false);
  assert.equal(adapter.detectEndSignal(null), false);
});
