/** Unwrap a single literal shell invocation for display only, never for execution. */
export function displayCommand(command: string): string {
  const prefix = /^(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh)\s+-(?:lc|c)\s+/.exec(command);
  if (!prefix) return command;
  const rest = command.slice(prefix[0].length);
  let quote = '', value = '', started = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (!quote && /\s/.test(c)) {
      return rest.slice(i).trim() === '' && started ? value : command;
    }
    if (c === "'" && quote !== '"') {
      quote = quote ? '' : "'";
      started = true;
    } else if (c === '"' && quote !== "'") {
      quote = quote ? '' : '"';
      started = true;
    } else if (c === '\\' && quote !== "'") {
      const next = rest[++i];
      if (next === undefined) return command;
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) value += '\\';
      if (next !== '\n') value += next;
      started = true;
    } else {
      // Expansion or shell operators outside literal quotes need the full context.
      if (quote !== "'" && /[$`]/.test(c)) return command;
      if (!quote && /[;&|<>()*?{}~#]/.test(c)) return command;
      value += c;
      started = true;
    }
  }
  return !quote && started ? value : command;
}
