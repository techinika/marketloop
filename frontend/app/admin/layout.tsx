import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminGuard } from "@/components/AdminGuard";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container-page py-10 sm:py-14">
      <AdminGuard>{children}</AdminGuard>
    </div>
  );
}
