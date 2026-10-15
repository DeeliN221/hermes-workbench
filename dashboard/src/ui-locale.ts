/** Locale helpers for plugin-owned UI. Raw paths, commands, and user content are never translated. */
export function chineseUI(root: Pick<Document, 'documentElement'> | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  // English is the default; Chinese is enabled only by an explicit locale.
  const lang = (root?.documentElement.lang || '').trim().toLowerCase();
  return lang.startsWith('zh');
}

export function uiText(chinese: string, english: string, root: Pick<Document, 'documentElement'> | undefined = typeof document === 'undefined' ? undefined : document): string {
  return chineseUI(root) ? chinese : english;
}
