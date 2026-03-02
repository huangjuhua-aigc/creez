import { FileText, Folder, ChevronRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Mock file structure
const files = [
  {
    id: "root",
    name: "Project",
    type: "folder",
    children: [
      { id: "1", name: "knowledge-base.pdf", type: "file" },
      { id: "2", name: "data.csv", type: "file" },
      {
        id: "src",
        name: "src",
        type: "folder",
        children: [
          { id: "3", name: "main.py", type: "file" },
          { id: "4", name: "utils.py", type: "file" },
        ],
      },
      { id: "5", name: "README.md", type: "file" },
    ],
  },
];

type FileNode = {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
};

const FileItem = ({ node, level = 0 }: { node: FileNode; level?: number }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300 rounded-sm"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => node.type === "folder" && setIsOpen(!isOpen)}
      >
        {node.type === "folder" && (
          <span className="text-zinc-400">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        {node.type === "folder" ? (
          <Folder size={14} className="text-blue-400" />
        ) : (
          <FileText size={14} className="text-zinc-500" />
        )}
        <span>{node.name}</span>
      </div>
      {node.type === "folder" && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileItem key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export function FileSidebar() {
  return (
    <div className="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Files</h2>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {files.map((node) => (
          <FileItem key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}
