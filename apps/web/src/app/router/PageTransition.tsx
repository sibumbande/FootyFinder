import type { PropsWithChildren } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** Restarts the shared page-enter motion for every history location. */
export function PageTransition({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigationType = useNavigationType().toLowerCase();
  return <div key={location.key} className={`route-page-transition route-page-transition--${navigationType}`}>{children}</div>;
}
