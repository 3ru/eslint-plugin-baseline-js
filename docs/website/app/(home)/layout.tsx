import { HomeLayout as HomeLayoutUI } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";

const HomeLayout: typeof HomeLayoutUI = HomeLayoutUI;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen overflow-x-hidden bg-gradient-to-b from-[#000001] via-[#0a0d18] to-[#06050e]">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-10%] h-[40rem] w-[36rem] sm:w-[48rem] md:w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.18),transparent_60%)] blur-3xl" />
      </div>
      <HomeLayout {...baseOptions()}>{children}</HomeLayout>
    </div>
  );
}
