/** Room chat column width (messages + composer). */
export const ROOM_CHAT_MAX_WIDTH = "max-w-[900px]" as const;

/** Wider in-chat cards (steward / research / hiring). */
export const ROOM_CHAT_WIDE_MAX_WIDTH = "max-w-[920px]" as const;

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

/** Room chat: ~5% larger type than default markdown. */
export const roomChatMarkdownTypography = {
  body: "text-[15px] leading-[1.62]",
  list: "text-[15px] leading-[1.62]",
  quote: "text-[14px] leading-relaxed",
  headingLg: "text-[18px]",
  headingMd: "text-[16px]",
  headingCompact: "text-[15px]",
  code: "text-[13px] leading-relaxed",
  table: "text-[13px]",
  sourceChip: "text-[11.5px]",
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
