"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "@/lib/api";

const NAV_ITEMS: NavItem[] = [{ label: "Organizasyonlar", href: "/admin/dashboard", icon: Building2 }];

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ username: string }>("/api/admin/me")
      .then((data) => setUsername(data.username))
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  async function handleLogout() {
    await apiPost("/api/admin/logout");
    router.replace("/admin/login");
  }

  if (!username) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  return (
    <DashboardShell
      brand="TalentSift AI"
      workspace="Yönetici konsolu"
      navItems={NAV_ITEMS}
      userLabel={username}
      onLogout={handleLogout}
    >
      {children}
    </DashboardShell>
  );
}
