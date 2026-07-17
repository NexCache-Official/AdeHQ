export const AVATAR_BUCKET = "adehq-avatars";
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function avatarObjectPath(userId: string, ext: "svg" | "png" | "webp" = "png"): string {
  return `${userId}/avatar.${ext}`;
}
