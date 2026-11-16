/** Where the phone palette sits while the keyboard covers the layout viewport. */
export function commandSheetBox(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number },
): { bottom: number; maxHeight: number } | null {
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0) return null;
  if (!Number.isFinite(viewport.height) || viewport.height <= 0) return null;
  const offset = Number.isFinite(viewport.offsetTop) ? viewport.offsetTop : 0;
  const bottom = Math.max(0, Math.round(layoutHeight - viewport.height - offset));
  if (bottom < 80) return null;
  return { bottom, maxHeight: Math.max(240, Math.round(viewport.height - 12)) };
}
