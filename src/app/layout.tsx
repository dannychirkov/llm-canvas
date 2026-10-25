import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { SettingsProvider } from "@/components/providers/SettingsProvider";
import { PostHogProvider } from "@/components/providers/PostHogProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LLM Canvas",
  description: "A node-based IDE that brings structure to your AI-powered thinking",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 24x24 32x32 48x48 64x64", type: "image/x-icon" },
      { url: "/brand/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { var s = localStorage.getItem('theme'); var sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; var t = (s === 'light' || s === 'dark') ? s : s === 'system' ? sys : 'dark'; var root = document.documentElement; if (t === 'dark') { root.classList.add('dark'); } else { root.classList.remove('dark'); } root.setAttribute('data-theme', t); } catch (e) {} })();`
          }}
        />
        <SessionProvider>
          <PostHogProvider>
            <SettingsProvider>
              {children}
            </SettingsProvider>
          </PostHogProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
