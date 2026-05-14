import { useMemo, type ReactNode } from "react";
import { MAX_HIGHLIGHTED_LINES, highlightLine, type HighlightLine } from "../syntax-highlight";
import type { ReviewDisplayLine } from "./review-types";

export function HighlightedReviewDiff({
  lines,
  language,
  selectedAnchorId,
  onSelectAnchor,
}: {
  readonly lines: readonly ReviewDisplayLine[];
  readonly language?: string;
  readonly selectedAnchorId?: string;
  readonly onSelectAnchor: (anchorId: string) => void;
}) {
  const highlightActive = language !== undefined && lines.length <= MAX_HIGHLIGHTED_LINES;

  return (
    <pre className="diff-inline review-mode__inline-diff" data-language={highlightActive ? language : undefined}>
      {lines.map((line) => (
        <button
          className={`diff-line diff-line--${line.kind} review-mode__line ${selectedAnchorId === line.anchorId ? "review-mode__line--selected" : ""}`}
          key={line.anchorId}
          type="button"
          onClick={() => onSelectAnchor(line.anchorId)}
        >
          <span className="review-mode__line-comment" aria-hidden="true">+</span>
          <span className="diff-line__number">{line.newLineNumber ?? line.oldLineNumber ?? ""}</span>
          <span className="diff-line__content">
            {highlightActive && line.kind !== "header" ? (
              <HighlightedContent content={line.content} language={language} />
            ) : (
              line.content
            )}
          </span>
        </button>
      ))}
    </pre>
  );
}

function HighlightedContent({ content, language }: { readonly content: string; readonly language: string }) {
  const tokens = useMemo(() => highlightLine(content, language), [content, language]);
  return <>{renderTokens(tokens)}</>;
}

function renderTokens(tokens: HighlightLine): ReactNode {
  return tokens.map((token, index) =>
    typeof token === "string" ? (
      token
    ) : (
      <span className={token.className} key={index}>
        {renderTokens(token.children)}
      </span>
    ),
  );
}
