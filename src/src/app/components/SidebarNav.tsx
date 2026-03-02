import { MessageSquare, User, Box, Aperture, Settings } from "lucide-react";
import { cn } from "../../utils/cn";

interface SidebarNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function SidebarNav({ activeTab, setActiveTab }: SidebarNavProps) {
  const topNavItems = [
    { id: 'chat', icon: MessageSquare },
    { id: 'contacts', icon: User },
    { id: 'files', icon: Box },
    { id: 'feed', icon: Aperture },
  ];

  return (
    <div className="w-16 h-full bg-[#E8E8E8] flex flex-col items-center py-6 border-r border-gray-200 justify-between">
      
      <div className="flex flex-col gap-6 w-full items-center">
        {/* Navigation Items */}
        {topNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isDisabled = item.id === 'feed' || item.id === 'files';
            
            // Map IDs to tooltips (disabled items: Workshop / Moments + Coming soon)
            const labels: Record<string, string> = {
                'chat': '聊天',
                'contacts': '通讯录',
                'files': 'Workshop · Coming soon',
                'feed': 'Moments · Coming soon'
            };

            return (
                <button
                    key={item.id}
                    onClick={() => !isDisabled && setActiveTab(item.id)}
                    className={cn(
                        "group relative p-2 rounded transition-colors",
                        isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                    )}
                    title={labels[item.id]}
                >
                    <div className={cn(
                        "p-1.5 rounded-md transition-all duration-200",
                        !isDisabled && "hover:bg-[#d6d6d6]"
                    )}>
                        <Icon 
                            size={24} 
                            className={cn(
                                "transition-all duration-200", 
                                isActive ? "text-[#07C160]" : "text-gray-500"
                            )}
                            strokeWidth={isActive ? 2 : 1.5}
                        />
                    </div>
                </button>
            )
        })}
      </div>

      {/* Bottom Items */}
      <div className="flex flex-col gap-6 w-full items-center mb-4">
        <button 
            onClick={() => setActiveTab('settings')}
            className="group relative p-2 rounded transition-colors"
        >
             <div className={cn(
                "p-1.5 rounded-md transition-all duration-200",
                "group-hover:bg-[#d6d6d6]",
                activeTab === 'settings' ? "" : ""
            )}>
                <Settings 
                    size={24} 
                    className={cn(
                        "transition-all duration-200",
                        activeTab === 'settings' ? "text-[#07C160]" : "text-gray-600"
                    )}
                    strokeWidth={1.5}
                />
            </div>
        </button>
      </div>
    </div>
  );
}
