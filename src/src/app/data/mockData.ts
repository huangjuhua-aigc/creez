
export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileItem[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Bot {
  id: string;
  name: string;
  avatar?: string;
  description: string;
}

export const MOCK_FILES: FileItem[] = [
  {
    id: '1',
    name: '我的项目',
    type: 'folder',
    children: [
      { id: '1-1', name: '需求文档.md', type: 'file' },
      { id: '1-2', name: '架构设计.pdf', type: 'file' },
    ]
  },
  {
    id: '2',
    name: '参考资料',
    type: 'folder',
    children: [
      { id: '2-1', name: 'API接口.json', type: 'file' },
      { id: '2-2', name: '竞品分析.xlsx', type: 'file' },
    ]
  },
  { id: '3', name: '未命名文件.txt', type: 'file' }
];

export const MOCK_BOTS: Bot[] = [
  { id: 'b1', name: '通用助手', description: '可以回答任何问题的全能助手' },
  { id: 'b2', name: '代码专家', description: '专注于编程和代码审查' },
  { id: 'b3', name: '翻译官', description: '精通多国语言的翻译助手' },
];

export const MOCK_MESSAGES: Record<string, Message[]> = {
  'b1': [
    { id: 'm1', role: 'assistant', content: '你好！我是通用助手，有什么我可以帮你的吗？', timestamp: '10:00' },
    { id: 'm2', role: 'user', content: '我想写一个React组件。', timestamp: '10:01' },
    { id: 'm3', role: 'assistant', content: '当然，请告诉我更多细节。', timestamp: '10:01' },
  ],
  'b2': [
    { id: 'm1', role: 'assistant', content: '你好，我是代码专家。请贴出你的代码。', timestamp: '11:00' },
  ],
  'b3': [
    { id: 'm1', role: 'assistant', content: 'Hello! I am your translator.', timestamp: '09:00' },
  ]
};
