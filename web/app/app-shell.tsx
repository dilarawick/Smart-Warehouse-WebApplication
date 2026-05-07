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
    <div style={{ display: "flex", minHeight: "100vh", background: "transparent" }}>
      <aside
        style={{
          width: 268,
          flexShrink: 0,
          background: "#dcdada",
          color: "#071a3b",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          borderRight: "1px solid rgba(7,26,59,0.06)",
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
              color: "#0b2940",
            }}
          >
            Smart Warehouse
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4, color: "#071a3b" }}>Dashboard</div>
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
                  color: active ? "#ffffff" : "#071a3b",
                  background: active ? "#0b69ff" : "transparent",
                  border: active ? "1px solid rgba(11,105,255,0.12)" : "1px solid transparent",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: active ? "rgba(255,255,255,0.9)" : "#6b7280", marginTop: 2 }}>{item.hint}</div>
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", padding: "12px 10px", fontSize: 12, color: "#475569" }}>
          IoT · QR · Azure SQL
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>{children}</div>
    </div>
  );
}
