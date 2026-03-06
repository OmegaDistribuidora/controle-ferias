import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";

const initialForm = {
  username: "",
  password: "",
  role: "RH",
};

export default function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadUsers() {
    try {
      setError("");
      const payload = await apiJson("/users", { token });
      setUsers(payload.users);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      await apiJson("/users", {
        token,
        method: "POST",
        data: form,
      });
      setForm(initialForm);
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(user) {
    try {
      setError("");
      await apiJson(`/users/${user.id}`, {
        token,
        method: "PATCH",
        data: {
          active: !user.active,
        },
      });
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="eyebrow">Administracao</div>
          <h1>Usuarios</h1>
          <p>Somente o admin pode criar novos acessos para o RH.</p>
        </div>
      </div>

      <section className="panel split-panel">
        <div>
          <h2>Novo usuario</h2>
          <form className="form-grid admin-user-form" onSubmit={handleCreate}>
            <label>
              Usuario
              <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
              />
            </label>
            <label>
              Perfil
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="RH">RH</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <button className="primary-btn fit-btn" type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Criar usuario"}
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
                <th>Usuario</th>
                <th>Perfil</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.role}</td>
                  <td>{user.active ? "Ativo" : "Inativo"}</td>
                  <td>
                    <button className="ghost-btn" onClick={() => handleToggle(user)}>
                      {user.active ? "Inativar" : "Reativar"}
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
