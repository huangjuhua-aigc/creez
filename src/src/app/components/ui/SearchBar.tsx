import { Search, Plus } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '../../../utils/cn';

interface SearchBarProps {
  placeholder?: string;
  className?: string;
  onSearch?: (value: string) => void;
  rightElement?: ReactNode;
  onRightElementClick?: () => void;
}

export function SearchBar({ 
  placeholder = "搜索", 
  className, 
  onSearch, 
  rightElement,
  onRightElementClick 
}: SearchBarProps) {
  return (
    <div className={cn("h-16 flex items-center px-3 gap-2 bg-[#F7F7F7] pt-4 pb-2", className)}>
      <div className="flex-1 bg-[#E2E2E2] flex items-center px-2 py-1 rounded-[4px] group focus-within:bg-white focus-within:ring-1 focus-within:ring-[#07C160] transition-all">
        <Search size={14} className="text-gray-500 mr-2 group-focus-within:text-gray-700" />
        <input 
          type="text" 
          placeholder={placeholder}
          onChange={(e) => onSearch?.(e.target.value)}
          className="bg-transparent border-none outline-none text-xs w-full placeholder-gray-500 text-gray-800"
        />
      </div>
      
      {rightElement && (
        <button 
            onClick={onRightElementClick}
            className="p-1.5 bg-[#E2E2E2] rounded-[4px] text-gray-600 hover:bg-[#d6d6d6] transition-colors"
        >
           {rightElement}
        </button>
      )}
    </div>
  );
}
