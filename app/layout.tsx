import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const title = "Waidwerk · Schießstand-Aufsichtsplan";
  const description = "Der gemeinsame Aufsichtsplan für den Schießstand – übersichtlich, aktuell und installierbar.";
  return {
    metadataBase: baseUrl,
    title,
    description,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Waidwerk" },
    openGraph: { title, description, type: "website", images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1536, height: 1024, alt: "Waidwerk Schießplan" }] },
    twitter: { card: "summary_large_image", title, description, images: [new URL("/og.png", baseUrl).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
