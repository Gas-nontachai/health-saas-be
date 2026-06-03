import { describe, expect, it } from "vitest";
import { getSharedLinkDataTypes, serializeSharedLink } from "../src/modules/health/shared-links/serializer.js";

describe("shared link serializer", () => {
  it("serializes active links with public paths and normalized data types", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(serializeSharedLink({ id: "link-1", publicToken: "token-1", dataStartAt: now, dataEndAt: now, expiresAt: new Date("2026-06-02T00:00:00.000Z"), revokedAt: null, createdAt: now, dataTypes: ["weight"] }, now)).toMatchObject({
      id: "link-1",
      publicPath: "/shared/token-1",
      status: "active",
      dataTypes: ["weight"]
    });
  });

  it("defaults invalid data types to blood sugar", () => {
    expect(getSharedLinkDataTypes(["nope"])).toEqual(["bloodSugar"]);
  });
});
