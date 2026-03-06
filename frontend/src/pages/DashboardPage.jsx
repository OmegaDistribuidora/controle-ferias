import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, ListChecks, Users } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";
import { formatDate, formatPeriod } from "../services/date";

const urgencyLabels = {
  NORMAL: "",
  DUE_5: "risk-5",
  DUE_4: "risk-4",
  DUE_3: "risk-3",
  DUE_2: "risk-2",
  OVERDUE: "risk-overdue",
};

export default function DashboardPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    employees: 0,
    periodsOpen: 0,
    overdue: 0,
    dueSoon: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");
      const payload = await apiJson("/dashboard", { token });
      setRows(payload.rows);
      setSummary(payload.summary);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="eyebrow">Visao geral</div>
          <h1>Dashboard de ferias em aberto</h1>
          <p>Cada linha representa um periodo aquisitivo ainda pendente de concessao total.</p>
        </div>
        <button className="ghost-btn" onClick={loadDashboard}>
          Atualizar
        </button>
      </div>

      <section className="kpi-grid">
        <article className="kpi-card">
          <p>Funcionarios ativos</p>
          <strong>{summary.employees}</strong>
          <span><Users size={14} /> Base ativa</span>
        </article>
        <article className="kpi-card">
          <p>Periodos em aberto</p>
          <strong>{summary.periodsOpen}</strong>
          <span><ListChecks size={14} /> Férias pendentes</span>
        </article>
        <article className="kpi-card">
          <p>Vencidos</p>
          <strong>{summary.overdue}</strong>
          <span><AlertTriangle size={14} /> Exigem acao</span>
        </article>
        <article className="kpi-card">
          <p>Proximos do vencimento</p>
          <strong>{summary.dueSoon}</strong>
          <span><Clock3 size={14} /> Janela de atencao</span>
        </article>
      </section>

      <section className="panel">
        {loading ? <p>Carregando dashboard...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {!loading && !error ? (
          <div className="table-wrap">
            <table className="data-table dashboard-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Codigo</th>
                  <th>Funcionario</th>
                  <th>Admissao</th>
                  <th>Periodo aquisitivo</th>
                  <th>Periodo concessivo</th>
                  <th>Dias restantes</th>
                  <th>Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={urgencyLabels[row.urgency]}>
                    <td>{row.companyName}</td>
                    <td>{row.employeeCode}</td>
                    <td>{row.employeeName}</td>
                    <td>{formatDate(row.hireDate)}</td>
                    <td>{formatPeriod(row.acquisitionStart, row.acquisitionEnd)}</td>
                    <td>{formatPeriod(row.concessionStart, row.concessionEnd)}</td>
                    <td>{row.remainingDays}</td>
                    <td>{formatDate(row.dueDate)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan="8">Nenhum periodo pendente encontrado.</td>
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
