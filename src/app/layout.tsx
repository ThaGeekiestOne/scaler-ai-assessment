import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scaler AI Intern Submission",
  description: "Voice scheduling and grounded RAG chat submission for Scaler's AI intern screen.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
