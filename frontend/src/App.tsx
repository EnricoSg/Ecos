// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login'; // Importando a tela que você acabou de criar!
import { Dashboard } from './pages/Dashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Quando a URL terminar em /login, mostra a tela de Login */}
        <Route path="/login" element={<Login />} />
        
        {/* Adcionamos a Rota do Dashboard aqui */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;''