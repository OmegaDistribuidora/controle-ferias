import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";
import { formatDate } from "../services/date";

const initialForm = {
  name: "",
  code: "",
  jobTitle: "",
  companyId: "",
  hireDate: "",
};

export default function EmployeesPage() {
  const { token, user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [employeesPayload, companiesPayload] = await Promise.all([
        apiJson(`/employees?includeInactive=true&search=${encodeURIComponent(search)}`, { token }),
        apiJson("/companies", { token }),
      ]);
      setEmployees(employeesPayload.employees);
      setCompanies(companiesPayload.companies.filter((company) => company.active));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      await apiJson("/employees", {
        token,
        method: "POST",
        data: {
          ...form,
          companyId: Number(form.companyId),
        },
      });
      setForm(initialForm);
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(employee) {
    try {
      setError("");
      await apiJson(`/employees/${employee.id}`, {
        token,
        method: "PATCH",
        data: { active: !employee.active },
      });
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="eyebrow">Cadastros</div>
          <h1>Funcionarios</h1>
          <p>Cadastre colaboradores com empresa, codigo e data de admissao para gerar os periodos automaticamente.</p>
        </div>
        <div className="header-actions">
          <input
            className="search-input"
            placeholder="Buscar por nome ou codigo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="ghost-btn" onClick={loadData}>Buscar</button>
        </div>
      </div>

      <section className="panel split-panel">
        <div>
          <h2>Novo funcionario</h2>
          <form className="form-grid" onSubmit={handleCreate}>
            <label>
              Nome
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <label>
              Codigo
              <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
            </label>
            <label>
              Cargo
              <input
                value={form.jobTitle}
                onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
                required
              />
            </label>
            <label>
              Empresa
              <select
                value={form.companyId}
                onChange={(event) => setForm({ ...form, companyId: event.target.value })}
                required
              >
                <option value="">Selecione</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Data de admissao
              <input
                type="date"
                value={form.hireDate}
                onChange={(event) => setForm({ ...form, hireDate: event.target.value })}
                required
              />
            </label>
            <button className="primary-btn" type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Cadastrar"}
            </button>
          </form>
        </div>

        <div className="inline-filter">
          <p className="muted-text">Funcionarios inativos permanecem no final da lista para reativacao e consulta.</p>
          {user?.role !== "ADMIN" ? (
            <p className="muted-text">Somente o admin pode inativar ou reativar funcionarios.</p>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </section>

      <section className="panel">
        {loading ? <p>Carregando funcionarios...</p> : null}

        {!loading ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Codigo</th>
                  <th>Funcionario</th>
                  <th>Admissao</th>
                  <th>Periodos em aberto</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>{employee.companyName}</td>
                    <td>{employee.code}</td>
                    <td>{employee.name}</td>
                    <td>{formatDate(employee.hireDate)}</td>
                    <td>{employee.openPeriods}</td>
                    <td>
                      <span className={`badge ${employee.active ? "badge-success" : "badge-muted"}`}>
                        {employee.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="actions-cell">
                      <Link className="ghost-btn" to={`/funcionarios/${employee.id}`}>
                        Abrir
                      </Link>
                      {user?.role === "ADMIN" ? (
                        <button className="ghost-btn" onClick={() => handleToggleActive(employee)}>
                          {employee.active ? "Inativar" : "Reativar"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!employees.length ? (
                  <tr>
                    <td colSpan="7">Nenhum funcionario encontrado.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
