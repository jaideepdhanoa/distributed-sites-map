import { Suspense } from "react";
import Explorer from "@/components/Explorer";

export default function HomePage() {
  return (
    <Suspense fallback={<main className="empty">Loading</main>}>
      <Explorer />
    </Suspense>
  );
}
