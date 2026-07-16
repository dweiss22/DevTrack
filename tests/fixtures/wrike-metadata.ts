import type { WrikeCustomFieldsResponse, WrikeFolderTreeResponse } from "@/lib/wrike/types";

export const actualFolderTreeFixture: WrikeFolderTreeResponse = {
  kind: "folderTree",
  data: [
    {
      id: "IEACHQK7I46YBWEN",
      title: "02. Learning",
      childIds: [
        "IEACHQK7I4PGHBAC", "IEACHQK7I4PGSJEN", "IEACHQK7I4SCPAAB", "IEACHQK7I4PGHAIF",
        "IEACHQK7I4UOEPFL", "IEACHQK7I45QZU3G", "IEACHQK7I4PGHACI", "IEACHQK7I4N7GGQ4",
        "IEACHQK7I4O3GVSD", "IEACHQK7I4N7GGRB", "IEACHQK7I4N7GGRF", "IEACHQK7I4PGG7Z2",
        "IEACHQK7I4PGHAD7", "IEACHQK7I47ECDM5", "IEACHQK7I4SCO46Z", "IEACHQK7I4QUZOFS",
        "IEACHQK7I4N7GGRM"
      ],
      scope: "WsFolder"
    },
    {
      id: "IEACHQK7I47EB6XE",
      title: "2023 Courses",
      childIds: ["IEACHQK7I47EB7BR", "IEACHQK7I46XYZW6", "IEACHQK7I47EB66F", "IEACHQK7I47EB67N"],
      scope: "WsFolder",
      project: {
        authorId: "KUAQUUPD",
        ownerIds: [],
        status: "Custom",
        customStatusId: "IEACHQK7JMAAAAAA",
        createdDate: "2024-01-30T21:38:14Z"
      }
    }
  ]
};

export const actualCustomFieldsFixture: WrikeCustomFieldsResponse = {
  kind: "customfields",
  data: [{
    id: "IEACHQK7JUAHNWFH",
    accountId: "IEACHQK7",
    title: "LCT Reporting",
    type: "DropDown",
    spaceId: "IEACHQK7I4TVAKV7",
    sharedIds: [],
    sharing: {},
    settings: {
      inheritanceType: "All",
      applicableEntityTypes: ["WorkItem"],
      values: ["2024 Report", "2025 Report"],
      options: [{ value: "2024 Report", color: "Blue" }, { value: "2025 Report", color: "Purple" }],
      optionColorsEnabled: true,
      allowOtherValues: false,
      readOnly: false,
      allowTime: false
    },
    description: "Reporting field test for Learning Content",
    archived: false
  }]
};
