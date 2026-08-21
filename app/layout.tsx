import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Obsidian Desk — Live",
    description: "Real agent pipeline, paper trading only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
          <html lang="en">
                <head>
                        <link rel="preconnect" href="https://fonts.googleapis.com" />
                        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                        <link
                                    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
                                    rel="stylesheet"
                                  />
                </head>head>
                <body>{children}</body>body>
          </html>html>
        );
}</html>
