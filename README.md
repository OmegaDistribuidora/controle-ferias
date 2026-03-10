# Controle de Ferias

Sistema de controle de ferias para RH, com frontend em React/Vite, backend em Express e banco PostgreSQL via Prisma.

## Recursos implementados

- Autenticacao com usuario administrador inicial configurado no sistema
- Cadastro de empresas e usuarios por admin
- Cadastro de funcionarios com calculo automatico dos periodos aquisitivo, concessivo e data de vencimento
- Dashboard em formato de planilha exibindo apenas periodos pendentes
- Controle de blocos de ferias por periodo, com saldo restante
- Marcacao manual de "ferias concedidas" sem obrigatoriedade de informar datas
- Inativacao de funcionarios pelo admin, removendo-os dos paineis
- Estrutura pronta para deploy no Railway com PostgreSQL

## Executar localmente

1. Crie um banco PostgreSQL local.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL`.
3. Instale dependencias:

```bash
npm install
```

4. Gere o client Prisma e aplique o schema:

```bash
npm run prisma:generate
npm run prisma:push
```

5. Inicie o ambiente local:

```bash
npm run dev
```

Backend: `http://localhost:3000`
Frontend: `http://localhost:5173`

## Railway

- Configure `DATABASE_URL` e `JWT_SECRET`
- Para login delegado vindo do Ecossistema, configure `ECOSYSTEM_SSO_ISSUER`, `ECOSYSTEM_SSO_AUDIENCE` e `ECOSYSTEM_SSO_SHARED_SECRET`
- O `railway.toml` ja executa `prisma db push` antes de subir a API
