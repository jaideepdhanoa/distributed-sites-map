import { Suspense } from "react";
import type { Metadata } from "next";
import SpaceReviewList from "@/components/spaces/SpaceReviewList";

export const metadata: Metadata = { title: "Pipeline space review" };

export default function SpaceReviewPage() {
  return <Suspense fallback={<main className="space-review-page">Loading site assessments…</main>}><SpaceReviewList /></Suspense>;
}
