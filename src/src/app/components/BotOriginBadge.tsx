import { Bot, Globe2, Sparkles, Layers } from "lucide-react";
import { cn } from "../../utils/cn";

export type BotOriginKind = "assistant" | "author" | "remote" | "template";

type Props = {
  origin: string | null | undefined;
  /** e.g. "-top-1 -right-1" (contacts) or "-top-1 -left-1" (chat list, away from unread badge) */
  positionClassName: string;
};

const CONFIG: Record<
  BotOriginKind,
  { Icon: typeof Bot; bg: string; title: string }
> = {
  assistant: { Icon: Sparkles, bg: "bg-amber-500", title: "Default assistant" },
  author: { Icon: Bot, bg: "bg-[#07C160]", title: "Bot you created" },
  remote: { Icon: Globe2, bg: "bg-sky-500", title: "Added from discovery" },
  template: { Icon: Layers, bg: "bg-violet-500", title: "Template bot" },
};

export function BotOriginBadge({ origin, positionClassName }: Props) {
  const key =
    origin === "assistant" || origin === "author" || origin === "remote" || origin === "template"
      ? origin
      : null;
  if (!key) return null;
  const { Icon, bg, title } = CONFIG[key];
  return (
    <span
      className={cn(
        "pointer-events-auto absolute z-10 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-white shadow-sm",
        bg,
        positionClassName
      )}
      title={title}
    >
      <Icon size={8} className="text-white" strokeWidth={2.5} />
    </span>
  );
}
