import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Newsreader } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { StoreProvider } from "@/lib/demo-store";
import { AuthConfirmHandler } from "@/components/auth/AuthConfirmHandler";
import { PasswordRecoveryGate } from "@/components/auth/PasswordRecoveryGate";
import { ThemeProvider, themeInitScript } from "@/components/ThemeProvider";

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AdeHQ — Your AI Workforce Workspace",
  description:
    "The easiest way to create and manage your AI workforce. Hire AI employees, give them tools, and work with them in project rooms.",
  manifest: "/manifest.webmanifest",
  themeColor: "#241e1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">
        <ThemeProvider>
          <StoreProvider>
            <AuthConfirmHandler />
            <PasswordRecoveryGate />
            {children}
          </StoreProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
