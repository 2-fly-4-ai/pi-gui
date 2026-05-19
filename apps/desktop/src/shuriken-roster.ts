import { useEffect, useState } from "react";
import shuriken01Url from "./assets/shurikens-pngs/01-four-point-shuriken.png";
import shuriken02Url from "./assets/shurikens-pngs/02-five-point-shuriken.png";
import shuriken03Url from "./assets/shurikens-pngs/03-arrow-tip-shuriken.png";
import shuriken04Url from "./assets/shurikens-pngs/04-eight-point-shuriken.png";
import shuriken05Url from "./assets/shurikens-pngs/05-curved-windmill-shuriken.png";
import shuriken06Url from "./assets/shurikens-pngs/06-notched-square-shuriken.png";
import shuriken07Url from "./assets/shurikens-pngs/07-compass-ring-shuriken.png";
import shuriken08Url from "./assets/shurikens-pngs/08-four-notch-square-shuriken.png";
import shuriken09Url from "./assets/shurikens-pngs/09-multi-hole-starburst-shuriken.png";
import shuriken10Url from "./assets/shurikens-pngs/10-three-blade-shuriken.png";
import shuriken11Url from "./assets/shurikens-pngs/11-diamond-center-shuriken.png";
import shuriken12Url from "./assets/shurikens-pngs/12-gate-frame-shuriken.png";

export interface ShurikenOption {
  readonly id: string;
  readonly name: string;
  readonly meaning: string;
  readonly imageUrl: string;
}

export const SELECTED_SHURIKEN_STORAGE_KEY = "pi-gui:selected-shuriken";
export const SELECTED_SHURIKEN_CHANGED_EVENT = "pi-gui:selected-shuriken-changed";

export const SHURIKEN_ROSTER: readonly ShurikenOption[] = [
  { id: "shuriken-01", name: "Four Point", meaning: "Classic balanced star", imageUrl: shuriken01Url },
  { id: "shuriken-02", name: "Five Point", meaning: "Sharp radial flow", imageUrl: shuriken02Url },
  { id: "shuriken-03", name: "Arrow Tip", meaning: "Fast directional strike", imageUrl: shuriken03Url },
  { id: "shuriken-04", name: "Eight Point", meaning: "Dense precision edge", imageUrl: shuriken04Url },
  { id: "shuriken-05", name: "Windmill", meaning: "Curved spinning blade", imageUrl: shuriken05Url },
  { id: "shuriken-06", name: "Notched Square", meaning: "Heavy armored star", imageUrl: shuriken06Url },
  { id: "shuriken-07", name: "Compass Ring", meaning: "Guided circular focus", imageUrl: shuriken07Url },
  { id: "shuriken-08", name: "Four Notch", meaning: "Square-cut momentum", imageUrl: shuriken08Url },
  { id: "shuriken-09", name: "Starburst", meaning: "Multi-hole impact", imageUrl: shuriken09Url },
  { id: "shuriken-10", name: "Three Blade", meaning: "Minimal cyclone", imageUrl: shuriken10Url },
  { id: "shuriken-11", name: "Diamond Center", meaning: "Focused core spin", imageUrl: shuriken11Url },
  { id: "shuriken-12", name: "Gate Frame", meaning: "Open-frame blade", imageUrl: shuriken12Url },
];

export const DEFAULT_SHURIKEN: ShurikenOption = SHURIKEN_ROSTER[0] ?? {
  id: "shuriken-01",
  name: "Four Point",
  meaning: "Classic balanced star",
  imageUrl: shuriken01Url,
};

export function getShurikenById(id: string | null | undefined): ShurikenOption {
  return SHURIKEN_ROSTER.find((option) => option.id === id) ?? DEFAULT_SHURIKEN;
}

export function readSelectedShuriken(): ShurikenOption {
  if (typeof window === "undefined") {
    return DEFAULT_SHURIKEN;
  }
  return getShurikenById(window.localStorage.getItem(SELECTED_SHURIKEN_STORAGE_KEY));
}

export function writeSelectedShuriken(id: string): ShurikenOption {
  const shuriken = getShurikenById(id);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SELECTED_SHURIKEN_STORAGE_KEY, shuriken.id);
    window.dispatchEvent(new CustomEvent(SELECTED_SHURIKEN_CHANGED_EVENT, { detail: shuriken.id }));
  }
  return shuriken;
}

export function useSelectedShuriken(): readonly [ShurikenOption, (id: string) => void] {
  const [selected, setSelected] = useState<ShurikenOption>(() => readSelectedShuriken());

  useEffect(() => {
    const updateSelected = () => setSelected(readSelectedShuriken());
    const updateFromStorage = (event: StorageEvent) => {
      if (event.key === SELECTED_SHURIKEN_STORAGE_KEY) {
        updateSelected();
      }
    };

    window.addEventListener(SELECTED_SHURIKEN_CHANGED_EVENT, updateSelected);
    window.addEventListener("storage", updateFromStorage);
    return () => {
      window.removeEventListener(SELECTED_SHURIKEN_CHANGED_EVENT, updateSelected);
      window.removeEventListener("storage", updateFromStorage);
    };
  }, []);

  const selectShuriken = (id: string) => {
    setSelected(writeSelectedShuriken(id));
  };

  return [selected, selectShuriken];
}
