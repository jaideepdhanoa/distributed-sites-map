import type { Metadata } from "next";
import { Suspense } from "react";
import Explorer from "@/components/Explorer";
import Wordmark from "@/components/Wordmark";

export const metadata: Metadata = {
  title: { absolute: "Map · Distributed Infra" },
};

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="empty">
          <Wordmark level="p" />
          <p>Loading</p>
        </main>
      }
    >
      <Explorer />
    </Suspense>
  );
}
