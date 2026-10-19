/** Resolve slash-command input before deciding whether it is a model message. */
export async function shouldSubmitComposerMessage(
  content: string,
  runCommand: (content: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  return !content || !(await runCommand(content));
}
