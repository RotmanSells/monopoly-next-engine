import type { Metadata, Viewport } from "next";
import { PwaRegistrar } from "@/src/ui/components/pwa-registrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monopoly Room Engine",
  description: "Локальный PWA-движок для ведения комнаты Monopoly",
  applicationName: "Monopoly Room Engine",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f0df",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}
