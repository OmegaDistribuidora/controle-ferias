const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");

const prisma = require("./db");
const { port, nodeEnv } = require("./config");
const { ensureDefaultUsers } = require("./services/seed");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const companyRoutes = require("./routes/companies");
const employeeRoutes = require("./routes/employees");
const dashboardRoutes = require("./routes/dashboard");
const auditRoutes = require("./routes/audit");

const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(__dirname, "..", "..", ".env"),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/audit", auditRoutes);

const frontendDistPath = path.resolve(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

app.use((error, req, res, next) => {
  return res.status(500).json({ message: error.message || "Erro interno no servidor." });
});

async function bootstrap() {
  try {
    await prisma.$connect();
    await ensureDefaultUsers();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Servidor rodando na porta ${port} (${nodeEnv})`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Falha ao iniciar aplicacao:", error.message);
    process.exit(1);
  }
}

bootstrap();
