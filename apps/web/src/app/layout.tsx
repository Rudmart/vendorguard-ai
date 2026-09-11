import Sidebar from "./sidebar";
import AppShell from "./app-shell";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#141b2d", color: "#e9edf6", display: "flex" }}>
        <Sidebar />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}