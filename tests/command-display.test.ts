import { describe, expect, it } from 'vitest';
import { displayCommand } from '../dashboard/src/command-display';

describe('literal shell command display', () => {
  it('unwraps single and double quotes, preserving multiline scripts and escaped quotes', () => {
    expect(displayCommand("/bin/sh -lc 'git status' ")).toBe('git status');
    expect(displayCommand('/bin/sh -lc "python3 - <<\'PY\'\nprint(\\"hello\\")\nPY"')).toBe("python3 - <<'PY'\nprint(\"hello\")\nPY");
    expect(displayCommand("/bin/bash -lc 'echo '\\''hello'\\'''" )).toBe("echo 'hello'");
    expect(displayCommand("/bin/sh -lc 'echo $HOME | cat'" )).toBe('echo $HOME | cat');
  });
  it('keeps nonliteral wrappers, additional arguments and compound commands intact', () => {
    for (const command of ['git status', '/bin/sh -lc "echo $HOME"', '/bin/sh -lc "`whoami`"', "/bin/sh -lc 'echo hi' extra", "/bin/sh -lc 'echo hi' > log", "/bin/sh -lc 'unterminated", '/bin/sh -lc echo;whoami']) {
      expect(displayCommand(command)).toBe(command);
    }
  });
});
