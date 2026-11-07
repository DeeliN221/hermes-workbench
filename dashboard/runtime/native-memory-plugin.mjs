// Mounted by the native Agent-preset registry, in that preset's scope.
export const name = 'workbench-literal-memory';
export const inject = ['systemPrompt'];
export function apply(ctx, config) {
  for (const [index, [name, text]] of Object.entries(config.memory ?? {}).entries()) {
    ctx.systemPrompt.section({name: `workbench:memory:${name}`, order: 10500 + index,
      text: `## ${name}\n${text}`, interpolate: false});
  }
}
