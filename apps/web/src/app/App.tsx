import { AppProviders } from './providers/AppProviders.js';
import { AppRouter } from './router/AppRouter.js';
export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
