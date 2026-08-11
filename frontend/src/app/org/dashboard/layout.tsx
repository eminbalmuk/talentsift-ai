"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Users } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "@/lib/api";

const NAV_ITEMS: NavItem[] = [
  { label: "Genel Bakış", href: "/org/dashboard", icon: LayoutDashboard },
  { label: "Adaylar", href: "/org/dashboard/candidates", icon: Users },
];

export default function OrgDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ display_name: string }>("/api/org/me")
      .then((data) => setDisplayName(data.display_name))
      .catch(() => router.replace("/org/login"));
  }, [router]);

  async function handleLogout() {
    await apiPost("/api/org/logout");
    router.replace("/org/login");
  }

  if (!displayName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  return (
    <DashboardShell
      brand="TalentSift AI"
      workspace={displayName}
      navItems={NAV_ITEMS}
      userLabel={displayName}
      onLogout={handleLogout}
    >
      {children}
    </DashboardShell>
  );
}
