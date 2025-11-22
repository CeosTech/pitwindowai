import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import "./globals.css";

export const metadata = {
  title: "GR PitWindow Engine",
  description: "Real-time pit strategy dashboard for Toyota GR Cup"
};

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-primary",
  display: "swap"
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className={`app-body ${manrope.className}`}>
        {children}
      </body>
    </html>
  );
}
