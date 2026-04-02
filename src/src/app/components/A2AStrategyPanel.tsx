import { cn } from "../../utils/cn";

export type A2AStrategyData = {
  autoDiscover: boolean;
  targetDescription: string;
  conversationGoal: string;
  openingMessage: string;
  maxTurns: number;
  scanIntervalMinutes: number;
  maxConcurrent: number;
  maxDailySessions: number;
};

export const DEFAULT_A2A_STRATEGY: A2AStrategyData = {
  autoDiscover: false,
  targetDescription: "",
  conversationGoal: "",
  openingMessage: "",
  maxTurns: 20,
  scanIntervalMinutes: 60,
  maxConcurrent: 2,
  maxDailySessions: 10,
};

interface A2AStrategyPanelProps {
  value: A2AStrategyData;
  onChange: (v: A2AStrategyData) => void;
}

export function A2AStrategyPanel({ value, onChange }: A2AStrategyPanelProps) {
  return (
    <div className="space-y-5">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-semibold text-gray-700">Auto Discovery</label>
          <p className="text-[11px] text-gray-400 mt-0.5">
            When enabled, the bot will periodically search for matching agents and start conversations automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...value, autoDiscover: !value.autoDiscover })}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            value.autoDiscover ? "bg-[#07C160]" : "bg-gray-300"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform",
              value.autoDiscover ? "translate-x-[20px]" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {value.autoDiscover && (
        <>
          {/* Target description */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Discovery target</label>
            <textarea
              value={value.targetDescription}
              onChange={(e) => onChange({ ...value, targetDescription: e.target.value })}
              rows={2}
              placeholder='Describe the type of agents to discover, e.g. "VC investors", "SaaS founders"...'
              className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none text-sm leading-relaxed resize-none"
            />
            <p className="text-[11px] text-gray-400">The system will search for agents matching this description.</p>
          </div>

          {/* Conversation goal */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Conversation goal</label>
            <textarea
              value={value.conversationGoal}
              onChange={(e) => onChange({ ...value, conversationGoal: e.target.value })}
              rows={2}
              placeholder={`e.g. "Learn about the investor's focus areas and get their contact info"`}
              className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none text-sm leading-relaxed resize-none"
            />
            <p className="text-[11px] text-gray-400">
              The bot will work toward this goal during the conversation and end when achieved.
            </p>
          </div>

          {/* Opening message */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Opening message</label>
            <textarea
              value={value.openingMessage}
              onChange={(e) => onChange({ ...value, openingMessage: e.target.value })}
              rows={2}
              placeholder="The first message the bot sends when it finds a matching agent."
              className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none text-sm leading-relaxed resize-none"
            />
          </div>

          {/* Limits */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-gray-700">Max turns per conversation</label>
              <p className="text-[11px] text-gray-400">Safety limit. The conversation ends automatically after this many rounds.</p>
              <input
                type="number"
                min={1}
                max={100}
                value={value.maxTurns}
                onChange={(e) => onChange({ ...value, maxTurns: Math.max(1, parseInt(e.target.value) || 20) })}
                className="w-32 px-3 py-1.5 bg-white border border-gray-200 rounded-lg outline-none text-sm focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-gray-700">Scan interval (minutes)</label>
              <p className="text-[11px] text-gray-400">How often the bot searches for new target agents.</p>
              <input
                type="number"
                min={1}
                max={1440}
                value={value.scanIntervalMinutes}
                onChange={(e) => onChange({ ...value, scanIntervalMinutes: Math.max(1, parseInt(e.target.value) || 60) })}
                className="w-32 px-3 py-1.5 bg-white border border-gray-200 rounded-lg outline-none text-sm focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-gray-700">Max concurrent sessions</label>
              <p className="text-[11px] text-gray-400">How many auto-discovery conversations can run at the same time for this bot.</p>
              <input
                type="number"
                min={1}
                max={10}
                value={value.maxConcurrent}
                onChange={(e) => onChange({ ...value, maxConcurrent: Math.max(1, parseInt(e.target.value) || 2) })}
                className="w-32 px-3 py-1.5 bg-white border border-gray-200 rounded-lg outline-none text-sm focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-gray-700">Max sessions per day</label>
              <p className="text-[11px] text-gray-400">Daily limit on the number of new conversations this bot can initiate.</p>
              <input
                type="number"
                min={1}
                max={100}
                value={value.maxDailySessions}
                onChange={(e) => onChange({ ...value, maxDailySessions: Math.max(1, parseInt(e.target.value) || 10) })}
                className="w-32 px-3 py-1.5 bg-white border border-gray-200 rounded-lg outline-none text-sm focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160]"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
