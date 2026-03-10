import { formatFileSize, fileExtLabel } from "../../utils/fileDisplay";

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

interface AttachmentCardProps {
  attachment: PendingAttachment;
  onRemove: (id: string) => void;
  className?: string;
}

/** 单条附件卡片，与对话输入框中的附件样式一致，可复用。 */
export function AttachmentCard({ attachment, onRemove, className = "" }: AttachmentCardProps) {
  const { id, file, previewUrl } = attachment;
  return (
    <span
      className={
        "inline-flex items-center gap-3 px-3 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle max-w-[520px] " +
        className
      }
      data-attachment-id={id}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={file.name}
          className="w-14 h-14 rounded-lg object-cover bg-white flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-12 rounded-md bg-[#F25F3A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
          {fileExtLabel(file.name)}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[12px] text-gray-800 truncate max-w-[320px]">{file.name}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{formatFileSize(file.size)}</div>
      </div>
      <button
        type="button"
        className="w-5 h-5 rounded text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-700 flex-shrink-0"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(id);
        }}
      >
        ×
      </button>
    </span>
  );
}
