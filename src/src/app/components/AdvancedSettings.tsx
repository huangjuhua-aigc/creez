import { useState, useEffect, useRef } from 'react';
import { cn } from '../../utils/cn';
import { Bot, Brain, Database, Cpu, ChevronDown, ChevronUp, Plus, Trash2, Eye, EyeOff, Save, Upload, User, Camera, CheckCircle2, RotateCcw, Folder } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { toast } from 'sonner';
import { fetchAssistantConfig, fetchModelApiKey, persistAssistantConfig, readMemory, writeMemory, uploadAssistantAvatar, selectWorkplaceDirectory, readLocalImageDataUrl, listAvailableSkills } from '../services/settings';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

export function AdvancedSettings() {
  const [activeSection, setActiveSection] = useState('identity');

  const sections = [
    { id: 'identity', label: 'AI Identity', icon: Bot, description: 'Customize the persona and interaction style.' },
    { id: 'skills', label: 'Skills', icon: Brain, description: 'Define what tasks the AI can perform.' },
    { id: 'memory', label: 'Memory', icon: Database, description: 'Manage conversation history and context retention.' },
    { id: 'model', label: 'Model Config', icon: Cpu, description: 'Configure LLM providers and models.' },
  ];

  return (
    <div className="flex w-full h-full bg-[#FAFAFA]">
      {/* Settings Sidebar */}
      <div className="w-64 border-r border-gray-200 bg-white h-full flex flex-col pt-6">
        <div className="px-6 mb-8">
            <h2 className="text-xl font-bold text-gray-900">Settings</h2>
            <p className="text-xs text-gray-500 mt-1">Configure your AI assistant</p>
        </div>
        <div className="flex flex-col gap-1 px-3">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left group",
                  isActive 
                    ? "text-[#07C160]" 
                    : "text-gray-600 hover:bg-gray-100"
                )}
              >
                <div className={cn(
                    "p-1.5 rounded-md transition-colors",
                    isActive ? "text-[#07C160]" : "text-gray-500"
                )}>
                    <Icon size={16} />
                </div>
                {section.label}
              </button>
            );
          })}
        </div>

      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto custom-scrollbar">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[600px]">
          <header className="mb-8 border-b border-gray-100 pb-4">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              {sections.find(s => s.id === activeSection)?.label}
            </h1>
            <p className="text-gray-500 mt-1 text-sm">
              {sections.find(s => s.id === activeSection)?.description}
            </p>
          </header>

          {/* Render Active Content */}
          <div className="space-y-6 animate-in fade-in duration-300">
            {activeSection === 'identity' && <IdentitySettings />}
            {activeSection === 'skills' && <SkillsSettings />}
            {activeSection === 'memory' && <MemorySettings />}
            {activeSection === 'model' && <ModelSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 1. Identity Settings ---

function IdentitySettings() {
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [botName, setBotName] = useState('My Assistant');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful, professional AI assistant. You answer questions concisely and accurately.');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarDisplaySrc, setAvatarDisplaySrc] = useState<string | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState('~/.creez/workplace');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAssistantConfig().then((config) => {
      if (cancelled) return;
      setBotName(config.name || 'My Assistant');
      setSystemPrompt(
        config.systemPrompt || 'You are a helpful, professional AI assistant. You answer questions concisely and accurately.'
      );
      setAvatarPath(config.avatar || null);
    });
    window.electron?.app?.getState?.().then((res) => {
      if (!cancelled && res?.ok && res.data.workspaceRoot) {
        setWorkspaceDir(String(res.data.workspaceRoot));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAvatarDisplay() {
      if (!avatarPath) {
        setAvatarDisplaySrc(null);
        return;
      }
      const dataUrl = await readLocalImageDataUrl(avatarPath);
      if (!cancelled) {
        setAvatarDisplaySrc(dataUrl || null);
      }
    }
    loadAvatarDisplay();
    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp']);
      if (!acceptedTypes.has(file.type)) {
        toast.error('Unsupported image format. Please choose PNG/JPG/WEBP/GIF/BMP.');
        e.target.value = '';
        return;
      }
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error('Avatar image must be no larger than 10MB.');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        setAvatarPreview(dataUrl);
        const uploaded = await uploadAssistantAvatar(dataUrl, file.name);
        if (uploaded) {
          setAvatarPath(uploaded);
          await persistAssistantConfig({ avatar: uploaded });
          toast.success('Avatar saved');
        } else {
          toast.error('Failed to save avatar');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const openAvatarPicker = () => {
    fileInputRef.current?.click();
  };

  const handleSelectWorkspaceDirectory = async () => {
    const selected = await selectWorkplaceDirectory();
    if (!selected) return;
    setWorkspaceDir(selected);
    await window.electron?.app?.setState?.({ workspaceRoot: selected });
  };

  const persistIdentity = async () => {
    const ok = await persistAssistantConfig({
      name: botName,
      systemPrompt,
      avatar: avatarPath,
    });
    if (!ok) toast.error('Failed to save identity config');
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Avatar Section */}
      <div className="flex items-center gap-8 p-6 bg-gray-50 rounded-xl border border-gray-100">
        <div className="relative group cursor-pointer" onClick={openAvatarPicker}>
          <div className="w-28 h-28 rounded-full border-4 border-white overflow-hidden bg-white flex items-center justify-center shadow-md group-hover:shadow-lg transition-all ring-1 ring-gray-100">
            {avatarPreview || avatarDisplaySrc ? (
              <img src={avatarPreview || String(avatarDisplaySrc)} alt="Bot Avatar" className="w-full h-full object-cover" />
            ) : (
              <Bot className="text-[#07C160] w-12 h-12" />
            )}
            
            {/* Overlay on hover */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-full">
                <Camera size={24} className="text-white" />
            </div>
          </div>
          <label className="absolute bottom-1 right-1 w-9 h-9 bg-[#07C160] rounded-full flex items-center justify-center text-white cursor-pointer hover:bg-[#06ad56] transition-colors shadow-md border-2 border-white">
            <Plus size={18} />
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              className="hidden" 
              onChange={handleAvatarChange}
            />
          </label>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900">Assistant Profile</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-sm leading-relaxed">
            This identity will be visible across all your workspaces and chats.
          </p>
          <div className="mt-4 flex gap-2">
             <span className="px-3 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-wider rounded-full border border-gray-200">System Bot</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">Display Name</label>
          <input 
            type="text" 
            value={botName}
            onChange={(e) => setBotName(e.target.value)}
            onBlur={persistIdentity}
            placeholder="e.g. Jarvis, Friday, or My Assistant"
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm"
          />
        </div>

        <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">How AI addresses you</label>
            <input 
                type="text" 
                defaultValue="Boss" 
                placeholder="e.g. Alex, Boss, Team Lead"
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm"
            />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">Workplace Directory</label>
          <div className="relative group">
            <input 
              type="text" 
              value={workspaceDir}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-inner"
              readOnly
            />
            <div className="absolute left-3 top-3 text-gray-400">
                <Folder size={18} />
            </div>
            <button
                onClick={handleSelectWorkspaceDirectory}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-white border border-gray-200 rounded text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
                Change
            </button>
          </div>
          <p className="text-[11px] text-gray-400 px-1">This directory is used for local file operations and storage.</p>
        </div>
        
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">User Persona</label>
          <textarea 
            rows={8} 
            value={systemPrompt}
            maxLength={200}
            onChange={(e) => setSystemPrompt(e.target.value.slice(0, 200))}
            onBlur={persistIdentity}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all font-mono text-sm resize-none leading-relaxed shadow-sm"
          />
          <div className="flex justify-between items-center px-1">
             <span />
             <span className="text-[11px] text-gray-400">{systemPrompt.length}/200</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 2. Skills Settings ---

function SkillsSettings() {
    const [skills, setSkills] = useState<Array<{ id: string; name: string; desc: string; enabled: boolean }>>([]);

    useEffect(() => {
        let cancelled = false;
        Promise.all([listAvailableSkills(), fetchAssistantConfig()]).then(([available, config]) => {
            if (cancelled) return;
            const next = available.map((s) => ({
                id: s.id,
                name: s.name,
                desc: s.description || 'Skill',
                enabled: Boolean(config.skills?.[s.id] ?? s.enabled),
            }));
            setSkills(next);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const persistSkills = async (nextSkills: Array<{ id: string; enabled: boolean }>) => {
        const payload: Record<string, boolean> = {};
        nextSkills.forEach((s) => {
            payload[s.id] = Boolean(s.enabled);
        });
        const ok = await persistAssistantConfig({ skills: payload });
        if (!ok) toast.error('Failed to save skills');
    };

    const toggleSkill = (id: string) => {
        const next = skills.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
        setSkills(next);
        persistSkills(next);
    };

    const sortedSkills = [...skills].sort((a, b) => {
        const enabledFirst = (a.enabled ? 0 : 1) - (b.enabled ? 0 : 1);
        return enabledFirst !== 0 ? enabledFirst : a.name.localeCompare(b.name);
    });

    return (
        <div className="grid grid-cols-1 gap-4">
            {sortedSkills.map((skill) => (
                <Tooltip key={skill.id} delayDuration={300}>
                    <TooltipTrigger asChild>
                        <div className={cn(
                            "border rounded-xl p-4 bg-white transition-all shadow-sm flex flex-col justify-between group cursor-default",
                            skill.enabled ? "border-[#07C160]/30 ring-1 ring-[#07C160]/5" : "border-gray-200"
                        )}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3 flex-1 min-w-0 pr-1">
                                    <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                                        skill.enabled ? "bg-[#07C160] text-white" : "bg-gray-100 text-gray-400"
                                    )}>
                                        <Brain size={20} />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-bold text-gray-800">{skill.name}</h3>
                                        <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
                                          {skill.desc.length > 50 ? `${skill.desc.slice(0, 50)}...` : skill.desc}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleSkill(skill.id); }}
                                    className={cn(
                                        "w-11 h-6 rounded-full relative transition-colors duration-200 ease-in-out focus:outline-none flex-shrink-0 mt-0.5",
                                        skill.enabled ? "bg-[#07C160]" : "bg-gray-200"
                                    )}
                                >
                                    <span className={cn(
                                        "block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out absolute top-1 left-1",
                                        skill.enabled ? "translate-x-5" : "translate-x-0"
                                    )} />
                                </button>
                            </div>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap text-left">
                        {skill.desc}
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
}

// --- 3. Memory Settings ---

function MemorySettings() {
    const [content, setContent] = useState(`# Memory File (memory.md)
# User Preferences
- User likes concise answers.
- User is a software engineer using React.
- User prefers dark mode examples.

# Project Context
- Current project: Desktop Bot App
- Stack: Electron, React, Tailwind
- Design System: Lucide Icons, Clean UI
`);
    const [memoryPath, setMemoryPath] = useState('');

    useEffect(() => {
        let cancelled = false;
        readMemory().then((memory) => {
            if (cancelled) return;
            setContent(memory.content || '');
            setMemoryPath(memory.path || '');
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const persistMemory = async () => {
        const ok = await writeMemory(content, memoryPath || undefined);
        if (!ok) toast.error('Failed to save memory');
    };

    const reloadMemory = async () => {
        const memory = await readMemory(memoryPath || undefined);
        setContent(memory.content || '');
        if (memory.path) setMemoryPath(memory.path);
    };

  return (
    <div className="h-full flex flex-col gap-6">
        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3 shadow-sm">
            <div className="p-2 bg-blue-500 rounded-lg text-white">
                <Database size={20} />
            </div>
            <div>
                <h4 className="text-sm font-bold text-blue-900">Knowledge & Context Retention</h4>
                <p className="text-xs text-blue-700/80 mt-1 leading-relaxed">
                    This file acts as the "brain" for your AI. Information stored here persists across sessions and helps the AI understand your preferences and current project context.
                </p>
            </div>
        </div>

        <div className="relative flex-1 min-h-[450px] flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    <span className="ml-2 text-xs font-mono text-gray-500 font-medium">{memoryPath ? memoryPath.split(/[\\/]/).pop() : 'memory.md'}</span>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={reloadMemory} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                        <RotateCcw size={14} />
                        Reload
                    </button>
                </div>
            </div>
            <textarea 
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={persistMemory}
                className="w-full flex-1 p-6 outline-none font-mono text-sm leading-7 resize-none custom-scrollbar text-gray-800"
                spellCheck={false}
            />
        </div>
    </div>
  );
}

// --- 4. Model Settings ---

interface ModelConfig {
    id: string;
    provider: string;
    model: string;
    apiKey: string;
    apiKeyMasked?: string;
    apiBase?: string;
    isOpen: boolean;
    active?: boolean;
}

const COMMON_PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
  { value: "groq", label: "Groq" },
  { value: "xai", label: "xAI" },
  { value: "minimax", label: "MiniMax" },
  { value: "minimax-cn", label: "MiniMax CN" },
  { value: "mistral", label: "Mistral" },
  { value: "openai-codex", label: "OpenAI Codex" },
  { value: "github-copilot", label: "GitHub Copilot" },
];

const PROVIDER_MODELS: Record<string, string[]> = {
  openrouter: [
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "openai/gpt-5",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.7-sonnet",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "minimax/minimax-m2.5",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-5", "gpt-5-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest", "claude-sonnet-4-20250514", "claude-3-5-haiku-latest"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "qwen-qwq-32b"],
  xai: ["grok-3-latest", "grok-3-mini-latest", "grok-4", "grok-4-fast"],
  minimax: ["MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2", "MiniMax-M2.5-highspeed"],
  "minimax-cn": ["MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2", "MiniMax-M2.5-highspeed"],
  mistral: ["mistral-large-latest", "mistral-medium-latest", "codestral-latest", "ministral-8b-latest"],
  "openai-codex": ["codex-mini-latest", "gpt-5-codex"],
  "github-copilot": ["gpt-4o", "claude-sonnet-4", "gemini-2.5-pro"],
};

const PROVIDER_ALIAS_TO_VALUE: Record<string, string> = {
  OpenRouter: "openrouter",
  OpenAI: "openai",
  Anthropic: "anthropic",
  Google: "google",
  "Google Gemini": "google",
  Groq: "groq",
  xAI: "xai",
  MiniMax: "minimax",
  "MiniMax CN (OpenAI API)": "minimax-cn",
  "MiniMax CN (Anthropic API)": "minimax-cn",
  "openai-codex": "openai-codex",
  "github-copilot": "github-copilot",
  DeepSeek: "openrouter",
  Moonshot: "openrouter",
  "Volcengine Ark": "openrouter",
};

function normalizeProviderValue(raw: string): string {
  if (!raw) return "openrouter";
  if (COMMON_PROVIDERS.some((p) => p.value === raw)) return raw;
  return PROVIDER_ALIAS_TO_VALUE[raw] || raw.toLowerCase();
}

function providerLabel(value: string): string {
  return COMMON_PROVIDERS.find((p) => p.value === value)?.label || value;
}

function ModelSettings() {
    const [models, setModels] = useState<ModelConfig[]>([]);
    const [showApiKeyById, setShowApiKeyById] = useState<Record<string, boolean>>({});
    const [isSavingById, setIsSavingById] = useState<Record<string, boolean>>({});
    const [savingKeyPreviewById, setSavingKeyPreviewById] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        fetchAssistantConfig().then((config) => {
            if (cancelled) return;
            if (!Array.isArray(config.models) || config.models.length === 0) return;
            setModels(
                config.models.map((m) => ({
                    id: m.id,
                    provider: normalizeProviderValue(m.provider || 'openrouter'),
                    model: m.model || 'gpt-4o',
                    apiKey: '',
                    apiKeyMasked: m.apiKeyMasked || '',
                    apiBase: m.apiBase || '',
                    isOpen: false,
                    active: Boolean(m.active),
                }))
            );
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const persistModels = async (nextModels: ModelConfig[]) => {
        const payload = nextModels.map((m) => ({
            id: m.id,
            provider: m.provider,
            model: m.model,
            apiBase: m.apiBase || '',
            apiKey: m.apiKey || '',
            active: Boolean(m.active),
        }));
        const ok = await persistAssistantConfig({ models: payload });
        return ok;
    };

    const toggleOpen = (id: string) => {
        setModels(models.map(m => m.id === id ? { ...m, isOpen: !m.isOpen } : m));
    };

    const updateModel = (id: string, field: keyof ModelConfig, value: any) => {
        setModels(models.map(m => {
            if (m.id !== id) return m;
            if (field === 'provider') {
                const nextProvider = normalizeProviderValue(String(value));
                const candidates = PROVIDER_MODELS[nextProvider] || [];
                const nextModel = candidates.length > 0 ? candidates[0] : m.model;
                return { ...m, provider: nextProvider, model: nextModel };
            }
            return { ...m, [field]: value };
        }));
    };

    const saveSingleModel = async (id: string) => {
        const currentModel = models.find((m) => m.id === id);
        const currentApiKey = currentModel?.apiKey || '';
        const startedAt = Date.now();
        setSavingKeyPreviewById((prev) => ({ ...prev, [id]: currentApiKey }));
        setIsSavingById((prev) => ({ ...prev, [id]: true }));
        const ok = await persistModels(models);
        const elapsed = Date.now() - startedAt;
        if (elapsed < 600) {
            await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
        }
        if (ok) {
            const refreshed = await fetchAssistantConfig();
            if (Array.isArray(refreshed.models) && refreshed.models.length > 0) {
                setModels(
                    refreshed.models.map((m) => ({
                        id: m.id,
                        provider: normalizeProviderValue(m.provider || 'openrouter'),
                        model: m.model || 'gpt-4o',
                        apiKey: '',
                        apiKeyMasked: m.apiKeyMasked || '',
                        apiBase: m.apiBase || '',
                        isOpen: false,
                        active: Boolean(m.active),
                    }))
                );
            }
            toast.success('Model config saved');
        } else {
            toast.error('Failed to save model config');
        }
        setIsSavingById((prev) => ({ ...prev, [id]: false }));
        setSavingKeyPreviewById((prev) => ({ ...prev, [id]: '' }));
    };

    const addModel = () => {
        const newId = Date.now().toString();
        const next = [...models, { id: newId, provider: 'openrouter', model: 'openai/gpt-4o', apiKey: '', apiBase: '', isOpen: false, active: models.length === 0 }];
        setModels(next);
    };

    const deleteModel = (id: string) => {
        const next = models.filter(m => m.id !== id);
        setModels(next);
    };

    const toggleApiKeyVisibility = async (id: string) => {
        const shouldShow = !showApiKeyById[id];
        if (shouldShow) {
            const target = models.find((m) => m.id === id);
            if (target && !target.apiKey && target.apiKeyMasked) {
                const fullApiKey = await fetchModelApiKey(id);
                if (fullApiKey) {
                    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, apiKey: fullApiKey } : m)));
                }
            }
        }
        setShowApiKeyById((prev) => ({ ...prev, [id]: shouldShow }));
    };

    return (
        <div className="space-y-6 pb-20">
            {models.map((config) => (
                <div key={config.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white transition-all hover:shadow-md group">
                    {/* Header */}
                    <div 
                        className="flex items-center justify-between p-4 bg-white cursor-pointer select-none group-hover:bg-gray-50/50 transition-colors"
                        onClick={() => toggleOpen(config.id)}
                    >
                        <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded bg-purple-50 flex items-center justify-center text-purple-600">
                                <Cpu size={16} />
                             </div>
                             <div className="flex flex-col">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">{providerLabel(config.provider)}</span>
                                <span className="text-sm font-semibold text-gray-700 mt-1 truncate max-w-[200px]">{config.model}</span>
                             </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); deleteModel(config.id); }}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                title="Delete model"
                            >
                                <Trash2 size={16} />
                            </button>
                            <button className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 transition-all">
                                {config.isOpen ? (
                                    <ChevronUp size={18} />
                                ) : (
                                    <ChevronDown size={18} />
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    {config.isOpen && (
                        <div className="p-6 pt-2 space-y-6 animate-in slide-in-from-top-2 duration-200 bg-white border-t border-gray-50">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Provider</label>
                                    <div className="relative">
                                        <select 
                                            value={config.provider}
                                            onChange={(e) => updateModel(config.id, 'provider', e.target.value)}
                                            className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-medium transition-all shadow-inner"
                                        >
                                            {COMMON_PROVIDERS.map((provider) => (
                                                <option key={provider.value} value={provider.value}>{provider.label}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-4 top-3.5 text-gray-400 pointer-events-none" size={14} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Model Identifier</label>
                                    <select 
                                        value={config.model}
                                        onChange={(e) => updateModel(config.id, 'model', e.target.value)}
                                        className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-800 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-medium transition-all shadow-inner"
                                    >
                                        {(PROVIDER_MODELS[config.provider] || [config.model]).map((model) => (
                                            <option key={model} value={model}>{model}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">API Endpoint / Token</label>
                                <div className="relative">
                                    {(() => {
                                        const isSaving = Boolean(isSavingById[config.id]);
                                        const value = config.apiKey || (isSaving ? (savingKeyPreviewById[config.id] || '') : '');
                                        return (
                                    <input 
                                        type={showApiKeyById[config.id] ? "text" : "password"}
                                        value={value}
                                        onChange={(e) => updateModel(config.id, 'apiKey', e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 pr-12 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-mono text-sm tracking-widest transition-all shadow-inner"
                                        placeholder={config.apiKeyMasked ? "••••••••" : ""}
                                    />
                                        );
                                    })()}
                                    <button
                                        type="button"
                                        onClick={() => toggleApiKeyVisibility(config.id)}
                                        className="absolute right-3 top-2.5 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                                        title={showApiKeyById[config.id] ? "Hide API key" : "Show API key"}
                                    >
                                        {showApiKeyById[config.id] ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                <div className="pt-1 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => saveSingleModel(config.id)}
                                        disabled={Boolean(isSavingById[config.id])}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                                            isSavingById[config.id]
                                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "bg-[#07C160] text-white hover:bg-[#06ad56]"
                                        )}
                                    >
                                        {isSavingById[config.id] ? (
                                            <span className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <Save size={14} />
                                        )}
                                        {isSavingById[config.id] ? "Saving..." : "Save"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ))}

            <button 
                onClick={addModel}
                className="w-full py-6 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 font-bold hover:border-[#07C160] hover:text-[#07C160] hover:bg-[#07C160]/5 transition-all flex items-center justify-center gap-2 group active:scale-[0.99]"
            >
                <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" />
                Add New AI Model
            </button>
        </div>
    );
}
