import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

describe("assistant Markdown", () => {
  it("renders GFM structure while leaving raw HTML inert", () => {
    const source =
      "**Strong**\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n" +
      '<img src=x onerror="globalThis.compromised=true">';
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: [remarkGfm], children: source }),
    );

    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('onerror="');
  });
});
