import type { Options } from 'micromark';

type Extension = NonNullable<Options['extensions']>[number];

/** Interpret standalone Hermes memory delimiters as thematic breaks at parse time.
 * Code blocks, inline code, and section signs within prose remain literal.
 */
export const memorySectionExtension: Extension = {
  flow: {
    167: {
      name: 'memorySection',
      tokenize(effects, ok, nok) {
        return start;
        function start(code: number | null): ReturnType<typeof ok> {
          if (code !== 167) return nok(code);
          effects.enter('thematicBreak');
          effects.consume(code);
          return end;
        }
        function end(code: number | null): ReturnType<typeof ok> {
          if (code === 32 || code === -1 || code === -2) {
            effects.consume(code);
            return end;
          }
          if (code === null || code === -3 || code === -4 || code === -5) {
            effects.exit('thematicBreak');
            return ok(code);
          }
          return nok(code);
        }
      },
    },
  },
};
