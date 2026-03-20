import { useEffect, useState, useCallback } from "react";
import { Bot, Plus, X, Sparkles, Camera, Database, ChevronDown, ChevronUp, Radio, Save, Globe, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../../utils/cn";
import { toast } from "sonner";

type AgentListItem = {
  id: string;
  name: string;
  avatar_url: string | null;
  status: string;
  updated_at: string;
};

type NotifyChannel = {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, string>;
};

type AgentDetail = {
  id: string;
  name: string;
  avatar_url: string | null;
  system_prompt: string;
  greeting_message: string;
  knowledge: string;
  skills_json: Record<string, boolean>;
  notify_channels: NotifyChannel[];
  status: string;
};

interface ChannelFieldDef {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
  hint?: string;
}

const CHANNEL_DEFS: Record<string, { label: string; color: string; fields: ChannelFieldDef[] }> = {
  feishu: {
    label: "Feishu / Lark",
    color: "bg-blue-50 text-blue-600",
    fields: [
      { key: "FEISHU_APP_ID",     label: "App ID",     type: "text", placeholder: "cli_xxxxxxxxxxxxxxxx",    hint: "Found in Feishu Open Platform → Credentials" },
      { key: "FEISHU_APP_SECRET", label: "App Secret", type: "text", placeholder: "Enter App Secret",        hint: "Keep this private — do not share" },
      { key: "FEISHU_OPEN_ID",    label: "Open ID",    type: "text", placeholder: "ou_xxxxxxxxxxxxxxxx",     hint: "Target user / bot Open ID" },
    ],
  },
  wecom: {
    label: "WeCom",
    color: "bg-green-50 text-green-600",
    fields: [
      { key: "WECOM_BOT_ID", label: "Bot ID",  type: "text", placeholder: "Enter Bot ID", hint: "Found in WeCom AI Bot console" },
      { key: "WECOM_SECRET", label: "Secret",   type: "text", placeholder: "Enter Secret", hint: "Keep this private — do not share" },
    ],
  },
  slack: {
    label: "Slack",
    color: "bg-yellow-50 text-yellow-600",
    fields: [
      { key: "SLACK_BOT_TOKEN",      label: "Bot Token",      type: "text", placeholder: "xoxb-xxxxxxxxxxxx" },
      { key: "SLACK_SIGNING_SECRET", label: "Signing Secret", type: "text", placeholder: "Enter Signing Secret" },
      { key: "SLACK_CHANNEL_ID",     label: "Channel ID",     type: "text", placeholder: "C0XXXXXXXX" },
    ],
  },
  telegram: {
    label: "Telegram",
    color: "bg-sky-50 text-sky-600",
    fields: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Bot Token", type: "text", placeholder: "123456789:ABC-xxxxxxxxxxxx" },
      { key: "TELEGRAM_CHAT_ID",   label: "Chat ID",   type: "text", placeholder: "-100xxxxxxxxxx" },
    ],
  },
  dingtalk: {
    label: "DingTalk",
    color: "bg-orange-50 text-orange-500",
    fields: [
      { key: "DINGTALK_APP_KEY",    label: "App Key",    type: "text", placeholder: "dingxxxxxxxxxx" },
      { key: "DINGTALK_APP_SECRET", label: "App Secret", type: "text", placeholder: "Enter App Secret" },
      { key: "DINGTALK_ROBOT_CODE", label: "Robot Code", type: "text", placeholder: "Enter Robot Code" },
    ],
  },
};

const CHANNEL_OPTIONS = Object.entries(CHANNEL_DEFS).map(([id, def]) => ({
  id,
  label: def.label,
  available: id === "feishu" || id === "wecom",
}));

const EMPTY_AGENT: AgentDetail = {
  id: "",
  name: "",
  avatar_url: null,
  system_prompt: "",
  greeting_message: "",
  knowledge: "",
  skills_json: { knowledge_search: true, vc_lead_capture: true },
  notify_channels: [],
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
  const [channelOpenSet, setChannelOpenSet] = useState<Set<string>>(new Set());

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
        notify_channels: d.notify_channels || [],
        status: d.status,
      });
      setAvatarPreview(d.avatar_url || "");
      setIsNew(false);
      setIsKnowledgeOpen(!!d.knowledge || !!d.system_prompt);
      setChannelOpenSet(new Set((d.notify_channels || []).map((ch: NotifyChannel) => ch.id)));
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
    setChannelOpenSet(new Set());
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
        notify_channels: form.notify_channels,
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
        notify_channels: form.notify_channels,
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

  const addChannel = () => {
    const newId = crypto.randomUUID();
    setForm((prev) => ({
      ...prev,
      notify_channels: [
        ...prev.notify_channels,
        { id: newId, channel_type: "feishu", enabled: true, config: {} },
      ],
    }));
    setChannelOpenSet((prev) => new Set(prev).add(newId));
  };

  const updateChannel = (idx: number, patch: Partial<NotifyChannel>) => {
    setForm((prev) => {
      const channels = [...prev.notify_channels];
      channels[idx] = { ...channels[idx], ...patch };
      if (patch.channel_type && patch.channel_type !== prev.notify_channels[idx].channel_type) {
        channels[idx].config = {};
      }
      return { ...prev, notify_channels: channels };
    });
  };

  const toggleChannelOpen = (id: string) => {
    setChannelOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeChannel = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      notify_channels: prev.notify_channels.filter((_, i) => i !== idx),
    }));
  };

  const updateChannelConfig = (idx: number, key: string, value: string) => {
    setForm((prev) => {
      const channels = [...prev.notify_channels];
      channels[idx] = { ...channels[idx], config: { ...channels[idx].config, [key]: value } };
      return { ...prev, notify_channels: channels };
    });
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

            {/* Notification Channels — Same card style as ChannelSettings */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded bg-orange-50 flex items-center justify-center text-orange-500">
                  <Radio size={16} />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Channels</span>
                  <span className="text-sm font-semibold text-gray-700 mt-1">Notification Output</span>
                </div>
              </div>

              {form.notify_channels.map((ch, idx) => {
                const def = CHANNEL_DEFS[ch.channel_type] || CHANNEL_DEFS.feishu;
                const isOpen = channelOpenSet.has(ch.id);
                return (
                  <div key={ch.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white transition-all hover:shadow-md group">
                    {/* Card header */}
                    <div
                      className="flex items-center justify-between p-4 bg-white cursor-pointer select-none group-hover:bg-gray-50/50 transition-colors"
                      onClick={() => toggleChannelOpen(ch.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-100 text-gray-400">
                          <Radio size={16} className="text-blue-600" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Channel</span>
                          <span className="text-sm font-semibold text-gray-700 mt-1">{def.label}</span>
                        </div>
                        <span className={cn(
                          "ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                          ch.enabled ? "bg-green-50 text-green-600 border-green-100" : "bg-gray-100 text-gray-400 border-gray-200"
                        )}>
                          {ch.enabled ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeChannel(idx); }}
                          className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                        <button className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 transition-all">
                          {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* Card body */}
                    {isOpen && (
                      <div className="p-6 pt-2 space-y-6 animate-in slide-in-from-top-2 duration-200 bg-white border-t border-gray-50">
                        <div className="grid grid-cols-2 gap-6 items-end">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Platform</label>
                            <div className="relative">
                              <select
                                value={ch.channel_type}
                                onChange={(e) => { e.stopPropagation(); const v = e.target.value; if (CHANNEL_OPTIONS.find((x) => x.id === v)?.available) updateChannel(idx, { channel_type: v }); }}
                                className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-medium transition-all shadow-inner"
                              >
                                {CHANNEL_OPTIONS.map((o) => (
                                  <option key={o.id} value={o.id} disabled={!o.available}>
                                    {o.label}{!o.available ? " (Coming soon)" : ""}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-4 top-3.5 text-gray-400 pointer-events-none" size={14} />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</label>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); updateChannel(idx, { enabled: !ch.enabled }); }}
                              className={cn(
                                "flex items-center gap-2 w-full py-2.5 px-4 rounded-lg border text-sm font-medium transition-all",
                                ch.enabled ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                              )}
                            >
                              <span className={cn("w-2 h-2 rounded-full", ch.enabled ? "bg-green-500" : "bg-gray-400")} />
                              {ch.enabled ? "Enabled" : "Disabled"}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Credentials</span>
                            <div className="flex-1 h-px bg-gray-100" />
                          </div>
                          {def.fields.map((field) => (
                            <div key={field.key} className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{field.label}</label>
                              <input
                                type={field.type}
                                value={ch.config[field.key] || ""}
                                onChange={(e) => updateChannelConfig(idx, field.key, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full bg-gray-50 border border-gray-200 text-gray-800 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-mono text-sm transition-all shadow-inner"
                              />
                              {field.hint && <p className="text-[10px] text-gray-400 px-0.5">{field.hint}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={addChannel}
                className="w-full py-6 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 font-bold hover:border-[#07C160] hover:text-[#07C160] hover:bg-[#07C160]/5 transition-all flex items-center justify-center gap-2 group active:scale-[0.99]"
              >
                <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" />
                Add New Channel
              </button>
            </div>

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
