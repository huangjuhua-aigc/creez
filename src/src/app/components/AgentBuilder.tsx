import { useEffect, useState, useCallback } from "react";
import { Bot, Plus, X, Sparkles, Camera, Database, ChevronDown, ChevronUp, Save, Globe, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../../utils/cn";
import { toast } from "sonner";
import { BotChannelConfigPanel } from "./BotChannelConfigPanel";

type AgentListItem = {
  id: string;
  name: string;
  avatar_url: string | null;
  status: string;
  updated_at: string;
};

type AgentDetail = {
  id: string;
  name: string;
  avatar_url: string | null;
  system_prompt: string;
  greeting_message: string;
  knowledge: string;
  skills_json: Record<string, boolean>;
  status: string;
};

const EMPTY_AGENT: AgentDetail = {
  id: "",
  name: "",
  avatar_url: null,
  system_prompt: "",
  greeting_message: "",
  knowledge: "",
  skills_json: { knowledge_search: true, vc_lead_capture: true },
  status: "draft",
};

export function AgentBuilder() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentDetail>({ ...EMPTY_AGENT });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);

  const api = window.electron?.agentBuilder;

  const loadList = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const result = await api.list();
    setLoading(false);
    if (result.ok) {
      setAgents(result.data.items);
    }
  }, [api]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadAgent = useCallback(async (id: string) => {
    if (!api) return;
    const result = await api.get({ id });
    if (result.ok) {
      const d = result.data;
      setForm({
        id: d.id,
        name: d.name,
        avatar_url: d.avatar_url,
        system_prompt: d.system_prompt,
        greeting_message: d.greeting_message,
        knowledge: d.knowledge || "",
        skills_json: d.skills_json || { knowledge_search: true, vc_lead_capture: true },
        status: d.status,
      });
      setAvatarPreview(d.avatar_url || "");
      setIsNew(false);
      setIsKnowledgeOpen(!!d.knowledge || !!d.system_prompt);
    }
  }, [api]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setIsNew(false);
    loadAgent(id);
  };

  const handleNew = () => {
    setSelectedId(null);
    setForm({ ...EMPTY_AGENT });
    setAvatarPreview("");
    setIsNew(true);
    setIsKnowledgeOpen(true);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setAvatarPreview(result);
        setForm((f) => ({ ...f, avatar_url: result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!api || !form.name.trim()) {
      toast.error("Please enter an Agent name");
      return;
    }
    setSaving(true);
    if (isNew) {
      const result = await api.create({
        name: form.name,
        system_prompt: form.system_prompt,
        greeting_message: form.greeting_message,
        knowledge: form.knowledge,
        avatar_url: form.avatar_url,
      });
      if (result.ok) {
        setIsNew(false);
        setSelectedId(result.data.id);
        await loadList();
        await loadAgent(result.data.id);
        toast.success("Agent created successfully!");
      } else {
        toast.error(result.error?.message || "Failed to create agent");
      }
    } else if (form.id) {
      const result = await api.update({
        id: form.id,
        name: form.name,
        system_prompt: form.system_prompt,
        greeting_message: form.greeting_message,
        knowledge: form.knowledge,
        avatar_url: form.avatar_url,
      });
      if (result.ok) {
        await loadList();
        toast.success("Agent updated successfully!");
      } else {
        toast.error(result.error?.message || "Failed to update agent");
      }
    }
    setSaving(false);
  };

  const handlePublish = async () => {
    if (!api || !form.id) return;
    setSaving(true);
    const result = await api.publish({ id: form.id });
    if (result.ok) {
      setForm((prev) => ({ ...prev, status: "published" }));
      await loadList();
      toast.success("Agent published!");
    }
    setSaving(false);
  };

  const handleDelete = async (agentId: string) => {
    if (!api) return;
    const result = await api.delete({ id: agentId });
    if (result.ok) {
      if (selectedId === agentId) {
        setSelectedId(null);
        setForm({ ...EMPTY_AGENT });
        setAvatarPreview("");
        setIsNew(false);
      }
      await loadList();
    }
  };

  const showForm = isNew || selectedId !== null;

  return (
    <div className="flex w-full h-full bg-[#FAFAFA]">
      {/* Left Panel — Agent List */}
      <div className="w-72 border-r border-gray-200 bg-white h-full flex flex-col pt-6">
        <div className="px-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900">Agents</h2>
          <p className="text-xs text-gray-500 mt-1">Create and manage your AI assistants</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {loading && agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 mt-8">
              <Bot size={40} className="mb-2 opacity-30 animate-pulse" />
              <p className="text-sm font-medium">Loading...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 mt-8">
              <Bot size={40} className="mb-2 opacity-30" />
              <p className="text-sm font-medium">No Agents yet</p>
            </div>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => handleSelect(agent.id)}
                className={cn(
                  "relative group flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all border",
                  selectedId === agent.id
                    ? "bg-[#07C160]/5 border-[#07C160]/20 text-[#07C160]"
                    : "bg-white border-transparent hover:bg-gray-50 text-gray-700"
                )}
              >
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-200 flex items-center justify-center">
                  {agent.avatar_url ? (
                    <img src={agent.avatar_url} alt={agent.name} className="w-full h-full object-cover" />
                  ) : (
                    <Bot size={20} className="text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold truncate">{agent.name}</h3>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    {agent.status === "published" ? "Published" : "Draft"}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(agent.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-400 rounded-md transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-gray-100 mt-auto">
          <Button
            onClick={handleNew}
            className="w-full bg-[#07C160] hover:bg-[#06ad56] text-white flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm h-auto"
          >
            <Plus size={16} />
            Create Agent
          </Button>
        </div>
      </div>

      {/* Right Panel — Configuration Form */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto custom-scrollbar">
        {!showForm ? (
          <div className="flex-1 h-full flex flex-col items-center justify-center text-gray-400">
            <Sparkles size={48} className="mb-4 opacity-20" />
            <h3 className="text-lg font-bold text-gray-600">Select or Create an Agent</h3>
            <p className="text-sm mt-1">Start configuring your AI assistant</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[600px] flex flex-col space-y-8 animate-in fade-in duration-300">

            {/* Header */}
            <header className="border-b border-gray-100 pb-4 flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Agent Configuration</h1>
                <p className="text-gray-500 mt-1 text-sm">Customize the identity, knowledge, and output channels.</p>
              </div>
              {form.status === "published" && (
                <span className="px-3 py-1 bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-wider rounded-full border border-green-100">Published</span>
              )}
            </header>

            {/* Avatar Section */}
            <div className="flex items-center gap-8 p-6 bg-gray-50 rounded-xl border border-gray-100">
              <div className="relative group cursor-pointer">
                <div className="w-28 h-28 rounded-full border-4 border-white overflow-hidden bg-white flex items-center justify-center shadow-md group-hover:shadow-lg transition-all ring-1 ring-gray-100">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <Bot className="text-[#07C160] w-12 h-12" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-full">
                    <Camera size={24} className="text-white" />
                  </div>
                </div>
                <label className="absolute bottom-1 right-1 w-9 h-9 bg-[#07C160] rounded-full flex items-center justify-center text-white cursor-pointer hover:bg-[#06ad56] transition-colors shadow-md border-2 border-white">
                  <Plus size={18} />
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">Assistant Profile</h3>
                <p className="text-sm text-gray-500 mt-1 max-w-sm leading-relaxed">
                  This identity will represent the agent in your workspace.
                </p>
                <div className="mt-4 flex gap-2">
                  <span className={cn(
                    "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border",
                    form.status === "published"
                      ? "bg-green-50 text-green-700 border-green-100"
                      : "bg-amber-50 text-amber-700 border-amber-100"
                  )}>
                    {form.status === "published" ? "Published" : "Draft"}
                  </span>
                  <span className="px-3 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-wider rounded-full border border-gray-200">Custom Bot</span>
                </div>
              </div>
            </div>

            {/* Name & Greeting */}
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Display Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Support Bot, Data Analyst..."
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Greeting Message</label>
                <input
                  type="text"
                  value={form.greeting_message}
                  onChange={(e) => setForm((f) => ({ ...f, greeting_message: e.target.value }))}
                  placeholder="e.g. Hello! How can I help you today?"
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            {/* System Prompt */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">System Prompt</label>
              <textarea
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                rows={3}
                placeholder="e.g. You are a helpful assistant that specializes in..."
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm text-sm leading-relaxed resize-none"
              />
              <p className="text-[11px] text-gray-400">Behavioral instructions sent to the LLM as context.</p>
            </div>

            {/* Knowledge Base — Collapsible */}
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white transition-all hover:shadow-md group">
              <div
                className="flex items-center justify-between p-4 bg-white cursor-pointer select-none group-hover:bg-gray-50/50 transition-colors"
                onClick={() => setIsKnowledgeOpen(!isKnowledgeOpen)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center text-blue-600">
                    <Database size={16} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Knowledge</span>
                    <span className="text-sm font-semibold text-gray-700 mt-1">Knowledge Base (RAG)</span>
                  </div>
                </div>
                <button className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 transition-all">
                  {isKnowledgeOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>

              {isKnowledgeOpen && (
                <div className="p-6 pt-2 space-y-6 bg-white border-t border-gray-50 animate-in slide-in-from-top-2 duration-200">
                  <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3 shadow-sm">
                    <div className="p-2 bg-blue-500 rounded-lg text-white flex-shrink-0">
                      <Database size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-blue-900">Knowledge Base</h4>
                      <p className="text-xs text-blue-700/80 mt-1 leading-relaxed">
                        Content here is split into paragraphs and indexed for RAG retrieval during conversations.
                      </p>
                    </div>
                  </div>

                  <div className="relative flex-1 h-[300px] flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                        <span className="ml-2 text-xs font-mono text-gray-500 font-medium">knowledge.md</span>
                      </div>
                    </div>
                    <textarea
                      value={form.knowledge}
                      onChange={(e) => setForm((f) => ({ ...f, knowledge: e.target.value }))}
                      className="w-full flex-1 p-6 outline-none font-mono text-sm leading-7 resize-none custom-scrollbar text-gray-800 bg-white"
                      spellCheck={false}
                      placeholder="# Paste your knowledge base content here...&#10;&#10;Each paragraph will be indexed for RAG search."
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Channel Access — deploy this bot to Feishu / WeCom */}
            {form.id && !isNew && (
              <BotChannelConfigPanel botId={form.id} />
            )}

            {/* Bottom Actions */}
            <div className="flex justify-end gap-3 pt-4 mt-auto">
              {!isNew && form.id && (
                <Button
                  onClick={async () => {
                    if (!form.id) return;
                    const ok = window.confirm("Delete this agent? This action cannot be undone.");
                    if (!ok) return;
                    await handleDelete(form.id);
                  }}
                  disabled={saving}
                  className="bg-white hover:bg-red-50 text-red-600 border border-red-200 px-5 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 h-auto"
                >
                  <Trash2 size={16} />
                  Delete
                </Button>
              )}
              {!isNew && form.status !== "published" && (
                <Button
                  onClick={handlePublish}
                  disabled={saving}
                  className="bg-white hover:bg-gray-50 text-[#07C160] border border-[#07C160]/30 px-5 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 h-auto"
                >
                  <Globe size={16} />
                  Publish
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="bg-[#07C160] hover:bg-[#06ad56] text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-sm flex items-center gap-2 h-auto"
              >
                <Save size={16} />
                {saving ? "Saving..." : isNew ? "Publish Agent" : "Update"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
