import { render } from "@react-email/render";
import type { ReactElement } from "react";

/** Render a React Email element to an HTML string + plain-text fallback. */
export async function renderEmail(element: ReactElement): Promise<{
  html: string;
  text: string;
}> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}
