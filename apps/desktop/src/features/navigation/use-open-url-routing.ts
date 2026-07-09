import { useCallback, useEffect } from "react";
import type { RefObject } from "react";
import type { AppView } from "../../desktop-state";

interface UseOpenUrlRoutingOptions {
  readonly api: typeof window.piApp;
  readonly activeView: AppView | undefined;
  readonly mainRef: RefObject<HTMLElement | null>;
  readonly openSideBrowserUrl: (url: string) => void;
}

export function useOpenUrlRouting({
  api,
  activeView,
  mainRef,
  openSideBrowserUrl,
}: UseOpenUrlRoutingOptions) {
  const openUrl = useCallback((url: string, options?: { readonly external?: boolean }) => {
    if (!api) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (options?.external || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      void api.openExternal(parsed.toString());
      return;
    }
    openSideBrowserUrl(parsed.toString());
  }, [api, openSideBrowserUrl]);

  useEffect(() => {
    const handleDocumentLinkClick = (event: MouseEvent) => {
      if (activeView !== "threads") return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!mainRef.current?.contains(anchor)) return;
      event.preventDefault();
      openUrl(anchor.href);
    };
    document.addEventListener("click", handleDocumentLinkClick, true);
    return () => document.removeEventListener("click", handleDocumentLinkClick, true);
  }, [activeView, mainRef, openUrl]);

  return openUrl;
}
