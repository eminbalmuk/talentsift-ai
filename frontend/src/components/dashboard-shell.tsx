"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LogoFull } from "@/components/logo";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

function SidebarContent({
  workspace,
  navItems,
  pathname,
  onNavigate,
}: {
  workspace: string;
  navItems: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-[#0c1c34] px-3 py-5 text-sky-100">
      <div className="mb-2 flex items-center gap-2.5 px-2">
        <LogoFull height={32} invert className="shrink-0" />
      </div>
      <div className="mb-5 px-2 text-[11px] font-medium uppercase tracking-wider text-sky-300/60">
        {workspace}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5" aria-label={workspace}>
        {navItems.map((item) => {
          const isExactOnly = item.href === "/admin/dashboard" || item.href === "/org/dashboard";
          const isActive = isExactOnly
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-2.5 rounded-[6px] px-2.5 py-[8px] text-[13px] tracking-wide transition-colors",
                isActive
                  ? "bg-white/15 font-medium text-white"
                  : "text-sky-200/75 hover:bg-white/5 hover:text-sky-50",
              )}
            >
              <item.icon
                className={cn(
                  "h-[16px] w-[16px] shrink-0 transition-colors",
                  isActive ? "text-white" : "text-sky-300/60 group-hover:text-sky-100",
                )}
                strokeWidth={1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-3 text-[11px] text-sky-300/60">
        UltraBERT + Mistral AI
      </div>
    </div>
  );
}

export function DashboardShell({
  workspace,
  navItems,
  userLabel,
  onLogout,
  themeClass,
  children,
}: {
  brand: string;
  workspace: string;
  navItems: NavItem[];
  userLabel: string;
  onLogout: () => void;
  themeClass?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = navItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )?.label;

  return (
    <div className={cn("flex min-h-screen bg-muted/30", themeClass)}>
      <aside className="hidden w-[236px] shrink-0 md:block">
        <div className="fixed h-screen w-[236px]">
          <SidebarContent
            workspace={workspace}
            navItems={navItems}
            pathname={pathname}
          />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[236px] border-0 p-0">
          <SheetTitle className="sr-only">Navigasyon Menüsü</SheetTitle>
          <SidebarContent
            workspace={workspace}
            navItems={navItems}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden"
              aria-label="Navigasyon menüsünü aç"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-[18px] w-[18px]" />
            </Button>
            <span className="truncate text-sm font-medium text-foreground">{activeLabel}</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 gap-2 px-2 text-sm" />}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                {userLabel.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[140px] truncate text-muted-foreground">{userLabel}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onLogout} className="gap-2 text-sm">
                <LogOut className="h-4 w-4" />
                Çıkış Yap
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
