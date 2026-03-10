export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)}${units[idx]}`;
}

export function fileExtLabel(name: string): string {
  const lower = String(name || "").toLowerCase();
  const i = lower.lastIndexOf(".");
  if (i === -1 || i === lower.length - 1) return "FILE";
  return lower.slice(i + 1, i + 5).toUpperCase();
}
