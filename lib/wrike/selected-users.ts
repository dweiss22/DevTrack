export const SELECTED_WRIKE_USERS = [
  { wrikeUserId: "KUALR6DZ", expectedName: "Devin Weiss" },
  { wrikeUserId: "KUANTWID", expectedName: "Koço Budo" },
  { wrikeUserId: "KUAPO5G4", expectedName: "Greg Rogers" },
  { wrikeUserId: "KUAOGSL5", expectedName: "Natalie Nelson" },
  { wrikeUserId: "KUATPQK3", expectedName: "Melissa Maurath" },
  { wrikeUserId: "KUAFESPT", expectedName: "Jon Dorman" },
  { wrikeUserId: "KUAOG6C6", expectedName: "Katie Willis" },
  { wrikeUserId: "KUAMLCDM", expectedName: "Rachel Frost" },
  { wrikeUserId: "KUAE45X3", expectedName: "Meena Kishnani" },
  { wrikeUserId: "KUAKTTA2", expectedName: "Emlyn Storrs" },
  { wrikeUserId: "KUAQCO2V", expectedName: "Mallory Lozoya" },
  { wrikeUserId: "KUAQCQMG", expectedName: "Jeffrey Dino" },
  { wrikeUserId: "KUAG3N3I", expectedName: "Lawson Coke" }
] as const;

export type SelectedWrikeUser = (typeof SELECTED_WRIKE_USERS)[number];
export const SELECTED_WRIKE_USER_BY_ID = new Map<string, SelectedWrikeUser>(SELECTED_WRIKE_USERS.map((user) => [user.wrikeUserId, user]));
export const SELECTED_WRIKE_USER_IDS = SELECTED_WRIKE_USERS.map((user) => user.wrikeUserId);
