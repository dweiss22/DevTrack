import { describe, expect, it } from "vitest";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";

describe("application user display", () => {
  it("prefers the organization profile display name", () => {
    expect(applicationUserDisplayName(" Ada Lovelace ", {
      email: "ada@example.com",
      user_metadata: { full_name: "Different Name" },
    })).toBe("Ada Lovelace");
  });

  it("uses authentication profile names when the organization profile has no name", () => {
    expect(applicationUserDisplayName(null, {
      email: "grace@example.com",
      user_metadata: { full_name: " Grace Hopper " },
    })).toBe("Grace Hopper");
    expect(applicationUserDisplayName("", { user_metadata: { name: "Katherine Johnson" } })).toBe("Katherine Johnson");
    expect(applicationUserDisplayName(null, { user_metadata: { display_name: "Dorothy Vaughan" } })).toBe("Dorothy Vaughan");
  });

  it("uses email or a readable placeholder instead of exposing the authentication id", () => {
    expect(applicationUserDisplayName(null, { email: "user@example.com" })).toBe("user@example.com");
    expect(applicationUserDisplayName(null)).toBe("Unnamed user");
    expect(applicationUserEmail({ email: " user@example.com " })).toBe("user@example.com");
    expect(applicationUserEmail()).toBe("Not available");
  });
});
