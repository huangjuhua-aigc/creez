import { asTextEnvelope, buildErrorEnvelope } from "./errorProtocol.mjs";

function createBuiltinSkillExecutor({ registry, runtimeContext, onEvent, replyInstructions = {} } = {}) {
  const safeRegistry = registry || { listEnabled: () => [] };
  const safeRuntime = runtimeContext || {};
  const safeReplyInstructions = replyInstructions && typeof replyInstructions === "object" ? replyInstructions : {};

  function emit(event) {
    if (typeof onEvent === "function") onEvent(event);
  }

  function applyReplyInstruction(skillId, result) {
    const instruction = safeReplyInstructions[skillId];
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) return result;
    if (result?.isError || !Array.isArray(result?.content) || result.content.length === 0) return result;
    const first = result.content[0];
    if (first?.type !== "text" || typeof first.text !== "string") return result;
    result = { ...result, content: [...result.content] };
    result.content[0] = { ...first, text: `${instruction.trim()}\n\n${first.text}` };
    return result;
  }

  function wrapTool(definition) {
    return {
      name: definition.id,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      async execute(toolCallId, args, signal, onUpdate, ctx) {
        const startedAt = Date.now();
        emit({
          type: "builtin_tool_start",
          toolName: definition.id,
          toolCallId: toolCallId || null,
          args: args || {},
        });

        try {
          const handler = definition.createHandler({
            ...safeRuntime,
            emitBuiltinEvent: emit,
            ctx,
            signal,
            onUpdate,
          });
          let result = await handler.execute(args || {});
          result = applyReplyInstruction(definition.id, result);
          emit({
            type: "builtin_tool_end",
            toolName: definition.id,
            toolCallId: toolCallId || null,
            elapsedMs: Date.now() - startedAt,
            isError: Boolean(result?.isError),
          });
          return result;
        } catch (error) {
          const envelope = buildErrorEnvelope({
            toolName: definition.id,
            code: "HANDLER_CRASH",
            message: error?.message || "Builtin skill handler crashed.",
            retryable: false,
            nextAction: "Do not retry immediately; continue by asking user for missing facts.",
          });
          emit({
            type: "builtin_tool_end",
            toolName: definition.id,
            toolCallId: toolCallId || null,
            elapsedMs: Date.now() - startedAt,
            isError: true,
            errorCode: envelope.error.code,
          });
          return {
            content: [{ type: "text", text: asTextEnvelope(envelope, definition.id) }],
            details: envelope,
            isError: true,
          };
        }
      },
    };
  }

  return {
    listEnabledToolDefinitions() {
      return safeRegistry.listEnabled(safeRuntime).map(wrapTool);
    },
    listEnabledSkillIds() {
      return safeRegistry.listEnabled(safeRuntime).map((d) => d.id);
    },
  };
}

export { createBuiltinSkillExecutor };
