const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const prisma = require("../db");
const { jwtSecret, ecosystemSso } = require("../config");
const { authRequired } = require("../middleware");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();
const consumedSsoTokens = new Map();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const ssoExchangeSchema = z.object({
  token: z.string().min(1),
});

function issueLocalToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

function cleanupConsumedSsoTokens() {
  const now = Date.now();
  for (const [jti, expiresAt] of consumedSsoTokens.entries()) {
    if (expiresAt <= now) {
      consumedSsoTokens.delete(jti);
    }
  }
}

function markConsumedSsoToken(jti, exp) {
  if (!jti || typeof exp !== "number") {
    return;
  }

  cleanupConsumedSsoTokens();
  consumedSsoTokens.set(jti, exp * 1000);
}

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

  const token = issueLocalToken(user);

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

router.post("/sso/exchange", async (req, res) => {
  if (!ecosystemSso.sharedSecret) {
    return res.status(404).json({ message: "Login delegado indisponivel." });
  }

  const parsed = ssoExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Token SSO obrigatorio." });
  }

  let payload;
  try {
    payload = jwt.verify(parsed.data.token, ecosystemSso.sharedSecret, {
      algorithms: ["HS256"],
      issuer: ecosystemSso.issuer,
      audience: ecosystemSso.audience,
    });
  } catch (error) {
    return res.status(401).json({ message: "Token SSO invalido ou expirado." });
  }

  if (payload?.jti && consumedSsoTokens.has(payload.jti)) {
    return res.status(401).json({ message: "Token SSO ja utilizado." });
  }

  const targetLogin = String(payload?.targetLogin || "").trim().toLowerCase();
  if (!targetLogin) {
    return res.status(400).json({ message: "Token SSO sem login de destino." });
  }

  const user = await prisma.user.findUnique({ where: { username: targetLogin } });
  if (!user || !user.active) {
    return res.status(401).json({ message: "Usuario alvo nao encontrado ou inativo." });
  }

  const ecosystemIsAdmin = payload?.ecosystemIsAdmin === true;
  if (user.role === "ADMIN" && !ecosystemIsAdmin) {
    return res.status(403).json({ message: "Usuario do Ecossistema nao pode acessar administrador via SSO." });
  }

  markConsumedSsoToken(payload?.jti, payload?.exp);

  const token = issueLocalToken(user);

  await writeAuditLog(prisma, {
    user: {
      id: user.id,
      username: user.username,
    },
    action: "SSO_LOGIN",
    entityType: "AUTH",
    entityId: user.id,
    description: `Usuario ${user.username} realizou login via Ecossistema Omega.`,
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
