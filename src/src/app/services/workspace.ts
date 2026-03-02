export type WorkspaceNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: WorkspaceNode[];
};

function getWorkspaceApi() {
  return window.electron?.workspace;
}

export async function fetchWorkspaceTree(depth = 4): Promise<{ rootPath: string; nodes: WorkspaceNode[] } | null> {
  const api = getWorkspaceApi();
  if (!api) return null;
  const result = await api.getTree({ depth });
  if (!result.ok) return null;
  return {
    rootPath: result.data.rootPath,
    nodes: (result.data.nodes || []) as WorkspaceNode[],
  };
}

export async function createWorkspaceNode(payload: {
  parentPath: string;
  name: string;
  type: "file" | "folder";
  content?: string;
}): Promise<boolean> {
  const api = getWorkspaceApi();
  if (!api) return false;
  const result = await api.create(payload);
  return Boolean(result.ok);
}

export async function renameWorkspaceNode(path: string, newName: string): Promise<boolean> {
  const api = getWorkspaceApi();
  if (!api) return false;
  const result = await api.rename({ path, newName });
  return Boolean(result.ok);
}

export async function deleteWorkspaceNode(path: string, recursive = false): Promise<boolean> {
  const api = getWorkspaceApi();
  if (!api) return false;
  const result = await api.delete({ path, recursive });
  return Boolean(result.ok);
}

export async function readWorkspaceFile(path: string): Promise<string | null> {
  const api = getWorkspaceApi();
  if (!api) return null;
  const result = await api.readFile({ path, encoding: "utf8" });
  if (!result.ok) return null;
  return result.data.content;
}

export async function writeWorkspaceFile(path: string, content: string): Promise<boolean> {
  const api = getWorkspaceApi();
  if (!api) return false;
  const result = await api.writeFile({ path, content, encoding: "utf8", createIfMissing: true });
  return Boolean(result.ok);
}
