import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import AuditPage from "./pages/AuditPage";
import CompaniesPage from "./pages/CompaniesPage";
import DashboardPage from "./pages/DashboardPage";
import EmployeeDetailsPage from "./pages/EmployeeDetailsPage";
import EmployeesPage from "./pages/EmployeesPage";
import LoginPage from "./pages/LoginPage";
import UsersPage from "./pages/UsersPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="funcionarios" element={<EmployeesPage />} />
        <Route path="funcionarios/:id" element={<EmployeeDetailsPage />} />
        <Route path="usuarios" element={<UsersPage />} />
        <Route path="empresas" element={<CompaniesPage />} />
        <Route path="auditoria" element={<AuditPage />} />
      </Route>
    </Routes>
  );
}
