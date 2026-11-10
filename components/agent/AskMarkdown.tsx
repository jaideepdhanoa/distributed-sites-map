"use client";

import { useRouter } from "next/navigation";
import { parseAskMarkdown, type AskInline } from "@/lib/ask/markdown";

function Inline({ item, onSite }: { item: AskInline; onSite: (href: string) => void }) {
  if (item.kind === "strong") return <strong>{item.text}</strong>;
  if (item.kind === "text") return <>{item.text}</>;
  if (item.external) {
    return (
      <a className="text-link" href={item.href} target="_blank" rel="noopener noreferrer">
        {item.label} ↗
      </a>
    );
  }
  return (
    <a
      className="text-link"
      href={item.href}
      onClick={(event) => {
        event.preventDefault();
        onSite(item.href);
      }}
    >
      {item.label}
    </a>
  );
}

export function AskMarkdown({ text }: { text: string }) {
  const router = useRouter();
  const blocks = parseAskMarkdown(text);
  return (
    <div className="ask-md">
      {blocks.map((block, index) => {
        if (block.kind === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.map((part, partIndex) => (
                    <Inline key={partIndex} item={part} onSite={(href) => router.push(href, { scroll: false })} />
                  ))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {block.inlines.map((part, partIndex) => (
              <Inline key={partIndex} item={part} onSite={(href) => router.push(href, { scroll: false })} />
            ))}
          </p>
        );
      })}
    </div>
  );
}
