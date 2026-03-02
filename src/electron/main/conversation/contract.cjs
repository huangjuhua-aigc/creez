/**
 * Conversation Engine Contract
 *
 * Any conversation engine (e.g. Pi, API bot) must implement this interface.
 * Output is always via the callbacks given in init(context), not return values.
 *
 * ---
 *
 * init(context)
 *   Input: InitContext
 *     - chatId: string
 *     - contactId: string
 *     - assistantConfigId: number
 *     - assistantConfig: object (name, systemPrompt, skills, models, ...)
 *     - workDir: string | null
 *     - memoryContent: string
 *     - memoryPath: string
 *     - provider, modelId, apiKey: string (for pi-style engines; resolved by caller)
 *     - agentDir: string (optional)
 *     - sendEvent: (payload: EventPayload) => void   — main event channel
 *     - sendError?: (message: string) => void        — error channel (optional)
 *   Output: none; success → sendEvent({ type: 'agent_ready' })
 *
 * prompt(payload)
 *   Input: PromptPayload
 *     - text: string
 *     - images?: Array<{ type: 'image', data: string, mimeType?: string }>
 *   Output: none; stream via sendEvent (message_*, tool_*, agent_end, etc.)
 *
 * setModel?(config)
 *   Input: SetModelConfig
 *     - provider: string
 *     - modelId: string
 *     - apiKey: string
 *   Output: boolean (success) or throw
 *
 * abort?()
 *   Input: none
 *   Output: none
 *
 * hasSession?()
 *   Output: boolean — true if init succeeded and session is active
 *
 * ---
 *
 * EventPayload shape (for sendEvent):
 *   - type: string (e.g. 'agent_ready', 'message_start', 'message_end', 'tool_call', 'tool_result', 'agent_end')
 *   - message?: { role, content?, toolCallId?, toolName?, errorMessage? }
 *   - messages?: array
 *   - toolCallId?, toolName?, args?, result?, partialResult?, isError?, assistantMessageEvent?
 */

const AGENT_EVENT_CHANNEL = "agent:event";
const AGENT_EVENT_ERROR_CHANNEL = "agent:eventError";

module.exports = {
  AGENT_EVENT_CHANNEL,
  AGENT_EVENT_ERROR_CHANNEL,
};
