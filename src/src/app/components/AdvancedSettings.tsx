import { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '../../utils/cn';
import { Bot, Brain, Database, Cpu, ChevronDown, ChevronUp, Plus, Trash2, Save, Upload, User, Camera, CheckCircle2, RotateCcw, Folder, Radio, Clock, Search, Pencil, X } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { toast } from 'sonner';
import { fetchAssistantConfig, fetchModelApiKey, persistAssistantConfig, readMemory, writeMemory, uploadAssistantAvatar, selectWorkplaceDirectory, readLocalImageDataUrl, listAvailableSkills, getSkillEnv, saveSkillEnv } from '../services/settings';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

export function AdvancedSettings() {
  const [activeSection, setActiveSection] = useState('identity');

  const sections = [
    { id: 'identity', label: 'AI Identity', icon: Bot, description: 'Customize the persona and interaction style.' },
    { id: 'skills', label: 'Skills', icon: Brain, description: 'Define what tasks the AI can perform.' },
    { id: 'memory', label: 'Memory', icon: Database, description: 'Manage conversation history and context retention.' },
    { id: 'model', label: 'Model Config', icon: Cpu, description: 'Configure LLM providers and models.' },
    { id: 'channel', label: 'Channel Config', icon: Radio, description: 'Connect messaging platforms as input/output channels.' },
    { id: 'scheduledTasks', label: 'Tasks', icon: Clock, description: 'List, add, edit scheduled tasks (default bot only).' },
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
            {activeSection === 'channel' && <ChannelSettings />}
            {activeSection === 'scheduledTasks' && <ScheduledTasksSettings />}
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
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [creezApiKey, setCreezApiKey] = useState('');
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
    Promise.all([
      window.electron?.app?.getState?.() ?? Promise.resolve({ ok: false }),
      getSkillEnv('creez'),
    ]).then(([res, creezEnv]) => {
      if (cancelled) return;
      const data = res?.ok ? res.data : undefined;
      if (data?.workspaceRoot) {
        setWorkspaceDir(String(data.workspaceRoot));
      } else {
        setWorkspaceDir('');
      }
      const fromEnv = creezEnv?.CREEZ_API_KEY != null && String(creezEnv.CREEZ_API_KEY).trim() !== ''
        ? String(creezEnv.CREEZ_API_KEY).trim()
        : '';
      const fromState = data?.creezApiKey != null && String(data.creezApiKey).trim() !== ''
        ? String(data.creezApiKey).trim()
        : '';
      setCreezApiKey(fromEnv || fromState || '');
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
          <label className="block text-sm font-semibold text-gray-700">Creez API Key</label>
          <input
            type="text"
            value={creezApiKey}
            onChange={(e) => setCreezApiKey(e.target.value)}
            onBlur={async () => {
              const trimmed = creezApiKey.trim();
              const ok = await saveSkillEnv('creez', { CREEZ_API_KEY: trimmed || '' });
              if (ok) {
                if (trimmed) toast.success('Creez API Key saved');
              } else {
                toast.error('Failed to save');
              }
            }}
            placeholder="Used when calling creez backend (e.g. storyboard, image/video generation)"
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-sm font-mono text-sm placeholder:text-gray-400"
            autoComplete="off"
          />
          <p className="text-[11px] text-gray-400 px-1">保存到 ~/.creez/.env</p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">Workplace Directory</label>
          <div className="relative group">
            <input 
              type="text" 
              value={workspaceDir}
              placeholder="~/.creez/workplace"
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none transition-all shadow-inner placeholder:text-gray-400"
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

const XHS_COOKIE_TIP = "获取方式：\n1. 浏览器登录 https://www.xiaohongshu.com\n2. F12 → Network → 任选请求 → 请求头中的 Cookie，整串复制";

// --- 2. Skills Settings ---

const TAVILY_API_KEY_TIP = "在 https://tavily.com 注册并创建 API Key，填入此处后 Tavily 搜索技能可用。";

function SkillsSettings() {
    const [skills, setSkills] = useState<Array<{ id: string; name: string; desc: string; enabled: boolean }>>([]);
    const [xhsCookie, setXhsCookie] = useState('');
    const [xhsSaving, setXhsSaving] = useState(false);
    const [tavilyApiKey, setTavilyApiKey] = useState('');
    const [tavilySaving, setTavilySaving] = useState(false);

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

    useEffect(() => {
        if (!skills.some((s) => s.id === 'xiaohongshu')) return;
        let cancelled = false;
        getSkillEnv('xiaohongshu').then((env) => {
            if (cancelled) return;
            setXhsCookie(env.XHS_COOKIE ?? '');
        });
        return () => {
            cancelled = true;
        };
    }, [skills]);

    useEffect(() => {
        if (!skills.some((s) => s.id === 'tavily-search')) return;
        let cancelled = false;
        getSkillEnv('tavily-search').then((env) => {
            if (cancelled) return;
            setTavilyApiKey(env.TAVILY_API_KEY ?? '');
        });
        return () => {
            cancelled = true;
        };
    }, [skills]);

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

    const persistXhsCookie = async () => {
        setXhsSaving(true);
        const ok = await saveSkillEnv('xiaohongshu', { XHS_COOKIE: xhsCookie.trim() });
        if (!ok) toast.error('保存失败');
        else toast.success('保存成功');
        setXhsSaving(false);
    };

    const persistTavilyApiKey = async () => {
        setTavilySaving(true);
        const ok = await saveSkillEnv('tavily-search', { TAVILY_API_KEY: tavilyApiKey.trim() });
        if (!ok) toast.error('保存失败');
        else toast.success('保存成功');
        setTavilySaving(false);
    };

    const sortedSkills = [...skills].sort((a, b) => {
        const enabledFirst = (a.enabled ? 0 : 1) - (b.enabled ? 0 : 1);
        return enabledFirst !== 0 ? enabledFirst : a.name.localeCompare(b.name);
    });

    return (
        <div className="grid grid-cols-1 gap-4">
            {sortedSkills.map((skill) => (
                <div key={skill.id}>
                    <Tooltip delayDuration={300}>
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
                                            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 flex-wrap">
                                                {skill.name}
                                                {skill.id === 'image-generator' && (
                                                    <span className="text-[10px] font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                                        creez 专属，需要 creez key
                                                    </span>
                                                )}
                                            </h3>
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
                                {skill.id === 'xiaohongshu' && (
                                    <div className="mt-4 pt-4 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                            XHS_COOKIE
                                            <span className="relative group/tip cursor-default">
                                                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400 text-[9px] font-bold normal-case tracking-normal leading-none">?</span>
                                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-52 px-3 py-2 rounded-lg bg-gray-800 text-white text-[11px] font-normal normal-case tracking-normal leading-relaxed opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 shadow-lg z-50 whitespace-pre-line">
                                                    {XHS_COOKIE_TIP}
                                                    <span className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-gray-800" />
                                                </span>
                                            </span>
                                        </label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            placeholder="填入 Cookie 后发布脚本可用"
                                            value={xhsCookie}
                                            onChange={(e) => setXhsCookie(e.target.value)}
                                            className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#07C160]/30 focus:border-[#07C160]"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => persistXhsCookie()}
                                            disabled={xhsSaving}
                                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#07C160] text-white hover:bg-[#06ad56] disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {xhsSaving ? (
                                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <Save size={14} />
                                            )}
                                            {xhsSaving ? '保存中…' : '保存'}
                                        </button>
                                        <p className="mt-1 text-[10px] text-gray-400">保存到 ~/.creez/.env</p>
                                    </div>
                                )}
                                {skill.id === 'tavily-search' && (
                                    <div className="mt-4 pt-4 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                            TAVILY_API_KEY
                                            <span className="relative group/tip cursor-default">
                                                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400 text-[9px] font-bold normal-case tracking-normal leading-none">?</span>
                                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-52 px-3 py-2 rounded-lg bg-gray-800 text-white text-[11px] font-normal normal-case tracking-normal leading-relaxed opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 shadow-lg z-50 whitespace-pre-line">
                                                    {TAVILY_API_KEY_TIP}
                                                    <span className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-gray-800" />
                                                </span>
                                            </span>
                                        </label>
                                        <input
                                            type="password"
                                            autoComplete="off"
                                            placeholder="填入 API Key 后 Tavily 搜索可用"
                                            value={tavilyApiKey}
                                            onChange={(e) => setTavilyApiKey(e.target.value)}
                                            className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#07C160]/30 focus:border-[#07C160]"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => persistTavilyApiKey()}
                                            disabled={tavilySaving}
                                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#07C160] text-white hover:bg-[#06ad56] disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {tavilySaving ? (
                                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <Save size={14} />
                                            )}
                                            {tavilySaving ? '保存中…' : '保存'}
                                        </button>
                                        <p className="mt-1 text-[10px] text-gray-400">保存到 ~/.creez/.env</p>
                                    </div>
                                )}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap text-left">
                            {skill.desc}
                        </TooltipContent>
                    </Tooltip>
                </div>
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
    const [isSavingById, setIsSavingById] = useState<Record<string, boolean>>({});
    const [savingKeyPreviewById, setSavingKeyPreviewById] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const config = await fetchAssistantConfig();
            if (cancelled) return;
            if (!Array.isArray(config.models) || config.models.length === 0) return;
            const initial = config.models.map((m) => ({
                id: m.id,
                provider: normalizeProviderValue(m.provider || 'openrouter'),
                model: m.model || 'gpt-4o',
                apiKey: '',
                apiKeyMasked: m.apiKeyMasked || '',
                apiBase: m.apiBase || '',
                isOpen: false,
                active: Boolean(m.active),
            }));
            setModels(initial);
            const keys = await Promise.all(initial.map((m) => fetchModelApiKey(m.id)));
            if (cancelled) return;
            setModels((prev) =>
                prev.map((m, i) => ({ ...m, apiKey: keys[i] || m.apiKey }))
            );
        })();
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
                                        type="text"
                                        value={value}
                                        onChange={(e) => updateModel(config.id, 'apiKey', e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-mono text-sm tracking-widest transition-all shadow-inner"
                                        placeholder=""
                                    />
                                        );
                                    })()}
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

// --- 5. Channel Settings ---

type ChannelFieldType = 'text' | 'password';

interface ChannelField {
  key: string;
  label: string;
  type: ChannelFieldType;
  placeholder: string;
  hint?: string;
}

const CHANNEL_DEFS: Record<string, { label: string; color: string; fields: ChannelField[] }> = {
  feishu: {
    label: 'Feishu / Lark',
    color: 'bg-blue-50 text-blue-600',
    fields: [
      { key: 'FEISHU_APP_ID',     label: 'App ID',     type: 'text',     placeholder: 'cli_xxxxxxxxxxxxxxxx',    hint: 'Found in Feishu Open Platform → Credentials' },
      { key: 'FEISHU_APP_SECRET', label: 'App Secret', type: 'text', placeholder: 'Enter App Secret',        hint: 'Keep this private — do not share' },
      { key: 'FEISHU_OPEN_ID',    label: 'Open ID',    type: 'text',     placeholder: 'ou_xxxxxxxxxxxxxxxx',     hint: 'Target user / bot Open ID' },
    ],
  },
  slack: {
    label: 'Slack',
    color: 'bg-yellow-50 text-yellow-600',
    fields: [
      { key: 'SLACK_BOT_TOKEN',      label: 'Bot Token',      type: 'text', placeholder: 'xoxb-xxxxxxxxxxxx' },
      { key: 'SLACK_SIGNING_SECRET', label: 'Signing Secret', type: 'text', placeholder: 'Enter Signing Secret' },
      { key: 'SLACK_CHANNEL_ID',     label: 'Channel ID',     type: 'text',     placeholder: 'C0XXXXXXXX' },
    ],
  },
  telegram: {
    label: 'Telegram',
    color: 'bg-sky-50 text-sky-600',
    fields: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', type: 'text', placeholder: '123456789:ABC-xxxxxxxxxxxx' },
      { key: 'TELEGRAM_CHAT_ID',   label: 'Chat ID',   type: 'text',     placeholder: '-100xxxxxxxxxx' },
    ],
  },
  dingtalk: {
    label: 'DingTalk',
    color: 'bg-orange-50 text-orange-500',
    fields: [
      { key: 'DINGTALK_APP_KEY',    label: 'App Key',    type: 'text',     placeholder: 'dingxxxxxxxxxx' },
      { key: 'DINGTALK_APP_SECRET', label: 'App Secret', type: 'text', placeholder: 'Enter App Secret' },
      { key: 'DINGTALK_ROBOT_CODE', label: 'Robot Code', type: 'text',     placeholder: 'Enter Robot Code' },
    ],
  },
};

const CHANNEL_OPTIONS = Object.entries(CHANNEL_DEFS).map(([id, def]) => ({
  id,
  label: def.label,
  available: id === 'feishu', // only Feishu is available for now
}));

interface ChannelConfigItem {
  id: string;
  channelType: string;
  values: Record<string, string>;
  isOpen: boolean;
  enabled: boolean;
}

function ChannelCard({
  config,
  onToggleOpen,
  onToggleEnabled,
  onChangeType,
  onChangeValue,
  onSave,
  onDelete,
  isSaving,
}: {
  config: ChannelConfigItem;
  onToggleOpen: () => void;
  onToggleEnabled: () => void;
  onChangeType: (t: string) => void;
  onChangeValue: (key: string, val: string) => void;
  onSave: () => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const def = CHANNEL_DEFS[config.channelType] ?? CHANNEL_DEFS.feishu;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white transition-all hover:shadow-md group">
      <div
        className="flex items-center justify-between p-4 bg-white cursor-pointer select-none group-hover:bg-gray-50/50 transition-colors"
        onClick={onToggleOpen}
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
            'ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full border',
            config.enabled ? 'bg-green-50 text-green-600 border-green-100' : 'bg-gray-100 text-gray-400 border-gray-200'
          )}>
            {config.enabled ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
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
                  onChange={e => { e.stopPropagation(); const v = e.target.value; if (CHANNEL_OPTIONS.find(x => x.id === v)?.available) onChangeType(v); }}
                  className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-medium transition-all shadow-inner"
                >
                  {CHANNEL_OPTIONS.map(o => (
                    <option key={o.id} value={o.id} disabled={!o.available} title={o.available ? undefined : 'Coming soon'}>
                      {o.label}{!o.available ? ' (Coming soon)' : ''}
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
                onClick={e => { e.stopPropagation(); onToggleEnabled(); }}
                className={cn(
                  'flex items-center gap-2 w-full py-2.5 px-4 rounded-lg border text-sm font-medium transition-all',
                  config.enabled ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                )}
              >
                <span className={cn('w-2 h-2 rounded-full', config.enabled ? 'bg-green-500' : 'bg-gray-400')} />
                {config.enabled ? 'Enabled' : 'Disabled'}
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
                <div className="relative">
                  <input
                    type="text"
                    value={config.values[field.key] ?? ''}
                    onChange={e => onChangeValue(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-gray-50 border border-gray-200 text-gray-800 py-2.5 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] font-mono text-sm transition-all shadow-inner"
                  />
                </div>
                {field.hint && <p className="text-[10px] text-gray-400 px-0.5">{field.hint}</p>}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onSave(); }}
              disabled={isSaving}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                isSaving ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#07C160] text-white hover:bg-[#06ad56]'
              )}
            >
              {isSaving ? <span className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelSettings() {
  const [channels, setChannels] = useState<ChannelConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadConfigs = async () => {
    const api = window.electron?.channel?.listConfigs;
    if (!api) {
      setLoading(false);
      return;
    }
    const res = await api({});
    if (!res?.ok || !res.data?.items) {
      setChannels([]);
      setLoading(false);
      return;
    }
    const items: ChannelConfigItem[] = res.data.items.map((c: { id: string; channelType: string; enabled: boolean; values: Record<string, string> }) => ({
      id: c.id,
      channelType: c.channelType,
      values: c.values ?? {},
      isOpen: true,
      enabled: c.enabled,
    }));
    setChannels(items);
    setLoading(false);
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const update = (id: string, patch: Partial<ChannelConfigItem>) =>
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));

  const addChannel = () =>
    setChannels(prev => [
      ...prev,
      { id: `new-${Date.now()}`, channelType: 'feishu', values: {}, isOpen: true, enabled: false },
    ]);

  const saveChannel = async (config: ChannelConfigItem) => {
    const api = window.electron?.channel?.saveConfig;
    if (!api) return;
    setSavingId(config.id);
    const res = await api({
      channelType: config.channelType,
      enabled: config.enabled,
      values: config.values,
    });
    setSavingId(null);
    if (res?.ok) {
      toast.success('Channel config saved');
      await loadConfigs();
    } else {
      toast.error(res?.error?.message ?? 'Failed to save');
    }
  };

  const deleteChannel = async (config: ChannelConfigItem) => {
    const api = window.electron?.channel?.deleteConfig;
    if (!api) return;
    const res = await api({ channelType: config.channelType });
    if (res?.ok) {
      setChannels(prev => prev.filter(c => c.id !== config.id));
      toast.success('Channel removed');
    } else {
      toast.error(res?.error?.message ?? 'Failed to delete');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-[#07C160] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {channels.map(config => (
        <ChannelCard
          key={config.id}
          config={config}
          onToggleOpen={() => update(config.id, { isOpen: !config.isOpen })}
          onToggleEnabled={() => update(config.id, { enabled: !config.enabled })}
          onChangeType={t => update(config.id, { channelType: t, values: {} })}
          onChangeValue={(key, val) => update(config.id, { values: { ...config.values, [key]: val } })}
          onSave={() => saveChannel(config)}
          onDelete={() => deleteChannel(config)}
          isSaving={savingId === config.id}
        />
      ))}
      <button
        onClick={addChannel}
        className="w-full py-6 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 font-bold hover:border-[#07C160] hover:text-[#07C160] hover:bg-[#07C160]/5 transition-all flex items-center justify-center gap-2 group active:scale-[0.99]"
      >
        <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" />
        Add New Channel
      </button>
    </div>
  );
}

// --- 6. Scheduled Tasks Settings ---

type ScheduledTaskItem = {
  id: string;
  contact_id: string;
  chat_id: string;
  cron_expression: string;
  task_prompt: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type ChatListItem = { id: string; contactId: string | null; title: string };

const CRON_HELP =
  "5 fields: minute hour day-of-month month day-of-week. Examples: 0 8 * * * = 8:00 daily; 0 */2 * * * = every 2 hours; 0 9 * * 1-5 = 9:00 weekdays.";

function ScheduledTasksSettings() {
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([]);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [defaultBotId, setDefaultBotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newCron, setNewCron] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCron, setEditCron] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'paused'>('active');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadTasks = async () => {
    const api = window.electron?.scheduledTasks?.list;
    if (!api) return;
    const res = await api();
    if (res?.ok && Array.isArray(res.data?.tasks)) setTasks(res.data.tasks);
  };

  const loadChats = async () => {
    const api = window.electron?.chat?.list;
    if (!api) return;
    const res = await api({ limit: 100 });
    const items = res?.ok && res?.data?.items ? res.data.items : [];
    if (items.length) setChatList(items);
  };

  const loadDefaultBotId = async () => {
    const api = window.electron?.contact?.getDefaultBotId;
    if (!api) return;
    const res = await api();
    const id = res?.ok && res?.data?.botId != null ? res.data.botId : null;
    if (id != null) setDefaultBotId(String(id));
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadTasks(), loadChats(), loadDefaultBotId()]).then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.task_prompt.toLowerCase().includes(q) ||
        t.cron_expression.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const chatLabel = (contactId: string, chatId: string) => {
    const chat = chatList.find((c) => c.contactId === contactId && c.id === chatId);
    return chat?.title ?? `${contactId.slice(0, 8)}… / ${chatId.slice(0, 8)}…`;
  };

  const startAdd = () => {
    setNewCron('');
    setNewPrompt('');
    setAdding(true);
  };

  const createTask = async () => {
    const contactId = defaultBotId;
    const defaultChat = contactId ? chatList.find((c) => c.contactId === contactId) : null;
    const chatId = defaultChat?.id ?? null;
    if (!contactId || !chatId) {
      toast.error('Start a conversation with the default assistant in the sidebar first.');
      return;
    }
    if (!newCron.trim() || !newPrompt.trim()) {
      toast.error('Fill cron expression and task prompt.');
      return;
    }
    const api = window.electron?.scheduledTasks?.create;
    if (!api) return;
    setCreating(true);
    const res = await api({
      contact_id: contactId,
      chat_id: chatId,
      cron_expression: newCron.trim(),
      task_prompt: newPrompt.trim(),
    });
    setCreating(false);
    if (res?.ok) {
      toast.success('Task created');
      setAdding(false);
      loadTasks();
    } else {
      toast.error(res?.error?.message ?? 'Create failed');
    }
  };

  const startEdit = (t: ScheduledTaskItem) => {
    setEditingId(t.id);
    setEditCron(t.cron_expression);
    setEditPrompt(t.task_prompt);
    setEditStatus((t.status === 'paused' ? 'paused' : 'active') as 'active' | 'paused');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const api = window.electron?.scheduledTasks?.update;
    if (!api) return;
    setSavingId(editingId);
    const res = await api({
      task_id: editingId,
      cron_expression: editCron.trim(),
      task_prompt: editPrompt.trim(),
      status: editStatus,
    });
    setSavingId(null);
    if (res?.ok) {
      toast.success('已保存');
      setEditingId(null);
      loadTasks();
    } else {
      toast.error(res?.error?.message ?? '保存失败');
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    const api = window.electron?.scheduledTasks?.delete;
    if (!api) return;
    const res = await api({ task_id: taskId });
    if (res?.ok) {
      toast.success('已删除');
      loadTasks();
    } else {
      toast.error(res?.error?.message ?? '删除失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-[#07C160] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search by prompt, cron or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#07C160]/20 focus:border-[#07C160] outline-none"
          />
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#07C160] text-white text-sm font-medium hover:bg-[#06ad56] transition-colors"
        >
          <Plus size={16} />
          Add task
        </button>
      </div>

      <p className="text-xs text-gray-500">Tasks are loaded from the app; only the default bot runs them. List shows cron and prompt for each.</p>

      {adding && (
        <div className="border border-gray-200 rounded-xl p-6 bg-gray-50/80 space-y-4">
          <h4 className="text-sm font-bold text-gray-800">New task</h4>
          {defaultBotId && !chatList.some((c) => c.contactId === defaultBotId) && (
            <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Start a conversation with the default assistant in the sidebar first.</p>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Cron expression</label>
            <input
              type="text"
              value={newCron}
              onChange={(e) => setNewCron(e.target.value)}
              placeholder="0 8 * * *"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono bg-white"
            />
            <p className="text-[11px] text-gray-500">{CRON_HELP}</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Task prompt (sent to AI at run time)</label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder={"e.g. Summarize today's priorities and reply in this chat"}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50"
            >
              <X size={14} className="inline mr-1" /> Cancel
            </button>
            <button
              type="button"
              onClick={createTask}
              disabled={creating}
              className="px-3 py-1.5 rounded-lg bg-[#07C160] text-white text-sm font-medium hover:bg-[#06ad56] disabled:opacity-50 flex items-center gap-1.5"
            >
              {creating ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus size={14} />}
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No tasks yet{search.trim() ? ' (try a different search)' : ' — click Add task to create one'}</p>
        ) : (
          filteredTasks.map((t) => (
            <div
              key={t.id}
              className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{t.cron_expression}</span>
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      t.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                    )}>
                      {t.status === 'active' ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 mt-1 line-clamp-2">{t.task_prompt}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{chatLabel(t.contact_id, t.chat_id)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {editingId === t.id ? (
                    <>
                      <button onClick={saveEdit} disabled={savingId === t.id} className="p-2 text-[#07C160] hover:bg-green-50 rounded-lg" title="Save">
                        <Save size={16} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg" title="Cancel">
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(t)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" title="Edit">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => deleteTask(t.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editingId === t.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50/50 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Cron expression</label>
                      <input
                        type="text"
                        value={editCron}
                        onChange={(e) => setEditCron(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono bg-white"
                      />
                      <p className="mt-0.5 text-[11px] text-gray-500">{CRON_HELP}</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as 'active' | 'paused')}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      >
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Task prompt</label>
                    <textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      rows={2}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
