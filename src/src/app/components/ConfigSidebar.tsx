
import { Settings, ToggleLeft, Sliders } from 'lucide-react';

export function ConfigSidebar() {
  return (
    <div className="h-full bg-zinc-50 border-l border-zinc-200 flex flex-col">
      <div className="h-12 border-b border-zinc-200 flex items-center px-4 font-medium text-zinc-700 shrink-0">
        <Settings size={18} className="mr-2" />
        设置
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">模型配置</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-700">温度 (Temperature)</span>
              <span className="text-xs text-zinc-500 bg-zinc-200 px-2 py-0.5 rounded">0.7</span>
            </div>
            <input type="range" className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer" />
            
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-zinc-700">最大长度 (Max Length)</span>
              <span className="text-xs text-zinc-500 bg-zinc-200 px-2 py-0.5 rounded">2048</span>
            </div>
            <input type="range" className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer" />
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">界面选项</h3>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-zinc-700">深色模式</span>
            <ToggleLeft size={24} className="text-zinc-400 cursor-pointer" />
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-zinc-700">自动滚动</span>
            <ToggleLeft size={24} className="text-green-500 cursor-pointer rotate-180" />
          </div>
        </div>
      </div>
    </div>
  );
}
