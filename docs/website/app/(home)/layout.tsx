import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <div className="lp-root flex min-h-screen flex-1 flex-col">{children}</div>;
}
