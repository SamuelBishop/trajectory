/**
 * The briefing's prose.
 *
 * Implements: [HC-RENDERER-LEAST-PRIVILEGE]
 *
 * `rehype-raw` is deliberately absent: raw HTML stays escaped and inert. Links
 * open in the browser rather than navigating this window, which the main
 * process refuses to allow in any case.
 */

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Prose({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <div className="prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
