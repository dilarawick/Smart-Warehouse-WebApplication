"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Home", hint: "QR scans & camera" },
  { href: "/robot-arm", label: "Robot arm", hint: "Controls" },
  { href: "/car", label: "Car", hint: "Fleet" },
  { href: "/analytics", label: "Analytics", hint: "Charts & metrics" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f4f4f5" }}>
      <aside
        style={{
          width: 268,
          flexShrink: 0,
          background: "linear-gradient(180deg, #fb923c 0%, #f97316 42%, #ea580c 100%)",
          color: "#fffbeb",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          borderRight: "1px solid #c2410c",
          boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.2)",
        }}
      >
        <div style={{ position: "relative", height: 96, width: "100%", marginBottom: 4 }}>
          <Image
            src="/logo.png"
            alt="Smart Warehouse"
            fill
            sizes="268px"
            priority
            style={{ objectFit: "contain", objectPosition: "left center" }}
          />
        </div>

        <div
          style={{
            padding: "8px 10px 20px",
            borderBottom: "1px solid rgba(127, 29, 29, 0.35)",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#ffedd5",
            }}
          >
            Smart Warehouse
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4, color: "#ffffff" }}>Dashboard</div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "block",
                  padding: "12px 14px",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: active ? "#7c2d0e" : "#fffbeb",
                  background: active ? "rgba(255, 255, 255, 0.92)" : "rgba(124, 45, 18, 0.22)",
                  border: active ? "1px solid rgba(255, 255, 255, 0.65)" : "1px solid transparent",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: active ? "#9a3412" : "#ffedd5", marginTop: 2 }}>{item.hint}</div>
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", padding: "12px 10px", fontSize: 12, color: "rgba(255, 247, 237, 0.75)" }}>
          IoT · QR · Azure SQL
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>{children}</div>
    </div>
  );
}
