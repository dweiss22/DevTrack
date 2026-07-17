export const SELECTED_WRIKE_FOLDERS = [
  { id: "IEACHQK7I4UOEPFL", title: "Cordico [New]" },
  { id: "IEACHQK7I4PGHAIF", title: "Custody [Maint]" },
  { id: "IEACHQK7I4QUZOFS", title: "Custody [New]" },
  { id: "IEACHQK7I45QZU3G", title: "Dispatch [New]" },
  { id: "IEACHQK7I4PGHAD7", title: "EMS [Maint]" },
  { id: "IEACHQK7I4SCO46Z", title: "EMS [New]" },
  { id: "IEACHQK7I4PGHBAC", title: "Fire [Maint]" },
  { id: "IEACHQK7I4N7GGRM", title: "Fire [New]" },
  { id: "IEACHQK7I4PGHACI", title: "Law Enforcement [Maint]" },
  { id: "IEACHQK7I4N7GGQ4", title: "Law Enforcement [New]" },
  { id: "IEACHQK7I4PGG7Z2", title: "Local Gov [Maint]" },
  { id: "IEACHQK7I4SCPAAB", title: "Local Gov [New]" },
  { id: "IEACHQK7I4N7GGRB", title: "Non-Vertical Content Projects [Maint]" }
] as const;

export type SelectedWrikeFolder = (typeof SELECTED_WRIKE_FOLDERS)[number];
export const SELECTED_WRIKE_FOLDER_IDS = SELECTED_WRIKE_FOLDERS.map((folder) => folder.id);
export const SELECTED_WRIKE_FOLDER_BY_ID = new Map<string, SelectedWrikeFolder>(SELECTED_WRIKE_FOLDERS.map((folder) => [folder.id, folder]));
