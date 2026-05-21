import { useQuery } from '@tanstack/react-query';
import type { WhoAmI } from 'shell-api';
import { fetchBff } from './client';

export function useWhoAmI(enabled: boolean) {
  return useQuery<WhoAmI | null>({
    queryKey: ['bff', 'whoami'],
    enabled,
    queryFn: async () => {
      const r = await fetchBff('/api/whoami');
      if (!r.ok) return null;
      return r.body as WhoAmI;
    }
  });
}
