import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from './session';
import { App } from './App';
import { firebase } from './firebase';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
try {
  firebase();
  root.render(
    <StrictMode>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </StrictMode>,
  );
} catch {
  root.render(
    <main className="startup">
      <h1>Hominode is unavailable</h1>
      <p>Secure initialization failed. Please try again later.</p>
    </main>,
  );
}
