import { useMemo } from "react";
import type { DesktopAppState } from "../../desktop-state";
import { buildOpenTerminalTargets } from "../panels/use-panel-layout";

interface UseVisibleTerminalOptions {
  readonly activeTerminalSessionKey: string;
  readonly openTerminalSessionKeys: ReadonlySet<string>;
  readonly selectedSessionKey: string;
  readonly snapshot: DesktopAppState | null;
  readonly takeoverTerminalSessionKeys: ReadonlySet<string>;
}

export function useVisibleTerminal({
  activeTerminalSessionKey,
  openTerminalSessionKeys,
  selectedSessionKey,
  snapshot,
  takeoverTerminalSessionKeys,
}: UseVisibleTerminalOptions) {
  const isTerminalVisibleForSelectedThread = Boolean(selectedSessionKey) && openTerminalSessionKeys.has(selectedSessionKey);
  const openTerminalTargets = useMemo(
    () => buildOpenTerminalTargets(openTerminalSessionKeys, snapshot),
    [openTerminalSessionKeys, snapshot],
  );
  const visibleTerminalKey = openTerminalSessionKeys.has(activeTerminalSessionKey)
    ? activeTerminalSessionKey
    : isTerminalVisibleForSelectedThread
      ? selectedSessionKey
      : openTerminalTargets[0]?.key ?? "";
  const visibleTerminalTarget = openTerminalTargets.find((target) => target.key === visibleTerminalKey);
  const isTerminalVisible = Boolean(visibleTerminalTarget);
  const isVisibleTerminalTakeover = Boolean(visibleTerminalKey) && takeoverTerminalSessionKeys.has(visibleTerminalKey);

  return {
    isTerminalVisible,
    isVisibleTerminalTakeover,
    openTerminalTargets,
    visibleTerminalKey,
    visibleTerminalTarget,
  };
}
