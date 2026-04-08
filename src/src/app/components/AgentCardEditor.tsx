import { useState } from "react";
import { Plus, X, Globe, Lock, Users } from "lucide-react";
import { cn } from "../../utils/cn";

/** Agent card for discovery/A2A. `skills` is the API field name only — these are search/discovery tags, not Creez builtin tool toggles. */
export type AgentCardData = {
  description: string;
  skills: string[];
  visibility: "public" | "private" | "unlisted";
};

interface AgentCardEditorProps {
  value: AgentCardData;
  onChange: (v: AgentCardData) => void;
}

const VISIBILITY_OPTIONS = [
  { id: "public" as const, label: "Public", desc: "Discoverable in search", icon: Globe },
  { id: "unlisted" as const, label: "Unlisted", desc: "Anyone with the link", icon: Users },
  { id: "private" as const, label: "Private", desc: "Only you", icon: Lock },
];

export function AgentCardEditor({ value, onChange }: AgentCardEditorProps) {
  const [newSkill, setNewSkill] = useState("");

  const addSkill = () => {
    const s = newSkill.trim();
    if (!s || value.skills.includes(s)) return;
    onChange({ ...value, skills: [...value.skills, s] });
    setNewSkill("");
  };

  const removeSkill = (skill: string) => {
    onChange({ ...value, skills: value.skills.filter((s) => s !== skill) });
  };

  return (
    <div className="space-y-5">
      {/* Description */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">Description</label>
        <textarea
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          rows={3}
          placeholder="Describe what this agent does. Others see this when browsing the A2A network."
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm text-sm leading-relaxed resize-none"
        />
        <p className="text-[11px] text-gray-400">Shown on the A2A network and in discovery.</p>
      </div>

      {/* agent_card_json.skills: discovery tags only (not Pi/builtin toggles) */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">Discovery tags</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {value.skills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#07C160]/10 text-[#07C160] text-xs font-medium rounded-full"
            >
              {skill}
              <button
                onClick={() => removeSkill(skill)}
                className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-[#07C160]/20 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addSkill(); }
            }}
            placeholder="Type a tag and press Enter"
            className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none text-sm"
          />
          <button
            onClick={addSkill}
            disabled={!newSkill.trim()}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm transition-colors disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
        <p className="text-[11px] text-gray-400">Other agents can match on tags (e.g. vc, finance, support).</p>
      </div>

      {/* Visibility */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">Visibility</label>
        <div className="grid grid-cols-3 gap-2">
          {VISIBILITY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = value.visibility === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onChange({ ...value, visibility: opt.id })}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center",
                  selected
                    ? "border-[#07C160] bg-[#07C160]/5 text-[#07C160]"
                    : "border-gray-200 hover:border-gray-300 text-gray-500"
                )}
              >
                <Icon size={18} />
                <span className="text-xs font-semibold">{opt.label}</span>
                <span className="text-[10px] opacity-70">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
