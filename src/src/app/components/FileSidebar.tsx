
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { FileItem } from '../data/mockData';
import clsx from 'clsx';

function FileTreeItem({ item, level = 0 }: { item: FileItem; level?: number }) {
  const [isOpen, setIsOpen] = useState(true);
  const hasChildren = item.type === 'folder' && item.children && item.children.length > 0;

  return (
    <div>
      <div
        className={clsx(
          "flex items-center gap-2 py-1 px-2 hover:bg-zinc-100 cursor-pointer text-sm select-none text-zinc-700",
          level > 0 && "ml-4"
        )}
        onClick={() => hasChildren && setIsOpen(!isOpen)}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        <span className="w-4 h-4 flex items-center justify-center text-zinc-400">
          {hasChildren ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : null}
        </span>
        {item.type === 'folder' ? (
          <Folder size={16} className="text-blue-500 fill-blue-500/20" />
        ) : (
          <File size={16} className="text-zinc-500" />
        )}
        <span className="truncate">{item.name}</span>
      </div>
      {hasChildren && isOpen && (
        <div>
          {item.children!.map((child) => (
            <FileTreeItem key={child.id} item={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileSidebar({ files }: { files: FileItem[] }) {
  return (
    <div className="h-full flex flex-col bg-zinc-50 border-r border-zinc-200">
      <div className="h-12 border-b border-zinc-200 flex items-center px-4 font-medium text-zinc-700 shrink-0">
        文件列表
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {files.map((file) => (
          <FileTreeItem key={file.id} item={file} />
        ))}
      </div>
    </div>
  );
}
