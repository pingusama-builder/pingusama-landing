import type { Metadata } from "next";
import { Aleo, Fraunces, Nunito } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const aleo = Aleo({
  subsets: ["latin"],
  variable: "--font-aleo",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pingusama's Tinkering — A small workshop of makings",
  description: "A small workshop of makings built by Pingusama.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${aleo.variable} ${nunito.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
