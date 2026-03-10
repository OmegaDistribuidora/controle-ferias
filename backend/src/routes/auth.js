const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const prisma = require("../db");
const { jwtSecret } = require("../config");
const { authRequired } = require("../middleware");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Usuario e senha sao obrigatorios." });
  }

  const username = parsed.data.username.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.active) {
    return res.status(401).json({ message: "Credenciais invalidas." });
  }

  const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ message: "Credenciais invalidas." });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    jwtSecret,
    { expiresIn: "12h" }
  );

  await writeAuditLog(prisma, {
    user: {
      id: user.id,
      username: user.username,
    },
    action: "LOGIN",
    entityType: "AUTH",
    entityId: user.id,
    description: `Usuario ${user.username} realizou login no sistema.`,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
    },
  });
});

router.get("/me", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  if (!user || !user.active) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }

  return res.json({ user });
});

module.exports = router;
