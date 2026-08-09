import { useQuery } from '@tanstack/react-query'; import { matchApi } from '../api/matches.js'; export const useMatches = () => useQuery({ queryKey: ['matches'], queryFn: () => matchApi.list() });
