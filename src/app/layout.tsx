import type { Metadata } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/demo-store";
import { AuthConfirmHandler } from "@/components/auth/AuthConfirmHandler";
import { ThemeProvider, themeInitScript } from "@/components/ThemeProvider";

const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-schibsted",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AdeHQ — Your AI Workforce Workspace",
  description:
    "The easiest way to create and manage your AI workforce. Hire AI employees, give them tools, and work with them in project rooms.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">
        <ThemeProvider>
          <StoreProvider>
            <AuthConfirmHandler />
            {children}
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
