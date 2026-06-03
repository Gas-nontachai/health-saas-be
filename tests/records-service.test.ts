import { describe, expect, it, vi } from "vitest";
import type { AppPrisma } from "../src/infra/prisma.js";
import { updateUserRecord } from "../src/modules/health/blood-sugar/legacy-records.service.js";

describe("records service", () => {
  it("rejects updates when the record is not owned by the user", async () => {
    const prisma = {
      record: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn()
      }
    } as unknown as AppPrisma;

    await expect(updateUserRecord(prisma, "user-1", "record-1", { note: "x" })).rejects.toThrow("Record not found");
    expect(prisma.record.update).not.toHaveBeenCalled();
  });
});
