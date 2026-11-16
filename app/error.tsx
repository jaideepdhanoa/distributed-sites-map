"use client";

import { useEffect } from "react";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ event: "page_error" }));
  }, []);
  return (
    <main className="page-error">
      <div className="panel-error" role="alert">
        <p className="eyebrow">Map</p>
        <p>This page could not load.</p>
        <button type="button" className="paper-btn" onClick={() => retry()}>Try again</button>
      </div>
    </main>
  );
}
