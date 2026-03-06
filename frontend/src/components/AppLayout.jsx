import {
  Building2,
  CalendarRange,
  LayoutDashboard,
  LogOut,
  Shield,
  Users,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

const menuItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/funcionarios", label: "Funcionarios", icon: CalendarRange },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-wrap">
          <div className="brand-mark">OF</div>
          <div>
            <div className="brand">Controle de Férias</div>
            <p className="brand-subtitle">RH Omega</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className="nav-item">
                <Icon size={16} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          {user?.role === "ADMIN" && (
            <>
              <NavLink to="/empresas" className="nav-item">
                <Building2 size={16} />
                <span>Empresas</span>
              </NavLink>
              <NavLink to="/usuarios" className="nav-item">
                <Users size={16} />
                <span>Usuarios</span>
              </NavLink>
              <div className="nav-note">
                <Shield size={14} />
                <span>Admin pode criar usuarios, empresas e inativar funcionarios.</span>
              </div>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-badge">
            <strong>{user?.username}</strong>
            <span>{user?.role}</span>
          </div>
          <button className="ghost-btn" onClick={handleLogout}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="main-area">
        <Outlet />
      </main>
    </div>
  );
}
