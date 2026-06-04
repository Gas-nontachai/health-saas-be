import { describe, expect, it, vi } from "vitest";
import type { AppPrisma } from "../src/infra/prisma.js";
import { hashPassword, verifyPassword } from "../src/modules/identity/auth/passwords.js";
import { bootstrapAdminUser } from "../src/modules/identity/rbac/admin-bootstrap.js";
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
    expect(prisma.permission.upsert).toHaveBeenCalledWith({
      where: { code: "backups.create.system" },
      update: expect.objectContaining({ category: "backups" }),
      create: expect.objectContaining({ code: "backups.create.system" })
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

  it("resets existing bootstrap admin password to the configured env password", async () => {
    const oldPasswordHash = await hashPassword("old-password");
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-1",
          email: "admin@test.com",
          passwordHash: oldPasswordHash
        }),
        update: vi.fn().mockImplementation(async ({ data }) => ({
          id: "admin-1",
          email: "admin@test.com",
          ...data
        }))
      },
      role: {
        findUnique: vi.fn().mockResolvedValue({ id: "role-Admin" })
      },
      userRole: {
        upsert: vi.fn()
      }
    } as unknown as AppPrisma;

    const result = await bootstrapAdminUser({
      prisma,
      email: "ADMIN@test.com",
      password: "admin1234",
      resetExistingPassword: true
    });
    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0];
    const updatedPasswordHash = updateCall.data.passwordHash;

    expect(result).toEqual({ email: "admin@test.com", createdUser: false, resetPassword: true });
    expect(typeof updatedPasswordHash).toBe("string");
    if (typeof updatedPasswordHash !== "string") throw new Error("Expected bootstrap admin passwordHash to be a string");
    expect(await verifyPassword("admin1234", updatedPasswordHash)).toBe(true);
    expect(await verifyPassword("old-password", updatedPasswordHash)).toBe(false);
    expect(updateCall.data).toEqual(expect.objectContaining({
      passwordChangeRequired: false,
      passwordChangedAt: expect.any(Date)
    }));
  });
});
