export type DisplayModeFilter = "all" | "running" | "waiting" | "error";
export type DrawerTab = "preview" | "logs" | "files";
export type ColumnMode = number | "auto";

export interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}
