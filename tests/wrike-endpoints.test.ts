import { describe, expect, it } from "vitest";
import { storedWrikeGetCalls, wrikeEndpoints } from "@/lib/wrike/endpoints";

describe("stored Wrike GET calls", () => {
  it("stores the supplied application calls as API-relative paths", () => {
    expect(storedWrikeGetCalls.accountWorkflows.path).toBe("/workflows");
    expect(storedWrikeGetCalls.spaceFolders.path).toBe("/folders/IEACHQK7I46YBWEN/folders");
    expect(storedWrikeGetCalls.customFieldsList.path).toBe("/customfields?title=%5BLCT%5D");
    expect(storedWrikeGetCalls.accountTimelogs.path).toBe("/timelogs");
  });

  it("encodes dynamic path and query values", () => {
    expect(wrikeEndpoints.folderChildren("folder/one")).toBe("/folders/folder%2Fone/folders");
    expect(wrikeEndpoints.customFields("[LCT] & Review")).toBe("/customfields?title=%5BLCT%5D%20%26%20Review");
  });
});
