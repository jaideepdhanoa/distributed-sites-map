/** Use this fills a composer. It does not post, approve, or reject. */
export function applySuggestedDraft(draft: string): { composer: string; posted: false } {
  return { composer: draft, posted: false };
}
