import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthProvider';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Intake from './pages/Intake';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/intake/:slug" element={<Intake />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-center" richColors />
    </AuthProvider>
  );
}
