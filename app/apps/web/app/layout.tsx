import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yeyak — Your Resy Reservationist",
  description: "A mobile-first reservation concierge powered by AI and Resy.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#faf7f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-cream text-ink">
        <div className="mx-auto min-h-dvh w-full max-w-phone bg-cream shadow-sm">
          {children}
        </div>
      </body>
    </html>
  );
}
