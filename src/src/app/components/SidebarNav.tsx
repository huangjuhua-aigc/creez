import { MessageSquare, User, Package, Aperture, Settings, Bot } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../utils/cn";

interface SidebarNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onNavigateToWorkshop?: () => void;
}

export function SidebarNav({ activeTab, setActiveTab, onNavigateToWorkshop }: SidebarNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname.split("/")[1] || "chat";
  const isWorkshop = location.pathname.startsWith("/workshop");
  const effectiveActive = isWorkshop ? "workshop" : activeTab;

  const topNavItems = [
    { id: "chat", icon: MessageSquare, path: "/chat" },
    { id: "contacts", icon: User, path: "/contacts" },
    { id: "workshop", icon: Package, path: "/workshop" },
    { id: "feed", icon: Aperture, path: "/feed" },
  ];

  const labels: Record<string, string> = {
    chat: "聊天",
    contacts: "通讯录",
    workshop: "工作空间",
    feed: "朋友圈",
  };

  return (
    <div className="w-16 h-full bg-[#E8E8E8] flex flex-col items-center py-4 border-r border-gray-200 justify-between">
      <div className="flex flex-col gap-6 w-full items-center">
        {topNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = effectiveActive === item.id;
          const isDisabled = item.id === "feed";

          return (
            <button
              key={item.id}
              onClick={() => {
                if (isDisabled) return;
                if (item.id === "workshop") {
                  onNavigateToWorkshop ? onNavigateToWorkshop() : navigate(item.path);
                } else {
                  navigate(item.path);
                  setActiveTab(item.id);
                }
              }}
              className={cn(
                "group relative p-2 rounded transition-colors",
                isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
              )}
              title={labels[item.id]}
            >
              <div
                className={cn(
                  "p-1.5 rounded-md transition-all duration-200",
                  !isDisabled && "hover:bg-[#d6d6d6]"
                )}
              >
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
          );
        })}
      </div>

      <div className="flex flex-col gap-6 w-full items-center mb-4">
        <button
          onClick={() => {
            if (location.pathname.startsWith("/workshop")) {
              navigate("/");
            }
            setActiveTab("agent-builder");
          }}
          className="group relative p-2 rounded transition-colors"
          title="Agent Builder"
        >
          <div
            className={cn(
              "p-1.5 rounded-md transition-all duration-200",
              "group-hover:bg-[#d6d6d6]"
            )}
          >
            <Bot
              size={24}
              className={cn(
                "transition-all duration-200",
                activeTab === "agent-builder" ? "text-[#07C160]" : "text-gray-600"
              )}
              strokeWidth={1.5}
            />
          </div>
        </button>
        <button
          onClick={() => {
            if (location.pathname.startsWith("/workshop")) {
              navigate("/");
            }
            setActiveTab("settings");
          }}
          className="group relative p-2 rounded transition-colors"
          title="设置"
        >
          <div
            className={cn(
              "p-1.5 rounded-md transition-all duration-200",
              "group-hover:bg-[#d6d6d6]"
            )}
          >
            <Settings
              size={24}
              className={cn(
                "transition-all duration-200",
                activeTab === "settings" ? "text-[#07C160]" : "text-gray-600"
              )}
              strokeWidth={1.5}
            />
          </div>
        </button>
      </div>
    </div>
  );
}
