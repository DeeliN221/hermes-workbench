/** Scroll persisted transcripts to the end so the latest turn is visible first. */
export function scrollTranscriptToEnd(
  pane: Pick<HTMLElement, 'scrollHeight' | 'scrollTop'> | null,
): void {
  if (pane) pane.scrollTop = pane.scrollHeight;
}
