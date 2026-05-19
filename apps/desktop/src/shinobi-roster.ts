import { useEffect, useState } from "react";
import ninja01Url from "./assets/ninja-transparent-pngs/ninja-01.png";
import ninja02Url from "./assets/ninja-transparent-pngs/ninja-02.png";
import ninja03Url from "./assets/ninja-transparent-pngs/ninja-03.png";
import ninja04Url from "./assets/ninja-transparent-pngs/ninja-04.png";
import ninja05Url from "./assets/ninja-transparent-pngs/ninja-05.png";
import ninja06Url from "./assets/ninja-transparent-pngs/ninja-06.png";
import ninja07Url from "./assets/ninja-transparent-pngs/ninja-07.png";
import ninja08Url from "./assets/ninja-transparent-pngs/ninja-08.png";
import ninja09Url from "./assets/ninja-transparent-pngs/ninja-09.png";
import ninja10Url from "./assets/ninja-transparent-pngs/ninja-10.png";
import ninja11Url from "./assets/ninja-transparent-pngs/ninja-11.png";
import ninja12Url from "./assets/ninja-transparent-pngs/ninja-12.png";
import ninja13Url from "./assets/ninja-transparent-pngs/ninja-13.png";
import ninja14Url from "./assets/ninja-transparent-pngs/ninja-14.png";
import ninja15Url from "./assets/ninja-transparent-pngs/ninja-15.png";
import ninja16Url from "./assets/ninja-transparent-pngs/ninja-16.png";
import ninja17Url from "./assets/ninja-transparent-pngs/ninja-17.png";
import ninja18Url from "./assets/ninja-transparent-pngs/ninja-18.png";
import ninja19Url from "./assets/ninja-transparent-pngs/ninja-19.png";
import ninja20Url from "./assets/ninja-transparent-pngs/ninja-20.png";
import ninja21Url from "./assets/ninja-transparent-pngs/ninja-21.png";
import ninja22Url from "./assets/ninja-transparent-pngs/ninja-22.png";
import ninja23Url from "./assets/ninja-transparent-pngs/ninja-23.png";
import ninja24Url from "./assets/ninja-transparent-pngs/ninja-24.png";
import ninja25Url from "./assets/ninja-transparent-pngs/ninja-25.png";
import ninja26Url from "./assets/ninja-transparent-pngs/ninja-26.png";
import ninja27Url from "./assets/ninja-transparent-pngs/ninja-27.png";

export interface ShinobiOption {
  readonly id: string;
  readonly name: string;
  readonly meaning: string;
  readonly imageUrl: string;
}

export const SELECTED_SHINOBI_STORAGE_KEY = "pi-gui:selected-shinobi";
export const SELECTED_SHINOBI_CHANGED_EVENT = "pi-gui:selected-shinobi-changed";

export const SHINOBI_ROSTER: readonly ShinobiOption[] = [
  { id: "ninja-01", name: "Yumi no Tora", meaning: "Bow Tiger", imageUrl: ninja01Url },
  { id: "ninja-02", name: "Niten Kage", meaning: "Twin Blade Shadow", imageUrl: ninja02Url },
  { id: "ninja-03", name: "Yari no Mamori", meaning: "Spear Guardian", imageUrl: ninja03Url },
  { id: "ninja-04", name: "Kurojin", meaning: "Dark Blade", imageUrl: ninja04Url },
  { id: "ninja-05", name: "Oni Yoroi", meaning: "Demon Armor", imageUrl: ninja05Url },
  { id: "ninja-06", name: "Kasa no Shinobi", meaning: "Hat Shinobi", imageUrl: ninja06Url },
  { id: "ninja-07", name: "Tetsukabuto", meaning: "Iron Helm", imageUrl: ninja07Url },
  { id: "ninja-08", name: "Tsukihana", meaning: "Moon Blossom", imageUrl: ninja08Url },
  { id: "ninja-09", name: "Raikage", meaning: "Thunder Shadow", imageUrl: ninja09Url },
  { id: "ninja-10", name: "Kage-Taishō", meaning: "Shadow General", imageUrl: ninja10Url },
  { id: "ninja-11", name: "Shirokiba", meaning: "White Fang", imageUrl: ninja11Url },
  { id: "ninja-12", name: "Oborozuki", meaning: "Hazy Moon", imageUrl: ninja12Url },
  { id: "ninja-13", name: "Hien", meaning: "Flying Swallow", imageUrl: ninja13Url },
  { id: "ninja-14", name: "Kasumi", meaning: "Mist Veil", imageUrl: ninja14Url },
  { id: "ninja-15", name: "Ryūken", meaning: "Dragon Fist", imageUrl: ninja15Url },
  { id: "ninja-16", name: "Hotaru", meaning: "Firefly", imageUrl: ninja16Url },
  { id: "ninja-17", name: "Tsukikage", meaning: "Moon Shadow", imageUrl: ninja17Url },
  { id: "ninja-18", name: "Inazuma", meaning: "Lightning Strike", imageUrl: ninja18Url },
  { id: "ninja-19", name: "Sazanami", meaning: "Ripple Wave", imageUrl: ninja19Url },
  { id: "ninja-20", name: "Iwagane", meaning: "Stone Iron", imageUrl: ninja20Url },
  { id: "ninja-21", name: "Kurotaka", meaning: "Black Hawk", imageUrl: ninja21Url },
  { id: "ninja-22", name: "Kurogarasu", meaning: "Black Raven", imageUrl: ninja22Url },
  { id: "ninja-23", name: "Kitsunekage", meaning: "Fox Shadow", imageUrl: ninja23Url },
  { id: "ninja-24", name: "Utsusemi", meaning: "Empty Shell", imageUrl: ninja24Url },
  { id: "ninja-25", name: "Yukikiba", meaning: "Snow Fang", imageUrl: ninja25Url },
  { id: "ninja-26", name: "Kurogane", meaning: "Black Steel", imageUrl: ninja26Url },
  { id: "ninja-27", name: "Akaribi", meaning: "Signal Fire", imageUrl: ninja27Url },
];

export const DEFAULT_SHINOBI: ShinobiOption = SHINOBI_ROSTER[0] ?? {
  id: "ninja-01",
  name: "Yumi no Tora",
  meaning: "Bow Tiger",
  imageUrl: ninja01Url,
};

export function getShinobiById(id: string | null | undefined): ShinobiOption {
  return SHINOBI_ROSTER.find((option) => option.id === id) ?? DEFAULT_SHINOBI;
}

export function readSelectedShinobi(): ShinobiOption {
  if (typeof window === "undefined") {
    return DEFAULT_SHINOBI;
  }
  return getShinobiById(window.localStorage.getItem(SELECTED_SHINOBI_STORAGE_KEY));
}

export function writeSelectedShinobi(id: string): ShinobiOption {
  const shinobi = getShinobiById(id);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SELECTED_SHINOBI_STORAGE_KEY, shinobi.id);
    window.dispatchEvent(new CustomEvent(SELECTED_SHINOBI_CHANGED_EVENT, { detail: shinobi.id }));
  }
  return shinobi;
}

export function useSelectedShinobi(): readonly [ShinobiOption, (id: string) => void] {
  const [selected, setSelected] = useState<ShinobiOption>(() => readSelectedShinobi());

  useEffect(() => {
    const updateSelected = () => setSelected(readSelectedShinobi());
    const updateFromStorage = (event: StorageEvent) => {
      if (event.key === SELECTED_SHINOBI_STORAGE_KEY) {
        updateSelected();
      }
    };

    window.addEventListener(SELECTED_SHINOBI_CHANGED_EVENT, updateSelected);
    window.addEventListener("storage", updateFromStorage);
    return () => {
      window.removeEventListener(SELECTED_SHINOBI_CHANGED_EVENT, updateSelected);
      window.removeEventListener("storage", updateFromStorage);
    };
  }, []);

  const selectShinobi = (id: string) => {
    setSelected(writeSelectedShinobi(id));
  };

  return [selected, selectShinobi];
}
