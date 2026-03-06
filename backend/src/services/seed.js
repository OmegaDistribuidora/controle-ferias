const bcrypt = require("bcryptjs");
const { Role } = require("@prisma/client");
const prisma = require("../db");

async function ensureDefaultUsers() {
  const username = "admin";
  const password = process.env.SEED_ADMIN_PASSWORD || "Omega@123";
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) return;

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: Role.ADMIN,
    },
  });
}

module.exports = {
  ensureDefaultUsers,
};
