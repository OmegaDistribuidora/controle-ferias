const express = require("express");
const bcrypt = require("bcryptjs");
const { Role } = require("@prisma/client");
const { z } = require("zod");

const prisma = require("../db");
const { authRequired, requireRole } = require("../middleware");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

const createUserSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(6),
  role: z.nativeEnum(Role).default(Role.RH),
});

const updateUserSchema = z.object({
  password: z.string().min(6).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
});

router.use(authRequired, requireRole(Role.ADMIN));

router.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  return res.json({ users });
});

router.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados do usuario invalidos." });
  }

  const username = parsed.data.username.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    return res.status(409).json({ message: "Ja existe um usuario com esse login." });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: parsed.data.role,
    },
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "CREATE_USER",
    entityType: "USER",
    entityId: user.id,
    description: `Criou o usuario ${user.username} com perfil ${user.role}.`,
  });

  return res.status(201).json({ user });
});

router.patch("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados para atualizacao invalidos." });
  }

  const userId = Number(req.params.id);
  const data = {};

  if (parsed.data.password) {
    data.passwordHash = await bcrypt.hash(parsed.data.password, 10);
  }

  if (parsed.data.role) {
    data.role = parsed.data.role;
  }

  if (typeof parsed.data.active === "boolean") {
    data.active = parsed.data.active;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  const actionParts = [];
  if (parsed.data.password) actionParts.push("senha");
  if (parsed.data.role) actionParts.push(`perfil ${user.role}`);
  if (typeof parsed.data.active === "boolean") {
    actionParts.push(user.active ? "reativacao" : "inativacao");
  }

  await writeAuditLog(prisma, {
    user: req.user,
    action: "UPDATE_USER",
    entityType: "USER",
    entityId: user.id,
    description: `Atualizou o usuario ${user.username}${actionParts.length ? ` (${actionParts.join(", ")})` : ""}.`,
  });

  return res.json({ user });
});

module.exports = router;
