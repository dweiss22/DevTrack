const pathSegment = (value: string) => encodeURIComponent(value);

export const wrikeEndpoints = {
  accountWorkflows: () => "/workflows",
  folderChildren: (folderId: string) => `/folders/${pathSegment(folderId)}/folders`,
  customFields: (title?: string) => title
    ? `/customfields?title=${pathSegment(title)}`
    : "/customfields",
  accountTimelogs: () => "/timelogs"
} as const;

/**
 * Named GET calls supplied for this application. Keep these paths relative to
 * WRIKE_API_BASE_URL so development and production can use different hosts.
 */
export const storedWrikeGetCalls = {
  accountWorkflows: {
    label: "Account workflows",
    method: "GET",
    path: wrikeEndpoints.accountWorkflows()
  },
  spaceFolders: {
    label: "Space folders",
    method: "GET",
    path: wrikeEndpoints.folderChildren("IEACHQK7I46YBWEN")
  },
  customFieldsList: {
    label: "Custom fields list ([LCT])",
    method: "GET",
    path: wrikeEndpoints.customFields("[LCT]")
  },
  accountTimelogs: {
    label: "Account timelogs",
    method: "GET",
    path: wrikeEndpoints.accountTimelogs()
  }
} as const;

export type StoredWrikeGetCallName = keyof typeof storedWrikeGetCalls;
