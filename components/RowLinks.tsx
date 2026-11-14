"use client";

function Icon({ kind }: { kind: "listing" | "folder" | "package" }) {
  if (kind === "folder") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" />
      </svg>
    );
  }
  if (kind === "package") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5h7l5 5V20.5H7v-17Z" />
        <path d="M14 3.5V9h5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="M19 5 10 14" />
      <path d="M17 13.5V19H5V7h5.5" />
    </svg>
  );
}

const COPY = {
  listing: { label: "Open the listing", missing: "No listing on file", testId: "listing-link" },
  folder: { label: "Open the site folder", missing: "No site folder on file", testId: "site-folder-link" },
  package: { label: "Open the package", missing: "No package on file", testId: "package-link" },
} as const;

export function RowLinks({
  listing,
  folder,
  packageHref,
  listingTitle,
  showMissing = false,
  testIds = "row",
}: {
  listing?: string;
  folder?: string;
  packageHref?: string;
  listingTitle?: string;
  showMissing?: boolean;
  testIds?: "row" | "card";
}) {
  const items = [
    { kind: "listing" as const, href: listing || "" },
    { kind: "folder" as const, href: folder || "" },
    { kind: "package" as const, href: packageHref || "" },
  ].filter((item) => item.href || (showMissing && item.kind !== "package"));
  if (!items.length) return null;
  return (
    <span className="row-links">
      {items.map((item) => {
        const copy = COPY[item.kind];
        const title = item.kind === "listing" && item.href ? (listingTitle || copy.label) : item.href ? copy.label : copy.missing;
        const testId = testIds === "card" ? copy.testId : `row-link-${item.kind}`;
        if (!item.href) {
          return (
            <span key={item.kind} className="row-link muted" data-testid={testId} title={title} aria-label={title}>
              <Icon kind={item.kind} />
            </span>
          );
        }
        return (
          <a
            key={item.kind}
            className="row-link"
            data-testid={testId}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={title}
            title={title}
            onClick={(event) => event.stopPropagation()}
          >
            <Icon kind={item.kind} />
          </a>
        );
      })}
    </span>
  );
}
