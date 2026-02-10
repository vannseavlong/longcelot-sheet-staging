'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { MobileNav } from './mobile-nav';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="md:pl-64">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
