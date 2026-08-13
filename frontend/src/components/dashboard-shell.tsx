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
  brand,
  workspace,
  navItems,
  pathname,
}: {
  brand: string;
  workspace: string;
  navItems: NavItem[];
  pathname: string;
}) {
  return (
    <div className="flex h-full flex-col bg-[#0c1c34] px-3 py-5 text-sky-100">
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <LogoFull height={28} className="shrink-0" />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-[13px] tracking-wide transition-colors",
                isActive
                  ? "bg-white/10 font-medium text-white"
                  : "text-sky-200/60 hover:bg-white/5 hover:text-sky-50",
              )}
            >
              <item.icon
                className={cn(
                  "h-[16px] w-[16px] transition-colors",
                  isActive ? "text-white" : "text-sky-300/50 group-hover:text-sky-100",
                )}
                strokeWidth={1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/5 pt-3 text-[11px] text-sky-300/40">
        Powered by Mistral AI
      </div>
    </div>
  );
}

export function DashboardShell({
  brand,
  workspace,
  navItems,
  userLabel,
  onLogout,
  children,
}: {
  brand: string;
  workspace: string;
  navItems: NavItem[];
  userLabel: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = navItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )?.label;

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-[236px] shrink-0 md:block">
        <div className="fixed h-screen w-[236px]">
          <SidebarContent
            brand={brand}
            workspace={workspace}
            navItems={navItems}
            pathname={pathname}
          />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[236px] border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent
            brand={brand}
            workspace={workspace}
            navItems={navItems}
            pathname={pathname}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border/60 bg-background px-4 md:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-[18px] w-[18px]" />
            </Button>
            <span className="text-sm font-medium text-foreground">{activeLabel}</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 gap-2 px-2 text-sm" />}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                {userLabel.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[140px] truncate text-muted-foreground">{userLabel}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onLogout} className="gap-2 text-sm">
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
