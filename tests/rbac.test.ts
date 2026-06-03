import { describe, expect, it, vi } from "vitest";
import type { AppPrisma } from "../src/infra/prisma.js";
import { PERMISSIONS, PERMISSION_CODES } from "../src/modules/identity/rbac/permissions.js";
import { bootstrapInitialAdmin, syncPermissions } from "../src/modules/identity/rbac/sync.js";

function mockPrisma(): AppPrisma {
  return {
    permission: {
      upsert: vi.fn(),
      findMany: vi.fn().mockImplementation(({ where }: { where: { code: { in: string[] } } }) => {
        return Promise.resolve(where.code.in.map((code) => ({ id: `permission-${code}` })));
      })
    },
    role: {
      upsert: vi.fn().mockImplementation(({ where }: { where: { name: string } }) => {
        return Promise.resolve({ id: `role-${where.name}`, name: where.name });
      }),
      findUnique: vi.fn().mockResolvedValue({ id: "role-Admin" })
    },
    rolePermission: {
      deleteMany: vi.fn(),
      createMany: vi.fn()
    },
    userRole: {
      upsert: vi.fn()
    }
  } as unknown as AppPrisma;
}

describe("rbac sync", () => {
  it("syncs permission catalog and grants all permissions to Admin only by script policy", async () => {
    const prisma = mockPrisma();

    const result = await syncPermissions(prisma);

    expect(result.permissions).toBe(PERMISSIONS.length);
    expect(prisma.permission.upsert).toHaveBeenCalledWith({
      where: { code: "weights.read.self" },
      update: expect.objectContaining({ category: "weights" }),
      create: expect.objectContaining({ code: "weights.read.self" })
    });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: PERMISSION_CODES.map((code) => ({
        roleId: "role-Admin",
        permissionId: `permission-${code}`
      })),
      skipDuplicates: true
    });
  });

  it("bootstraps initial admin by email", async () => {
    const prisma = mockPrisma();

    await bootstrapInitialAdmin(prisma, "user-1", "Admin@Example.com", "admin@example.com");

    expect(prisma.userRole.upsert).toHaveBeenCalledWith({
      where: { userId_roleId: { userId: "user-1", roleId: "role-Admin" } },
      update: {},
      create: { userId: "user-1", roleId: "role-Admin" }
    });
  });
});
