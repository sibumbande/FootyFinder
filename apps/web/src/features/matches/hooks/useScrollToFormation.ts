import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** True when the page was opened at its formation (`#formation`), e.g. straight after publishing a match. */
export function useOpensAtFormation() {
  return useLocation().hash === '#formation';
}

/** Scrolls the `#formation` section into view once it is on the page. */
export function useScrollToFormation(ready: boolean) {
  const opensAtFormation = useOpensAtFormation();
  useEffect(() => {
    if (opensAtFormation && ready) document.getElementById('formation')?.scrollIntoView?.({ block: 'start' });
  }, [opensAtFormation, ready]);
}
