import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";

export default function CompaniesPage() {
  const { token } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function loadCompanies() {
    try {
      setError("");
      const payload = await apiJson("/companies", { token });
      setCompanies(payload.companies);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      setError("");
      await apiJson("/companies", {
        token,
        method: "POST",
        data: { name },
      });
      setName("");
      await loadCompanies();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleToggle(company) {
    try {
      setError("");
      await apiJson(`/companies/${company.id}`, {
        token,
        method: "PATCH",
        data: {
          name: company.name,
          active: !company.active,
        },
      });
      await loadCompanies();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="eyebrow">Administracao</div>
          <h1>Empresas</h1>
          <p>Cadastre as empresas disponiveis para associar aos colaboradores.</p>
        </div>
      </div>

      <section className="panel split-panel">
        <div>
          <h2>Nova empresa</h2>
          <form className="form-grid admin-inline-form" onSubmit={handleCreate}>
            <label>
              Nome da empresa
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <button className="primary-btn fit-btn" type="submit">
              Criar empresa
            </button>
          </form>
        </div>
        <div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.active ? "Ativa" : "Inativa"}</td>
                  <td>
                    <button className="ghost-btn" onClick={() => handleToggle(company)}>
                      {company.active ? "Inativar" : "Reativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
