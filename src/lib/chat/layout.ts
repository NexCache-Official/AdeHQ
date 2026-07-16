/** Room chat column width. */
export const ROOM_CHAT_MAX_WIDTH = "max-w-[760px]" as const;

/** Wider in-chat cards (aligns with max-w-3xl). */
export const ROOM_CHAT_WIDE_MAX_WIDTH = "max-w-[768px]" as const;

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

/** Room chat uses the same typography as default markdown (no +15% scale). */
export const roomChatMarkdownTypography = markdownTypography;

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
