import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";

function formatDateTime(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

export default function AuditPage() {
  const { token, user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadLogs() {
    try {
      setLoading(true);
      setError("");
      const payload = await apiJson("/audit", { token });
      setLogs(payload.logs);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  if (user?.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="eyebrow">Administracao</div>
          <h1>Auditoria</h1>
          <p>Historico das acoes executadas no sistema por usuario, com data e horario.</p>
        </div>
        <button className="ghost-btn" onClick={loadLogs}>
          Atualizar
        </button>
      </div>

      <section className="panel">
        {loading ? <p>Carregando auditoria...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {!loading && !error ? (
          <div className="table-wrap">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Data e horario</th>
                  <th>Usuario</th>
                  <th>Acao</th>
                  <th>Registro</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.username}</td>
                    <td>{log.action}</td>
                    <td>
                      {log.entityType}
                      {log.entityId ? ` #${log.entityId}` : ""}
                    </td>
                    <td className="audit-description">{log.description}</td>
                  </tr>
                ))}

                {logs.length ? null : (
                  <tr>
                    <td colSpan="5">Nenhum registro de auditoria encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
