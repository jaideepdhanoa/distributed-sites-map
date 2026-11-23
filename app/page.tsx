import type { Metadata } from "next";
import { Suspense } from "react";
import AppLoading from "@/components/AppLoading";
import Explorer from "@/components/Explorer";

export const metadata: Metadata = {
  title: { absolute: "Map · Distributed Sites" },
};

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <AppLoading />
      }
    >
      <Explorer />
    </Suspense>
  );
}
