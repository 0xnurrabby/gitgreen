// Privy-powered sign-in widget, bundled to public/privy-auth.js.
// Mounted at #privy-root on the auth screen.
import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';

function LoginInner() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // getAccessToken is recreated on every render, so keep the latest one in a
  // ref instead of in the effect deps. Otherwise the effect re-fires (and its
  // cleanup cancels the backend login) on every re-render.
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const handledRef = useRef(false);

  // Expose logout so the dashboard can sign out both sides.
  useEffect(() => {
    window.__gitgreenPrivyLogout = logout;
  }, [logout]);

  useEffect(() => {
    if (!ready || !authenticated || handledRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessTokenRef.current();
        const res = await fetch('/api/auth/privy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (cancelled || handledRef.current) return;
        if (res.ok) {
          handledRef.current = true;
          window.dispatchEvent(new CustomEvent('gitgreen:login', { detail: data.user }));
        } else {
          setErr(data.error || 'backend rejected login');
        }
      } catch (e) {
        if (!cancelled) setErr('login failed');
      }
    })();
    return () => { cancelled = true; };
  }, [ready, authenticated]);

  const handleLogin = async () => {
    setBusy(true);
    setErr('');
    try {
      await login();
    } catch (e) {
      setErr('login cancelled or failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-github" onClick={handleLogin} disabled={!ready || busy}>
        <svg height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
        </svg>
        {busy ? 'Opening...' : 'Continue with email'}
      </button>
      <p className="auth-oauth-hint">Enter your email and we&rsquo;ll send you a one-time login code.</p>
      {err ? <div className="form-msg err">{err}</div> : null}
    </>
  );
}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="auth-oauth-loading" style={{ color: '#d1242f' }}>
          Privy failed to load: {String(this.state.error.message || this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const [cfg, setCfg] = useState(null);
  const [alreadyIn, setAlreadyIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => { if (!cancelled && me.user) setAlreadyIn(true); })
      .catch(() => {});
    fetch('/api/privy/config')
      .then((r) => r.json())
      .then((c) => { if (!cancelled) setCfg(c); })
      .catch(() => { if (!cancelled) setCfg({ configured: false }); });
    return () => { cancelled = true; };
  }, []);

  if (alreadyIn) return null;
  if (!cfg) {
    return <div className="auth-oauth-loading">Loading sign-in...</div>;
  }

  if (!cfg.configured || !cfg.appId) {
    return (
      <div className="auth-oauth-loading">
        Privy is not configured. Add <code>PRIVY_APP_ID</code>, <code>PRIVY_CLIENT_ID</code> and{' '}
        <code>PRIVY_APP_SECRET</code> to the <code>.env</code> file, then restart.
      </div>
    );
  }

  return (
    <Boundary>
      <PrivyProvider
        appId={cfg.appId}
        clientId={cfg.clientId || undefined}
        config={{
          loginMethods: ['email'],
          appearance: {
            theme: 'light',
            accentColor: '#5b4dff',
            showWalletUIs: false
          }
        }}
      >
        <LoginInner />
      </PrivyProvider>
    </Boundary>
  );
}

const el = document.getElementById('privy-root');
if (el) createRoot(el).render(<Root />);
