import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, Save, Info } from "lucide-react";
import { cn } from "../../utils/cn";
import { toast } from "sonner";
import { ChannelPlatformIconBox } from "./ChannelPlatformIcon";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
}

const BOT_CHANNEL_DEFS: Record<string, { label: string; fields: ChannelField[] }> = {
  feishu: {
    label: "Feishu / Lark",
    fields: [
      { key: "FEISHU_APP_ID", label: "App ID", placeholder: "cli_xxxxxxxxxxxxxxxx", hint: "Found in Feishu Open Platform → Credentials" },
      { key: "FEISHU_APP_SECRET", label: "App Secret", placeholder: "Enter App Secret", hint: "Keep this private — do not share" },
      { key: "FEISHU_OPEN_ID", label: "Open ID", placeholder: "ou_xxxxxxxxxxxxxxxx", hint: "Target user / bot Open ID" },
    ],
  },
  wecom: {
    label: "WeCom",
    fields: [
      { key: "WECOM_BOT_ID", label: "Bot ID", placeholder: "Enter Bot ID", hint: "Found in WeCom AI Bot console" },
      { key: "WECOM_SECRET", label: "Secret", placeholder: "Enter Secret", hint: "Keep this private — do not share" },
    ],
  },
};

const BOT_CHANNEL_OPTIONS = Object.entries(BOT_CHANNEL_DEFS).map(([id, def]) => ({
  id,
  label: def.label,
}));

interface ChannelConfigItem {
  id: string;
  channelType: string;
  values: Record<string, string>;
  isOpen: boolean;
  enabled: boolean;
}

export function BotChannelConfigPanel({ botId }: { botId: string }) {
  const [channels, setChannels] = useState<ChannelConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    const api = window.electron?.channel?.listConfigs;
    if (!api || !botId) { setLoading(false); return; }
    const res = await api({ botId });
    if (!res?.ok || !res.data?.items) {
      setChannels([]);
      setLoading(false);
      return;
    }
    const items: ChannelConfigItem[] = res.data.items
      .filter((c: any) => c.channelType === "feishu" || c.channelType === "wecom")
      .map((c: any) => ({
        id: c.id,
        channelType: c.channelType,
        values: c.values ?? {},
        isOpen: true,
        enabled: c.enabled,
      }));
    setChannels(items);
    setLoading(false);
  }, [botId]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const update = (id: string, patch: Partial<ChannelConfigItem>) =>
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));

  const addChannel = () =>
    setChannels(prev => [
      ...prev,
      { id: `new-${Date.now()}`, channelType: "feishu", values: {}, isOpen: true, enabled: false },
    ]);

  const saveChannel = async (config: ChannelConfigItem) => {
    const api = window.electron?.channel?.saveConfig;
    if (!api) return;
    setSavingId(config.id);
    const res = await api({
      botId,
      channelType: config.channelType,
      enabled: config.enabled,
      values: config.values,
    });
    setSavingId(null);
    if (res?.ok) {
      toast.success("Channel config saved");
      await loadConfigs();
    } else {
      toast.error(res?.error?.message ?? "Failed to save");
    }
  };

  const deleteChannel = async (config: ChannelConfigItem) => {
    const api = window.electron?.channel?.deleteConfig;
    if (!api) return;
    const res = await api({ botId, channelType: config.channelType });
    if (res?.ok) {
      setChannels(prev => prev.filter(c => c.id !== config.id));
      toast.success("Channel removed");
    } else {
      toast.error(res?.error?.message ?? "Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-6 h-6 border-2 border-[#07C160] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center text-blue-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Channels</span>
          <span className="text-sm font-semibold text-gray-700 mt-1">External Access</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="ml-1 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors">
              <Info size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
            Deploy this Agent to a Feishu or WeCom group so external users can chat with it directly. Conversations won't appear in the app — a summary will be generated and sent to you when the conversation ends.
          </TooltipContent>
        </Tooltip>
      </div>

      {channels.map(config => {
        const def = BOT_CHANNEL_DEFS[config.channelType] ?? BOT_CHANNEL_DEFS.feishu;
        return (
          <div key={config.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white transition-all hover:shadow-md group">
            <div
              className="flex items-center justify-between p-4 bg-white cursor-pointer select-none group-hover:bg-gray-50/50 transition-colors"
              onClick={() => update(config.id, { isOpen: !config.isOpen })}
            >
              <div className="flex items-center gap-3">
                <ChannelPlatformIconBox channelType={config.channelType} />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Channel</span>
                  <span className="text-sm font-semibold text-gray-700 mt-1">{def.label}</span>
                </div>
                <span className={cn(
                  "ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                  config.enabled ? "bg-green-50 text-green-600 border-green-100" : "bg-gray-100 text-gray-400 border-gray-200"
                )}>
                  {config.enabled ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={e => { e.stopPropagation(); deleteChannel(config); }}
                  className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                >
                  <Trash2 size={16} />
                </button>
                <button className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 transition-all">
                  {config.isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {config.isOpen && (
              <div className="p-6 pt-2 space-y-6 animate-in slide-in-from-top-2 duration-200 bg-white border-t border-gray-50">
                <div className="grid grid-cols-2 gap-6 items-end">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Platform</label>
                    <div className="relative">
                      <select
                        value={config.channelType}
                        onChange={e => { e.stopPropagation(); update(config.id, { channelType: e.target.value, values: {} }); }}
                        className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-medium transition-all shadow-inner"
                      >
                        {BOT_CHANNEL_OPTIONS.map(o => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-3.5 text-gray-400 pointer-events-none" size={14} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</label>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); update(config.id, { enabled: !config.enabled }); }}
                      className={cn(
                        "flex items-center gap-2 w-full py-2.5 px-4 rounded-lg border text-sm font-medium transition-all",
                        config.enabled ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                      )}
                    >
                      <span className={cn("w-2 h-2 rounded-full", config.enabled ? "bg-green-500" : "bg-gray-400")} />
                      {config.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Credentials</span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                  {def.fields.map(field => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{field.label}</label>
                      <input
                        type="text"
                        value={config.values[field.key] ?? ""}
                        onChange={e => update(config.id, { values: { ...config.values, [field.key]: e.target.value } })}
                        placeholder={field.placeholder}
                        className="w-full bg-gray-50 border border-gray-200 text-gray-800 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-mono text-sm transition-all shadow-inner"
                      />
                      {field.hint && <p className="text-[10px] text-gray-400 px-0.5">{field.hint}</p>}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); saveChannel(config); }}
                    disabled={savingId === config.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                      savingId === config.id ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-[#07C160] text-white hover:bg-[#06ad56]"
                    )}
                  >
                    {savingId === config.id
                      ? <span className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                      : <Save size={14} />}
                    {savingId === config.id ? "Saving..." : "Save"}
                  </button>
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
        Add Channel
      </button>
    </div>
  );
}
