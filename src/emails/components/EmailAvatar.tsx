import * as React from "react";
import { Img } from "@react-email/components";
import { colors, radius } from "../theme";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/**
 * A small round avatar. Prefers an image; falls back to initials on an accent
 * tile (Gmail renders background-color on a table cell reliably).
 */
export function EmailAvatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  if (src) {
    return (
      <Img
        src={src}
        width={String(size)}
        height={String(size)}
        alt={name}
        style={{ borderRadius: radius.full, display: "block" }}
      />
    );
  }
  return (
    <table cellPadding={0} cellSpacing={0} role="presentation" style={{ borderCollapse: "collapse" }}>
      <tbody>
        <tr>
          <td
            style={{
              width: `${size}px`,
              height: `${size}px`,
              borderRadius: radius.full,
              backgroundColor: colors.accentSoft,
              color: colors.accentDark,
              textAlign: "center",
              fontSize: `${Math.round(size * 0.36)}px`,
              fontWeight: 700,
              verticalAlign: "middle",
            }}
          >
            {initials(name) || "?"}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export default EmailAvatar;
