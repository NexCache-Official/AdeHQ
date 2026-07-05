/** Room chat column width (+15% from original 760px). */
export const ROOM_CHAT_MAX_WIDTH = "max-w-[874px]" as const;

/** Wider in-chat cards (+15% from max-w-3xl / 768px). */
export const ROOM_CHAT_WIDE_MAX_WIDTH = "max-w-[883px]" as const;

/** Message markdown typography at default size. */
export const markdownTypography = {
  body: "text-[14px] leading-[1.6]",
  list: "text-[14px] leading-[1.6]",
  quote: "text-[13.5px] leading-relaxed",
  headingLg: "text-[17px]",
  headingMd: "text-[15px]",
  headingCompact: "text-sm",
  code: "text-[12.5px] leading-relaxed",
  table: "text-[12.5px]",
  sourceChip: "text-[11px]",
} as const;

/** Message markdown typography scaled +15% for room chat. */
export const roomChatMarkdownTypography = {
  body: "text-[16.1px] leading-[1.6]",
  list: "text-[16.1px] leading-[1.6]",
  quote: "text-[15.5px] leading-relaxed",
  headingLg: "text-[19.5px]",
  headingMd: "text-[17.2px]",
  headingCompact: "text-[16.1px]",
  code: "text-[14.4px] leading-relaxed",
  table: "text-[14.4px]",
  sourceChip: "text-[12.7px]",
} as const;

export type MarkdownTypography = {
  body: string;
  list: string;
  quote: string;
  headingLg: string;
  headingMd: string;
  headingCompact: string;
  code: string;
  table: string;
  sourceChip: string;
};

export function pickMarkdownTypography(roomScale: boolean): MarkdownTypography {
  return roomScale ? roomChatMarkdownTypography : markdownTypography;
}
