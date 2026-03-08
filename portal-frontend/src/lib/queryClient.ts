import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min — intelligence data doesn't change often
      gcTime: 10 * 60 * 1000,         // 10 min garbage collection
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
