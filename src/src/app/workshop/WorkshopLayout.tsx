import React from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { cn } from "../../utils/cn";
import { Clapperboard } from "lucide-react";

const TOOLS = [
  {
    id: "sceneboard",
    name: "Sceneboard Creator",
    description: "AI Video Storyboard Assistant",
    icon: Clapperboard,
    color: "bg-indigo-500",
  },
];

export function WorkshopLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentTool = location.pathname.split("/")[2];

  return (
    <div className="flex flex-1 h-full w-full bg-white">
      {/* Middle Column: Tool List */}
      <div className="w-[280px] bg-[#F7F7F7] border-r border-gray-200 flex flex-col h-full shrink-0">
        <div className="h-16 flex items-center px-4 border-b border-gray-200 bg-[#F7F7F7]">
          <h2 className="text-lg font-medium text-gray-800">Workshop Tools</h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {TOOLS.map((tool) => {
            const isActive = currentTool === tool.id;
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => navigate(`/workshop/${tool.id}`)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 transition-colors text-left",
                  isActive ? "bg-[#E3E3E3]" : "hover:bg-[#EBEBEB]"
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-md flex items-center justify-center text-white",
                    tool.color
                  )}
                >
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-gray-900 truncate">{tool.name}</div>
                  <div className="text-[12px] text-gray-500 truncate mt-0.5">{tool.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Active Tool View */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F5F5F5]">
        <Outlet />
      </div>
    </div>
  );
}
