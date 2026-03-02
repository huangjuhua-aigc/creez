
import { Bot, ChevronDown, Plus } from 'lucide-react';
import { Bot as BotType } from '../data/mockData';
import { useState } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'motion/react';

interface BotSelectorProps {
  bots: BotType[];
  selectedBotId: string;
  onSelectBot: (botId: string) => void;
}

export function BotSelector({ bots, selectedBotId, onSelectBot }: BotSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedBot = bots.find(b => b.id === selectedBotId) || bots[0];

  return (
    <div className="relative z-10">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors border border-transparent hover:border-zinc-200"
      >
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
          <Bot size={18} />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-zinc-900 leading-tight">{selectedBot.name}</span>
          <span className="text-xs text-zinc-500 leading-tight">GPT-4o</span>
        </div>
        <ChevronDown size={14} className={clsx("text-zinc-400 transition-transform duration-200", isOpen && "rotate-180")} />
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-zinc-200 overflow-hidden"
          >
            <div className="p-2 space-y-1">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  onClick={() => {
                    onSelectBot(bot.id);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                    selectedBotId === bot.id ? "bg-blue-50 text-blue-700" : "hover:bg-zinc-50 text-zinc-700"
                  )}
                >
                  <div className={clsx(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                    selectedBotId === bot.id ? "bg-blue-200/50" : "bg-zinc-100"
                  )}>
                    <Bot size={16} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{bot.name}</span>
                    <span className="text-xs text-zinc-500 truncate">{bot.description}</span>
                  </div>
                </div>
              ))}
              
              <div className="h-px bg-zinc-100 my-1" />
              
              <div className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 transition-colors">
                <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 border border-dashed border-zinc-300">
                  <Plus size={16} />
                </div>
                <span className="text-sm font-medium">添加新机器人</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
