import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

export interface MessageMarkdownProps {
  readonly text: string;
  readonly onOpenUrl?: (url: string) => void;
}

export const MessageMarkdown = memo(function MessageMarkdown({ text, onOpenUrl }: MessageMarkdownProps) {
  const components = useMemo(() => ({
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const language = className?.replace(/^language-/, "");
      const code = String(children).replace(/\n$/, "");
      if (!className) {
        return <code>{code}</code>;
      }
      return (
        <pre data-language={language}>
          <button
            aria-label="Copy code block"
            className="message__code-copy"
            type="button"
            onClick={() => void navigator.clipboard.writeText(code)}
          >
            Copy
          </button>
          <code className={className}>{code}</code>
        </pre>
      );
    },
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={href}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => {
          if (!href || !onOpenUrl) return;
          event.preventDefault();
          onOpenUrl(href);
        }}
      >
        {children}
      </a>
    ),
  }), [onOpenUrl]);

  return (
    <div className="message__content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
