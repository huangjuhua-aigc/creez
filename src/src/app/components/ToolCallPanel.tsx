import { useState } from "react";
import { ChevronRight, CheckCircle2, XCircle, Loader2, Terminal, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface ToolCall {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: "success" | "failure" | "running";
  result?: string;
}

function StatusBadge({ status }: { status: ToolCall["status"] }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-sky-500 bg-sky-50 px-1.5 py-0.5 rounded-full shrink-0 border border-sky-100">
        <Loader2 size={8} className="animate-spin" />
        Running
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full shrink-0 border border-emerald-100">
        <CheckCircle2 size={8} />
        Done
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full shrink-0 border border-red-100">
      <XCircle size={8} />
      Failed
    </span>
  );
}

function ToolCard({ toolCall }: { toolCall: ToolCall }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-100/70 transition-colors text-left"
      >
        <ChevronRight
          size={11}
          className={`text-zinc-400 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-90" : ""}`}
        />
        <span
          className={`flex-1 text-[11px] font-mono truncate ${toolCall.status === "running" ? "text-zinc-500" : "text-zinc-600"}`}
        >
          {toolCall.toolName}
        </span>
        {toolCall.status === "running" && (
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" />
        )}
        <StatusBadge status={toolCall.status} />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-2.5 rounded-lg border border-zinc-100 overflow-hidden bg-white">
              <div className="px-2.5 py-2 border-b border-zinc-100">
                <div className="flex items-center gap-1 text-[9px] text-zinc-400 uppercase tracking-widest mb-1.5">
                  <Terminal size={8} />
                  Parameters
                </div>
                <pre className="text-[10.5px] text-zinc-500 bg-zinc-50 rounded-md p-2 overflow-x-auto leading-relaxed border border-zinc-100/80 font-mono">
                  {JSON.stringify(toolCall.parameters, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ToolCallGroupProps {
  toolCalls: ToolCall[];
}

export function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  if (!toolCalls || toolCalls.length === 0) return null;

  const runCount = toolCalls.filter((t) => t.status === "running").length;

  return (
    <div className="mt-2 rounded-xl border border-zinc-200/80 overflow-hidden bg-zinc-50/60 max-w-xs w-full text-xs">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-200/60">
        <div className="w-4 h-4 rounded-md bg-zinc-200/80 flex items-center justify-center shrink-0">
          <Zap size={9} className="text-zinc-500" />
        </div>
        <span className="text-[10px] text-zinc-400 font-medium">Tool Calls</span>
        <span className="text-[10px] text-zinc-300 ml-0.5">·</span>
        <span className="text-[10px] text-zinc-400">
          {toolCalls.length} task{toolCalls.length > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {runCount > 0 && <Loader2 size={11} className="text-sky-400 animate-spin" />}
        </div>
      </div>

      <div className="divide-y divide-zinc-100">
        {toolCalls.map((tc) => (
          <ToolCard key={tc.id} toolCall={tc} />
        ))}
      </div>
    </div>
  );
}
