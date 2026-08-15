import Sidebar from "./sidebar";
import TopHeader from "./top-header";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#141b2d", color: "#e9edf6", display: "flex" }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}><TopHeader />{children}</div>
      </body>
    </html>
  );
}



