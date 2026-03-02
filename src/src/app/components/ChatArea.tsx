
import { Message, Bot } from '../data/mockData';
import { BotSelector } from './BotSelector';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu } from 'lucide-react';
import clsx from 'clsx';

interface ChatAreaProps {
  bots: Bot[];
  selectedBotId: string;
  onSelectBot: (id: string) => void;
  messages: Message[];
  onSendMessage: (text: string) => void;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}

export function ChatArea({ 
  bots, 
  selectedBotId, 
  onSelectBot, 
  messages, 
  onSendMessage,
  onToggleLeft,
  onToggleRight
}: ChatAreaProps) {
  
  return (
    <div className="flex flex-col h-full bg-white relative">
      <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-100/50 bg-white/80 backdrop-blur-md sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          {onToggleLeft && (
            <button 
              onClick={onToggleLeft}
              className="p-2 -ml-2 hover:bg-zinc-100 rounded-lg text-zinc-500 transition-colors md:hidden"
            >
              <Menu size={20} />
            </button>
          )}
          <BotSelector 
            bots={bots} 
            selectedBotId={selectedBotId} 
            onSelectBot={onSelectBot} 
          />
        </div>
        
        <div className="flex items-center gap-2">
          {onToggleRight && (
            <button 
              onClick={onToggleRight}
              className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-500 transition-colors"
              title="配置"
            >
              <Menu size={20} className="rotate-180" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative flex flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
            <MessageList messages={messages} />
        </div>
        <div className="shrink-0 p-4 pt-0 bg-gradient-to-t from-white via-white to-transparent">
             <InputArea onSend={onSendMessage} />
        </div>
      </main>
    </div>
  );
}
