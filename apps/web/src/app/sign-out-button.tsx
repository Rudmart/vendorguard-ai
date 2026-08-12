"use client";

import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch("http://localhost:4000/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      style={{
        background: "transparent",
        color: "#8b96ac",
        border: "1px solid #233150",
        borderRadius: 8,
        padding: "6px 14px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      Sign Out
    </button>
  );
}
