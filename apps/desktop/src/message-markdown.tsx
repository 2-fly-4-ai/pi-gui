import { memo, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

export interface MessageMarkdownProps {
  readonly text: string;
  readonly onOpenUrl?: (url: string) => void;
  readonly onOpenFile?: (path: string) => void;
}

export const MessageMarkdown = memo(function MessageMarkdown({ text, onOpenFile, onOpenUrl }: MessageMarkdownProps) {
  const openLinkFromEvent = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onOpenUrl || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    onOpenUrl(anchor.href);
  }, [onOpenUrl]);

  const components = useMemo(() => ({
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const language = className?.replace(/^language-/, "");
      const code = String(children).replace(/\n$/, "");
      if (!className) {
        const filePath = safeFileReference(code);
        return (
          <>
            <code>{code}</code>
            {filePath && onOpenFile ? (
              <button className="message__inline-file-action" type="button" onClick={() => onOpenFile(withoutLineSuffix(filePath))}>
                Open
              </button>
            ) : null}
          </>
        );
      }
      const shell = language === "sh" || language === "shell" || language === "bash" || language === "zsh";
      const filePath = safeFileReference(code);
      return (
        <pre data-language={language}>
          <span className="message__code-actions">
            {filePath && onOpenFile ? (
              <button type="button" onClick={() => onOpenFile(withoutLineSuffix(filePath))}>Open</button>
            ) : null}
            <button
              aria-label="Copy code block"
              type="button"
              onClick={() => void navigator.clipboard.writeText(code)}
            >
              Copy
            </button>
            {shell ? (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("pi-gui:preview-shell-snippet", { detail: code }))}
              >
                Preview Run
              </button>
            ) : null}
          </span>
          <code className={className}>{code}</code>
        </pre>
      );
    },
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    ),
  }), [onOpenFile]);

  return (
    <div className="message__content" onClickCapture={openLinkFromEvent}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

function safeFileReference(value: string): string | undefined {
  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.length > 500
    || /[\r\n\0]/.test(trimmed)
    || /^(?:https?:|file:|\/|~\/)/i.test(trimmed)
    || trimmed.includes("..")
    || !/^[\w@.+-]+(?:\/[\w@.+ -]+)+(?::\d+(?::\d+)?)?$/.test(trimmed)
  ) return undefined;
  return trimmed;
}

function withoutLineSuffix(value: string): string {
  return value.replace(/:\d+(?::\d+)?$/, "");
}
