import { describe, expect, it } from "vitest";
import { normalizeTaskMarkdown } from "../dashboard/src/task-detail-markdown";
import { renderMarkdownSource } from "../dashboard/src/markdown-source";

describe("legacy task detail Markdown", () => {
  it("recovers escaped paragraphs and ordered requirements from a stored prompt", () => {
    const source = String.raw`Background: simplify the header.\n\nRequirements:\n1. Keep the title.\n2. Keep the close button.`;
    const markdown = normalizeTaskMarkdown(source);
    expect(markdown).toBe("Background: simplify the header.\n\nRequirements:\n1. Keep the title.\n2. Keep the close button.");
    expect(renderMarkdownSource(markdown)).toContain("<ol>");
    expect(renderMarkdownSource(markdown)).toContain("<li>Keep the close button.</li>");
  });

  it("handles escaped CRLF and mixed real/escaped newlines", () => {
    expect(normalizeTaskMarkdown(String.raw`Intro.\r\n\r\n## Plan\r\n- First\r\n- Second`))
      .toBe("Intro.\n\n## Plan\n- First\n- Second");
    expect(normalizeTaskMarkdown("# Plan\n\n" + String.raw`- First\n- Second`))
      .toBe("# Plan\n\n- First\n- Second");
  });

  it("keeps real Markdown whitespace and intentional standalone escapes unchanged", () => {
    for (const source of ["First  \nSecond\n\n- One\n- Two", String.raw`Use \n to separate lines.`, String.raw`First\\n\\nSecond`]) {
      expect(normalizeTaskMarkdown(source)).toBe(source);
    }
  });

  it("preserves code, JSON strings and unquoted Windows/UNC paths beside legacy prose", () => {
    const protectedSource = [
      "Inline: `literal \\n\\n and \\\\n`.",
      '```json\n' + String.raw`{"text":"first\n\nsecond","root":"C:\\new\\notes"}` + '\n```',
      '~~~js\n' + String.raw`const separator = "\n\n";` + '\n~~~',
      String.raw`    const separator = "\n\n";`,
      String.raw`Paths: C:\new\notes and \\network\notes.`,
      String.raw`JSON: {"text":"first\n\nsecond"}`,
    ].join("\n\n");
    const source = String.raw`Intro.\n\n- First\n- Second` + "\n\n" + protectedSource;
    expect(normalizeTaskMarkdown(source)).toBe("Intro.\n\n- First\n- Second\n\n" + protectedSource);
  });

  it("keeps the existing safe parser responsible for HTML and unsafe links", () => {
    const rendered = renderMarkdownSource(normalizeTaskMarkdown(String.raw`Intro.\n\n- <script>alert(1)</script>\n- [unsafe](javascript:alert(1))`));
    expect(rendered).toContain("<ul>");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain('href="javascript:');
  });
});
