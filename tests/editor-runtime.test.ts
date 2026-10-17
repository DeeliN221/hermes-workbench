import { describe, expect, it } from 'vitest';
import { codeLanguage, fileLanguage } from '../dashboard/src/editor-runtime';

describe('code language coverage', () => {
  it('recognizes common programming language extensions', () => {
    for (const language of ['go', 'rs', 'c', 'cpp', 'java', 'sql', 'php', 'yaml', 'liquid']) {
      expect(codeLanguage(language), language).not.toBeNull();
    }
  });

  it('maps workspace filenames to syntax extensions', () => {
    expect(fileLanguage('main.go')).toHaveLength(1);
    expect(fileLanguage('config.yml')).toHaveLength(1);
    expect(fileLanguage('README.md')).toHaveLength(1);
  });
});
