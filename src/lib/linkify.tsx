import type { ReactNode } from "react";

// Matches http(s) URLs. Stops at whitespace; trailing punctuation that's
// commonly adjacent to a URL in prose (.,;:!?) and a single closing bracket
// is trimmed back into the text so "see https://x.com." doesn't link the dot.
//
// NOTE: URLs that legitimately end in a closing bracket (e.g. Wikipedia's
// `/wiki/Foo_(bar)`) lose that bracket from the href. Revisit with paren-
// balancing if such links start appearing in real descriptions.
const URL_RE = /https?:\/\/[^\s<]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;

export function linkifyText(input: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of input.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    let trailing = "";

    const punct = TRAILING_PUNCT_RE.exec(url);
    if (punct) {
      trailing = punct[0];
      url = url.slice(0, -trailing.length);
    }

    if (start > lastIndex) {
      nodes.push(input.slice(lastIndex, start));
    }
    nodes.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < input.length) {
    nodes.push(input.slice(lastIndex));
  }
  return nodes;
}
