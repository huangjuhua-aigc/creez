import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Layout,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import {
  createWorkspaceNode,
  deleteWorkspaceNode,
  fetchWorkspaceTree,
  renameWorkspaceNode,
  type WorkspaceNode,
} from '../services/workspace';
import { SearchBar } from './ui/SearchBar';

type ResourcePanelProps = {
  selectedFilePath?: string | null;
  onOpenFile?: (path: string) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  targetPath: string;
  targetType: 'file' | 'folder' | 'root';
  targetName: string;
};

function getParentPath(rawPath: string) {
  const normalized = String(rawPath || '').replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

function filterNodes(nodes: WorkspaceNode[], keyword: string): WorkspaceNode[] {
  if (!keyword) return nodes;
  const lower = keyword.toLowerCase();
  return nodes
    .map((node) => {
      if (node.type === 'folder') {
        const filteredChildren = filterNodes(node.children || [], keyword);
        if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
          return { ...node, children: filteredChildren };
        }
        return null;
      }
      return node.name.toLowerCase().includes(lower) ? node : null;
    })
    .filter(Boolean) as WorkspaceNode[];
}

export function ResourcePanel({ selectedFilePath, onOpenFile }: ResourcePanelProps) {
  const [rootPath, setRootPath] = useState('');
  const [files, setFiles] = useState<WorkspaceNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [rootNotReady, setRootNotReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const loadTree = useCallback(async () => {
    setIsLoading(true);
    const tree = await fetchWorkspaceTree(4);
    setIsLoading(false);
    if (!tree) {
      setRootNotReady(true);
      setRootPath('');
      setFiles([]);
      return;
    }
    setRootNotReady(false);
    setRootPath(tree.rootPath);
    setFiles(tree.nodes);
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleContextMenu = (
    e: React.MouseEvent,
    targetPath: string,
    targetType: 'file' | 'folder' | 'root',
    targetName: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetPath,
      targetType,
      targetName,
    });
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const runAction = async (action: 'new-file' | 'new-folder' | 'rename' | 'delete') => {
    if (!contextMenu) return;
    const menu = contextMenu;
    setContextMenu(null);

    if (action === 'new-file' || action === 'new-folder') {
      const name = prompt(action === 'new-file' ? 'File name' : 'Folder name');
      if (!name) return;
      const parentPath =
        menu.targetType === 'root'
          ? rootPath
          : menu.targetType === 'folder'
            ? menu.targetPath
            : getParentPath(menu.targetPath);
      const ok = await createWorkspaceNode({
        parentPath,
        name: name.trim(),
        type: action === 'new-file' ? 'file' : 'folder',
        content: action === 'new-file' ? '' : undefined,
      });
      if (!ok) {
        toast.error('Failed to create target');
        return;
      }
      if (menu.targetType === 'folder') {
        setExpandedFolders((prev) => new Set(prev).add(menu.targetPath));
      }
      await loadTree();
      return;
    }

    if (action === 'rename') {
      const nextName = prompt('New name', menu.targetName);
      if (!nextName || nextName.trim() === menu.targetName) return;
      const ok = await renameWorkspaceNode(menu.targetPath, nextName.trim());
      if (!ok) {
        toast.error('Failed to rename target');
        return;
      }
      await loadTree();
      return;
    }

    if (action === 'delete') {
      const confirmed = confirm(`Delete "${menu.targetName}"?`);
      if (!confirmed) return;
      const ok = await deleteWorkspaceNode(menu.targetPath, menu.targetType !== 'file');
      if (!ok) {
        toast.error('Failed to delete target');
        return;
      }
      await loadTree();
    }
  };

  const visibleNodes = useMemo(() => filterNodes(files, keyword), [files, keyword]);

  const renderTree = (nodes: WorkspaceNode[], depth = 0): JSX.Element[] =>
    nodes.map((node) => {
      const isFolder = node.type === 'folder';
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedFilePath === node.path;
      return (
        <div key={node.path} className="select-none">
          <div
            className={cn(
              'group flex items-center gap-2 rounded-md border px-2 py-1.5 mb-1 bg-white hover:border-green-300 transition-all',
              isSelected ? 'border-green-400 ring-1 ring-green-200' : 'border-gray-100'
            )}
            style={{ marginLeft: `${depth * 14}px` }}
            onClick={() => {
              if (isFolder) toggleFolder(node.path);
            }}
            onDoubleClick={() => {
              if (!isFolder) onOpenFile?.(node.path);
            }}
            onContextMenu={(e) => handleContextMenu(e, node.path, node.type, node.name)}
          >
            <div className="w-4 text-gray-400">
              {isFolder ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
            </div>
            {isFolder ? (
              isExpanded ? <FolderOpen size={16} className="text-amber-500" /> : <Folder size={16} className="text-amber-500" />
            ) : (
              <FileText size={16} className="text-gray-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-gray-700">{node.name}</p>
            </div>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700"
              onClick={(e) => handleContextMenu(e, node.path, node.type, node.name)}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {isFolder && isExpanded && node.children && node.children.length > 0 ? renderTree(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <div className="w-[360px] h-full bg-[#F5F7FA] flex flex-col border-r border-gray-200 relative">
      <div className="flex-shrink-0">
        <SearchBar
          placeholder="Search workspace..."
          onSearch={setKeyword}
          rightElement={<PlusAction />}
          onRightElementClick={async () => {
            if (!rootPath) {
              toast.error('Set workplace directory first');
              return;
            }
            const name = prompt('File name');
            if (!name) return;
            const ok = await createWorkspaceNode({ parentPath: rootPath, name: name.trim(), type: 'file', content: '' });
            if (!ok) {
              toast.error('Failed to create file');
              return;
            }
            await loadTree();
          }}
        />
      </div>

      <div className="px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500">
          <Layout size={13} />
          <span>Workspace</span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1 truncate">{rootPath || 'No workspace root configured'}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar" onContextMenu={(e) => handleContextMenu(e, rootPath, 'root', 'root')}>
        {isLoading ? <p className="text-xs text-gray-400 px-1">Loading workspace...</p> : null}
        {!isLoading && rootNotReady ? (
          <div className="text-xs text-gray-500 bg-white border border-dashed border-gray-300 rounded-lg p-3">
            Set the workplace directory in Settings to enable workspace files.
          </div>
        ) : null}
        {!isLoading && !rootNotReady && visibleNodes.length === 0 ? (
          <p className="text-xs text-gray-400 px-1">Workspace is empty</p>
        ) : null}
        {!isLoading && !rootNotReady ? renderTree(visibleNodes) : null}
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-50 w-44 bg-white rounded-lg shadow-xl border border-gray-100 py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-green-50 flex items-center gap-2" onClick={() => void runAction('new-file')}>
            <FilePlus size={15} /> New File
          </button>
          <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-green-50 flex items-center gap-2" onClick={() => void runAction('new-folder')}>
            <FolderPlus size={15} /> New Folder
          </button>
          {contextMenu.targetType !== 'root' ? (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 flex items-center gap-2" onClick={() => void runAction('rename')}>
                <Pencil size={15} /> Rename
              </button>
              <button className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2" onClick={() => void runAction('delete')}>
                <Trash2 size={15} /> Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlusAction() {
  return <FolderPlus size={16} />;
}
