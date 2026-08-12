export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0a0f1a", color: "#e9edf6" }}>
        {children}
      </body>
    </html>
  );
}
