import { useEffect, useState } from "react";
import { PencilLine, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";
import { formatDate, formatPeriod } from "../services/date";

const emptyEmployeeForm = {
  name: "",
  code: "",
  companyId: "",
  hireDate: "",
};

const emptyBlockForm = {
  startDate: "",
  endDate: "",
  notes: "",
};

function buildPeriodForm(period) {
  return {
    acquisitionStart: period.acquisitionStart || "",
    acquisitionEnd: period.acquisitionEnd || "",
    concessionStart: period.concessionStart || "",
    concessionEnd: period.concessionEnd || "",
    dueDate: period.dueDate || "",
    totalDays: String(period.totalDays || 30),
    manuallyGranted: Boolean(period.manuallyGranted),
  };
}

function buildBlockForm(block) {
  return {
    startDate: block.startDate || "",
    endDate: block.endDate || "",
    notes: block.notes || "",
  };
}

function calculateBlockDays(startDate, endDate) {
  if (!startDate || !endDate) return "";
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const diffInDays = Math.floor((end - start) / 86400000);
  if (Number.isNaN(diffInDays) || diffInDays < 0) return "";
  return String(diffInDays + 1);
}

export default function EmployeeDetailsPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [employee, setEmployee] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [periodForms, setPeriodForms] = useState({});
  const [blockForms, setBlockForms] = useState({});
  const [editBlocks, setEditBlocks] = useState({});
  const [editingEmployee, setEditingEmployee] = useState(false);
  const [editingPeriods, setEditingPeriods] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingEmployee, setSavingEmployee] = useState(false);

  async function loadPage() {
    try {
      setLoading(true);
      setError("");
      const [employeePayload, companiesPayload] = await Promise.all([
        apiJson(`/employees/${id}`, { token }),
        apiJson("/companies", { token }),
      ]);
      const nextEmployee = employeePayload.employee;
      setEmployee(nextEmployee);
      setCompanies(companiesPayload.companies.filter((company) => company.active));
      setEmployeeForm({
        name: nextEmployee.name,
        code: nextEmployee.code,
        companyId: String(nextEmployee.companyId),
        hireDate: nextEmployee.hireDate,
      });
      setPeriodForms(
        Object.fromEntries(nextEmployee.periods.map((period) => [period.id, buildPeriodForm(period)]))
      );
      setEditBlocks(
        Object.fromEntries(
          nextEmployee.periods.map((period) => [
            period.id,
            Object.fromEntries(period.blocks.map((block) => [block.id, buildBlockForm(block)])),
          ])
        )
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, [id]);

  async function handleSaveEmployee(event) {
    event.preventDefault();
    try {
      setSavingEmployee(true);
      setError("");
      await apiJson(`/employees/${id}`, {
        token,
        method: "PATCH",
        data: {
          ...employeeForm,
          companyId: Number(employeeForm.companyId),
        },
      });
      setEditingEmployee(false);
      await loadPage();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingEmployee(false);
    }
  }

  function handleCancelEmployeeEdit() {
    if (!employee) return;
    setEmployeeForm({
      name: employee.name,
      code: employee.code,
      companyId: String(employee.companyId),
      hireDate: employee.hireDate,
    });
    setEditingEmployee(false);
  }

  async function handlePeriodSave(periodId) {
    const form = periodForms[periodId];
    try {
      setError("");
      await apiJson(`/employees/${id}/periods/${periodId}`, {
        token,
        method: "PATCH",
        data: {
          acquisitionStart: form.acquisitionStart || null,
          acquisitionEnd: form.acquisitionEnd || null,
          concessionStart: form.concessionStart || null,
          concessionEnd: form.concessionEnd || null,
          dueDate: form.dueDate || null,
          totalDays: Number(form.totalDays),
          manuallyGranted: form.manuallyGranted,
        },
      });
      setEditingPeriods((current) => ({
        ...current,
        [periodId]: false,
      }));
      await loadPage();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function handleTogglePeriodEdit(period) {
    const nextValue = !editingPeriods[period.id];

    setEditingPeriods((current) => ({
      ...current,
      [period.id]: nextValue,
    }));

    setPeriodForms((current) => ({
      ...current,
      [period.id]: buildPeriodForm(period),
    }));

    setEditBlocks((current) => ({
      ...current,
      [period.id]: Object.fromEntries(period.blocks.map((block) => [block.id, buildBlockForm(block)])),
    }));
  }

  async function handleAddBlock(periodId, event) {
    event.preventDefault();
    const form = blockForms[periodId] || emptyBlockForm;

    try {
      setError("");
      await apiJson(`/employees/${id}/periods/${periodId}/blocks`, {
        token,
        method: "POST",
        data: {
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          notes: form.notes,
        },
      });
      setBlockForms((current) => ({
        ...current,
        [periodId]: emptyBlockForm,
      }));
      await loadPage();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleSaveBlock(periodId, blockId) {
    const form = editBlocks[periodId]?.[blockId];
    try {
      setError("");
      await apiJson(`/employees/${id}/periods/${periodId}/blocks/${blockId}`, {
        token,
        method: "PATCH",
        data: {
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          notes: form.notes,
        },
      });
      await loadPage();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleDeleteBlock(periodId, blockId) {
    try {
      setError("");
      await apiJson(`/employees/${id}/periods/${periodId}/blocks/${blockId}`, {
        token,
        method: "DELETE",
      });
      await loadPage();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  if (loading) {
    return <div className="screen-center">Carregando funcionario...</div>;
  }

  if (!employee) {
    return <div className="screen-center">Funcionario nao encontrado.</div>;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="eyebrow">Perfil do funcionario</div>
          <h1>{employee.name}</h1>
          <p>Edite os dados principais e controle os blocos de ferias por periodo.</p>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel">
        <div className="section-head">
          <h2>Dados cadastrais</h2>
          {!editingEmployee ? (
            <button className="ghost-btn icon-text-btn" type="button" onClick={() => setEditingEmployee(true)}>
              <PencilLine size={15} />
              Editar cadastro
            </button>
          ) : (
            <div className="inline-actions">
              <button className="ghost-btn icon-text-btn" type="button" onClick={handleCancelEmployeeEdit}>
                <X size={15} />
                Cancelar
              </button>
            </div>
          )}
        </div>
        <form className="form-grid employee-form" onSubmit={handleSaveEmployee}>
          <label>
            Nome
            <input
              value={employeeForm.name}
              onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })}
              disabled={!editingEmployee}
            />
          </label>
          <label>
            Codigo
            <input
              value={employeeForm.code}
              onChange={(event) => setEmployeeForm({ ...employeeForm, code: event.target.value })}
              disabled={!editingEmployee}
            />
          </label>
          <label>
            Empresa
            <select
              value={employeeForm.companyId}
              onChange={(event) => setEmployeeForm({ ...employeeForm, companyId: event.target.value })}
              disabled={!editingEmployee}
            >
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
              value={employeeForm.hireDate}
              onChange={(event) => setEmployeeForm({ ...employeeForm, hireDate: event.target.value })}
              disabled={!editingEmployee}
            />
          </label>
          {editingEmployee ? (
            <button className="primary-btn" type="submit" disabled={savingEmployee}>
              {savingEmployee ? "Salvando..." : "Salvar alteracoes"}
            </button>
          ) : (
            <div className="locked-note">Clique em editar cadastro para liberar alteracoes.</div>
          )}
        </form>
      </section>

      {employee.periods.map((period) => {
        const periodForm = periodForms[period.id] || buildPeriodForm(period);
        const isEditingPeriod = Boolean(editingPeriods[period.id]);
        return (
          <section
            key={period.id}
            className={`panel period-card ${period.urgency.toLowerCase()} ${period.granted ? "granted-period" : ""}`}
          >
            <div className="period-header">
              <div>
                <h2>Periodo #{period.periodNumber + 1}</h2>
                <p>
                  Aquisitivo: {formatPeriod(period.acquisitionStart, period.acquisitionEnd)}
                </p>
                <p>
                  Concessivo: {formatPeriod(period.concessionStart, period.concessionEnd)}
                </p>
              </div>

              <div className="period-meta">
                <span className="badge badge-strong">{period.remainingDays} dias restantes</span>
                <span className={`badge ${period.granted ? "badge-success-soft" : ""}`}>
                  {period.granted ? "Férias concedidas" : "Em aberto"}
                </span>
                <span className="badge">Vence em {formatDate(period.dueDate)}</span>
                <button className="ghost-btn icon-text-btn" type="button" onClick={() => handleTogglePeriodEdit(period)}>
                  <PencilLine size={15} />
                  {isEditingPeriod ? "Fechar edicao" : "Editar periodo"}
                </button>
              </div>
            </div>

            <div className="period-summary-line">
              <span>{period.blocks.length} bloco(s) registrado(s)</span>
              <span>{period.usedDays} dia(s) utilizados</span>
              <span>{period.remainingDays} dia(s) restantes</span>
            </div>

            {isEditingPeriod ? (
              <>
                <div className="form-grid period-edit-grid">
                  <label>
                    Inicio aquisitivo
                    <input
                      type="date"
                      value={periodForm.acquisitionStart}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, acquisitionStart: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Fim aquisitivo
                    <input
                      type="date"
                      value={periodForm.acquisitionEnd}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, acquisitionEnd: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Inicio concessivo
                    <input
                      type="date"
                      value={periodForm.concessionStart}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, concessionStart: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Fim concessivo
                    <input
                      type="date"
                      value={periodForm.concessionEnd}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, concessionEnd: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Data de vencimento
                    <input
                      type="date"
                      value={periodForm.dueDate}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, dueDate: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Total de dias
                    <input
                      type="number"
                      min="1"
                      value={periodForm.totalDays}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, totalDays: event.target.value },
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="period-tools">
                  <label className="toggle-card">
                    <span>Marcar como Férias concedidas</span>
                    <input
                      type="checkbox"
                      checked={periodForm.manuallyGranted}
                      onChange={(event) =>
                        setPeriodForms((current) => ({
                          ...current,
                          [period.id]: { ...periodForm, manuallyGranted: event.target.checked },
                        }))
                      }
                    />
                  </label>

                  <button className="primary-btn" type="button" onClick={() => handlePeriodSave(period.id)}>
                    Salvar periodo
                  </button>
                </div>

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Inicio</th>
                        <th>Fim</th>
                        <th>Dias</th>
                        <th>Observacao</th>
                        <th>Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {period.blocks.map((block) => {
                        const blockForm = editBlocks[period.id]?.[block.id] || buildBlockForm(block);
                        const calculatedDays = calculateBlockDays(blockForm.startDate, blockForm.endDate);
                        return (
                          <tr key={block.id}>
                            <td>
                              <input
                                type="date"
                                value={blockForm.startDate}
                                onChange={(event) =>
                                  setEditBlocks((current) => ({
                                    ...current,
                                    [period.id]: {
                                      ...(current[period.id] || {}),
                                      [block.id]: { ...blockForm, startDate: event.target.value },
                                    },
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                value={blockForm.endDate}
                                onChange={(event) =>
                                  setEditBlocks((current) => ({
                                    ...current,
                                    [period.id]: {
                                      ...(current[period.id] || {}),
                                      [block.id]: { ...blockForm, endDate: event.target.value },
                                    },
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input type="text" value={calculatedDays || "-"} disabled />
                            </td>
                            <td>
                              <input
                                value={blockForm.notes}
                                onChange={(event) =>
                                  setEditBlocks((current) => ({
                                    ...current,
                                    [period.id]: {
                                      ...(current[period.id] || {}),
                                      [block.id]: { ...blockForm, notes: event.target.value },
                                    },
                                  }))
                                }
                              />
                            </td>
                            <td className="actions-cell">
                              <button className="ghost-btn" type="button" onClick={() => handleSaveBlock(period.id, block.id)}>
                                Salvar
                              </button>
                              <button className="ghost-btn" type="button" onClick={() => handleDeleteBlock(period.id, block.id)}>
                                Excluir
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!period.blocks.length ? (
                        <tr>
                          <td colSpan="5">Nenhum bloco registrado.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <form className="form-grid compact-form" onSubmit={(event) => handleAddBlock(period.id, event)}>
                  {(() => {
                    const form = blockForms[period.id] || emptyBlockForm;
                    const calculatedDays = calculateBlockDays(form.startDate, form.endDate);

                    return (
                      <>
                  <label>
                    Inicio
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(event) =>
                        setBlockForms((current) => ({
                          ...current,
                          [period.id]: {
                            ...(current[period.id] || emptyBlockForm),
                            startDate: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(event) =>
                        setBlockForms((current) => ({
                          ...current,
                          [period.id]: {
                            ...(current[period.id] || emptyBlockForm),
                            endDate: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Dias
                    <input type="text" value={calculatedDays || "-"} disabled />
                  </label>
                  <label>
                    Observacao
                    <input
                      value={form.notes}
                      onChange={(event) =>
                        setBlockForms((current) => ({
                          ...current,
                          [period.id]: {
                            ...(current[period.id] || emptyBlockForm),
                            notes: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <button className="primary-btn fit-btn period-add-btn" type="submit">
                    Adicionar periodo de ferias
                  </button>
                      </>
                    );
                  })()}
                </form>
              </>
            ) : (
              <div className="collapsed-note">Clique na caneta para editar este periodo.</div>
            )}
          </section>
        );
      })}
    </div>
  );
}
