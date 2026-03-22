import { Radio } from "lucide-react";
import { cn } from "../../utils/cn";

/** WeChat (personal) — brand-style bubble */
export function WeixinPlatformIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.3.3 0 00.166-.054l1.9-1.106a.59.59 0 01.498-.048A10.07 10.07 0 008.69 17.07c.45 0 .893-.034 1.327-.1a5.72 5.72 0 01-.241-1.652c0-3.449 3.063-6.248 6.836-6.248.352 0 .697.027 1.035.076C17.099 5.376 13.307 2.188 8.69 2.188zm-2.78 5.09c-.638 0-1.155-.517-1.155-1.155 0-.639.517-1.155 1.155-1.155.639 0 1.156.516 1.156 1.155 0 .638-.517 1.156-1.156 1.156zm5.173 0c-.639 0-1.156-.517-1.156-1.155 0-.639.517-1.155 1.156-1.155.638 0 1.155.516 1.155 1.155 0 .638-.517 1.156-1.155 1.156zM24 15.319c0-3.259-3.063-5.903-6.836-5.903-3.773 0-6.836 2.644-6.836 5.903 0 3.26 3.063 5.903 6.836 5.903.595 0 1.171-.07 1.724-.195a.467.467 0 01.394.038l1.508.877a.235.235 0 00.131.042.232.232 0 00.232-.233c0-.058-.023-.113-.038-.168l-.31-1.174a.468.468 0 01.168-.527C22.941 19.087 24 17.318 24 15.319zM14.73 14.4c-.505 0-.915-.41-.915-.915s.41-.915.915-.915.915.41.915.915-.41.915-.915.915zm3.711 0c-.505 0-.916-.41-.916-.915s.41-.915.916-.915c.505 0 .915.41.915.915s-.41.915-.915.915z" />
    </svg>
  );
}

const FEISHU_LOGO = `${import.meta.env.BASE_URL}channel-feishu.png`;
const WECOM_LOGO = `${import.meta.env.BASE_URL}channel-wecom.png`;

/** Feishu / Lark — official mark (`public/channel-feishu.png`) */
export function FeishuPlatformIcon({ className }: { className?: string }) {
  return (
    <img src={FEISHU_LOGO} alt="" className={cn("object-contain", className)} draggable={false} aria-hidden />
  );
}

/** WeChat Work — official mark (`public/channel-wecom.png`) */
export function WecomPlatformIcon({ className }: { className?: string }) {
  return (
    <img src={WECOM_LOGO} alt="" className={cn("object-contain", className)} draggable={false} aria-hidden />
  );
}

const WRAP: Record<string, string> = {
  weixin_personal: "bg-[#07C160]/10 text-[#07C160]",
  feishu: "bg-white border border-gray-100",
  wecom: "bg-white border border-gray-100",
  default: "bg-gray-100 text-gray-400",
};

export function ChannelPlatformIconBox({
  channelType,
  className,
}: {
  channelType: string;
  className?: string;
}) {
  const wrap = WRAP[channelType] ?? WRAP.default;
  return (
    <div className={cn("w-8 h-8 rounded flex items-center justify-center shrink-0", wrap, className)}>
      <ChannelPlatformIcon channelType={channelType} className="w-5 h-5" />
    </div>
  );
}

export function ChannelPlatformIcon({ channelType, className }: { channelType: string; className?: string }) {
  switch (channelType) {
    case "weixin_personal":
      return <WeixinPlatformIcon className={className} />;
    case "feishu":
      return <FeishuPlatformIcon className={className} />;
    case "wecom":
      return <WecomPlatformIcon className={className} />;
    default:
      return <Radio size={18} className={cn("text-blue-600", className)} />;
  }
}

/** Chat message row: icon + label for inbound/outbound channel (same for user & assistant). */
export function ChannelMessageSourceBadge({
  channelType,
}: {
  channelType: string | null | undefined;
}) {
  const ct = channelType ?? "";
  if (ct === "feishu") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100/80">
        <FeishuPlatformIcon className="w-3.5 h-3.5 flex-shrink-0 rounded-[2px]" />
        来自飞书
      </span>
    );
  }
  if (ct === "wecom") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-100/80">
        <WecomPlatformIcon className="w-3.5 h-3.5 flex-shrink-0 rounded-[2px]" />
        来自企微
      </span>
    );
  }
  if (ct === "weixin_personal") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#07C160]/15 text-[#07C160]">
        <WeixinPlatformIcon className="w-3 h-3 flex-shrink-0" />
        来自微信
      </span>
    );
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Creez</span>;
}
