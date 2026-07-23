import type { Metadata } from "next";
import favicon from "@/images/favicon.png";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DevTrack", template: "%s | DevTrack" },
  description: "Wrike reporting for course-development teams",
  icons: { icon: favicon.src, shortcut: favicon.src, apple: favicon.src }
};
export const dynamic = "force-dynamic";
export default function RootLayout({ children, modal }: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return <html lang="en"><body>{children}{modal}</body></html>;
}
