
import { Message } from '../data/mockData';
import clsx from 'clsx';
import { User, Bot } from 'lucide-react';
import { motion } from 'motion/react';

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-white custom-scrollbar">
      {messages.map((msg, index) => (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.05 }}
          className={clsx(
            "flex gap-4 max-w-3xl mx-auto",
            msg.role === 'user' ? "flex-row-reverse" : "flex-row"
          )}
        >
          <div className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm border border-zinc-100",
            msg.role === 'user' ? "bg-blue-600 text-white" : "bg-white text-blue-600"
          )}>
            {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
          </div>
          
          <div className={clsx(
            "flex flex-col max-w-[80%] min-w-[20%]",
            msg.role === 'user' ? "items-end" : "items-start"
          )}>
            <div className={clsx(
              "px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm border",
              msg.role === 'user' 
                ? "bg-blue-600 text-white border-blue-500 rounded-tr-none" 
                : "bg-white text-zinc-800 border-zinc-200 rounded-tl-none"
            )}>
              {msg.content}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 px-1">
              {msg.timestamp}
            </span>
          </div>
        </motion.div>
      ))}
      {messages.length === 0 && (
        <div className="h-full flex flex-col items-center justify-center text-zinc-400">
          <Bot size={48} className="mb-4 opacity-20" />
          <p>开始一个新的对话吧</p>
        </div>
      )}
    </div>
  );
}
