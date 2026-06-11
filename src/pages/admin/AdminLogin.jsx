import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowRight } from '@phosphor-icons/react';
import { adminLogin, checkAdminAuth } from '../../api/adminService';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    checkAdminAuth().then((isAdmin) => {
      if (cancelled) return;
      if (isAdmin) navigate('/admin/dashboard');
      else setAuthChecking(false);
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await adminLogin(email, password);
    setLoading(false);
    if (res.success) {
      navigate('/admin/dashboard');
    } else {
      setError(res.errMessage);
    }
  };

  if (authChecking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-zinc-500">
        Checking session…
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-white px-4">
      <div className="w-full max-w-[384px] p-8 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-full bg-blue-600/20 text-blue-500 flex items-center justify-center">
            <Lock size={24} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center mb-2">Admin Portal</h2>
        <p className="text-zinc-400 text-sm text-center mb-8">Sign in with your admin account</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="email"
              autoComplete="email"
              placeholder="Email"
              className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-white outline-none focus:border-blue-500 transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-white outline-none focus:border-blue-500 transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Authenticating...' : 'Enter Dashboard'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>
      </div>
    </div>
  );
}
