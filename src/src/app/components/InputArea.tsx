
import { Send, FileUp } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'motion/react';

export function InputArea({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (text.trim()) {
      onSend(text);
      setText('');
    }
  };

  return (
    <div className="bg-white border-t border-zinc-200 p-4">
      <div className="flex flex-col gap-2 max-w-4xl mx-auto">
        <div className="relative group bg-zinc-50 border border-zinc-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-all shadow-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入您的问题..."
            className="w-full resize-none bg-transparent px-4 py-3 min-h-[50px] max-h-[200px] outline-none text-sm text-zinc-800 placeholder:text-zinc-400"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          
          <div className="flex items-center justify-between px-3 pb-2 pt-1 border-t border-zinc-100 bg-white/50 backdrop-blur-sm rounded-b-xl">
            <div className="flex items-center gap-1">
              <button className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors" title="上传文件">
                <FileUp size={16} />
              </button>
            </div>
            
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSend}
              disabled={!text.trim()}
              className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white rounded-lg transition-colors shadow-sm disabled:shadow-none"
            >
              <Send size={16} />
            </motion.button>
          </div>
        </div>
        <p className="text-center text-[10px] text-zinc-400 mt-1">AI 生成的内容可能不准确，请核实重要信息。</p>
      </div>
    </div>
  );
}
