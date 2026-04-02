import { useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { SidebarNav } from './components/SidebarNav';
import { ResourcePanel } from './components/ResourcePanel';
import { ChatWindow } from './components/ChatWindow';
import { ContactsWindow } from './components/ContactsWindow';
import { AdvancedSettings } from './components/AdvancedSettings';
import { AgentBuilder } from './components/AgentBuilder';
import { Aperture } from 'lucide-react';
import { loadAppState, persistAppState } from './services/appState';
import { readWorkspaceFile, writeWorkspaceFile } from './services/workspace';
import { toast } from 'sonner';
import { WorkshopLayout } from './workshop/WorkshopLayout';
import { SceneboardMain } from './workshop/SceneboardMain';
import { TimelineView } from './workshop/TimelineView';

export default function App() {
  const [activeTab, setActiveTab] = useState('contacts'); // Default to contacts based on flow, or chat
  const [currentChatId, setCurrentChatId] = useState<number | string>(1);
  const [openedFilePath, setOpenedFilePath] = useState<string | null>(null);
  const [openedFileContent, setOpenedFileContent] = useState('');
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const didHydrateState = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrateState() {
      const state = await loadAppState();
      if (cancelled) return;

      if (typeof state.lastTab === 'string' && state.lastTab.trim() !== '') {
        setActiveTab(state.lastTab);
      }

      if (state.lastChatId) {
        setCurrentChatId(state.lastChatId);
      }

      didHydrateState.current = true;
    }

    hydrateState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!didHydrateState.current) return;

    persistAppState({
      lastTab: activeTab,
      lastChatId: String(currentChatId),
    });
  }, [activeTab, currentChatId]);

  const [activeChatMeta, setActiveChatMeta] = useState<{ name?: string; avatar?: string } | null>(null);

  const handleStartChat = (chatId: string, meta?: { name?: string; avatar?: string }) => {
    setCurrentChatId(chatId);
    setActiveChatMeta(meta || null);
    setActiveTab('chat');
  };

  const handleSelectChat = (chatId: string) => {
    setCurrentChatId(chatId);
  };

  const openWorkspaceFile = async (filePath: string) => {
    setIsOpeningFile(true);
    const content = await readWorkspaceFile(filePath);
    setIsOpeningFile(false);
    if (content == null) {
      toast.error('Failed to open file');
      return;
    }
    setOpenedFilePath(filePath);
    setOpenedFileContent(content);
  };

  const saveWorkspaceFile = async () => {
    if (!openedFilePath) return;
    setIsSavingFile(true);
    const ok = await writeWorkspaceFile(openedFilePath, openedFileContent);
    setIsSavingFile(false);
    if (!ok) {
      toast.error('Failed to save file');
      return;
    }
    toast.success('File saved');
  };

  const navigate = useNavigate();
  const location = useLocation();
  const isWorkshop = location.pathname.startsWith('/workshop');
  const effectiveTab = isWorkshop ? 'workshop' : activeTab;

  return (
    <div className="flex w-full h-screen bg-gray-100 overflow-hidden font-sans text-gray-900">
      {/* 1. Navigation Sidebar (Leftmost) */}
      <SidebarNav
        activeTab={effectiveTab}
        setActiveTab={setActiveTab}
        onNavigateToWorkshop={() => navigate('/workshop')}
      />

      {/* 2. Main Content Area - Workshop routes or tab content */}
      <main className="flex-1 flex flex-col min-w-0 bg-white shadow-sm z-10 relative">
        {isWorkshop ? (
          <Routes>
            <Route path="/workshop" element={<WorkshopLayout />}>
              <Route path="sceneboard" element={<SceneboardMain />} />
              <Route path="sceneboard/timeline" element={<TimelineView />} />
            </Route>
          </Routes>
        ) : (
          <>
        <div className={activeTab === 'chat' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <ChatWindow activeChatId={currentChatId} activeChatMeta={activeChatMeta} onSelectChat={handleSelectChat} onNavigateToSettings={() => setActiveTab('settings')} />
        </div>
        <div className={activeTab === 'contacts' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <ContactsWindow onStartChat={handleStartChat} />
        </div>
        {activeTab === 'files' && (
            <div className="flex-1 flex bg-white h-full">
                <div className="h-full border-r border-gray-200">
                     <ResourcePanel selectedFilePath={openedFilePath} onOpenFile={openWorkspaceFile} />
                </div>
                <div className="w-72 border-r border-gray-200 bg-gray-50 flex items-center justify-center px-6">
                  <p className="text-sm text-gray-500 text-center leading-relaxed">
                    More features are coming soon.
                  </p>
                </div>
                <div className="flex-1 min-w-0 bg-gray-50 flex flex-col">
                  <div className="h-14 border-b border-gray-200 px-4 flex items-center justify-between bg-white">
                    <p className="text-xs text-gray-500 truncate">
                      {openedFilePath || 'No file opened'}
                    </p>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs rounded-md bg-[#07C160] text-white disabled:bg-gray-300"
                      disabled={!openedFilePath || isSavingFile}
                      onClick={saveWorkspaceFile}
                    >
                      {isSavingFile ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  {!openedFilePath ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                      <p>Double-click a file to open it.</p>
                    </div>
                  ) : (
                    <div className="flex-1 p-4">
                      {isOpeningFile ? (
                        <div className="h-full flex items-center justify-center text-gray-400">Loading file...</div>
                      ) : (
                        <textarea
                          value={openedFileContent}
                          onChange={(e) => setOpenedFileContent(e.target.value)}
                          className="w-full h-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-sm font-mono text-gray-700 outline-none focus:ring-2 focus:ring-[#07C160]/30"
                        />
                      )}
                    </div>
                  )}
                </div>
            </div>
        )}
        {activeTab === 'feed' && (
            <div className="flex-1 h-full flex flex-col items-center bg-gray-50 overflow-y-auto">
              <div className="w-full max-w-2xl bg-white min-h-screen shadow-sm border-x border-gray-100 p-8 space-y-6">
                 <div className="flex items-center gap-2 mb-6 pb-4 border-b border-gray-100">
                    <Aperture className="text-green-500" />
                    <h2 className="text-xl font-bold text-gray-800">Moments</h2>
                 </div>
                 {/* Mock feed content */}
                 <div className="h-48 bg-gray-100 rounded-xl" />
              </div>
            </div>
        )}
        {activeTab === 'agent-builder' && <AgentBuilder />}
        {activeTab === 'settings' && <AdvancedSettings />}
        </>
        )}
      </main>
    </div>
  );
}
