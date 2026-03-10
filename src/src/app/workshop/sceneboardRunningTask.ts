/**
 * 全局存储「正在生成的 storyboard 任务」，用于从其他页面回到 Sceneboard 主页面时仍能显示「正在运行」卡片。
 * 仅在内存中，请求结束时清空。
 */

export type RunningStoryboardTask = {
  title: string;
  startedAt: number;
  inFlight: boolean;
};

let current: RunningStoryboardTask | null = null;

export function getRunningStoryboardTask(): RunningStoryboardTask | null {
  return current;
}

export function setRunningStoryboardTask(task: RunningStoryboardTask | null): void {
  current = task;
}
