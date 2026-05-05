import "./globals.css";

export const metadata = {
  title: "16-Week Weight Gain Tracker",
  description: "Track bodyweight and calories with Supabase",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
