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

export function RowLinks({
  listing,
  folder,
  packageHref,
}: {
  listing?: string;
  folder?: string;
  packageHref?: string;
}) {
  const items = [
    listing ? { href: listing, label: "Listing", kind: "listing" as const } : null,
    folder ? { href: folder, label: "Folder", kind: "folder" as const } : null,
    packageHref ? { href: packageHref, label: "Package", kind: "package" as const } : null,
  ].filter((item): item is { href: string; label: string; kind: "listing" | "folder" | "package" } => Boolean(item));
  if (!items.length) return null;
  return (
    <span className="row-links">
      {items.map((item) => (
        <a
          key={item.kind}
          className="row-link"
          data-testid={`row-link-${item.kind}`}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={item.label}
          title={item.label}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon kind={item.kind} />
        </a>
      ))}
    </span>
  );
}
