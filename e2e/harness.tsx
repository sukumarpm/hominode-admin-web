// Test-only entry point, excluded from production builds.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthContext } from '../src/session';
import { makeSession } from '../src/test/fixtures';
import { APP_ROLE } from '../src/role';
import { selectCommunity } from '../src/policy';
import { type Session } from '../src/models';
import { App } from '../src/App';
import '../src/styles.css';
function Harness() {
  const [session, setSession] = useState<Session | null>(makeSession(APP_ROLE));
  return (
    <AuthContext
      value={{
        session,
        loading: false,
        error: '',
        authenticated: !!session,
        switchCommunity: (id) => setSession((s) => (s ? selectCommunity(s, id) : null)),
        signOut: async () => setSession(null),
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthContext>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
