"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/client-api";
import { AuthView } from "@/components/auth/AuthView";
import { ChatApp } from "@/components/chat/ChatApp";
import { SplashScreen } from "@/components/shared/SplashScreen";
import type { PublicUserDTO } from "@/types";

export default function Home() {
  const { data: me, isLoading } = useQuery<PublicUserDTO | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const data = await api<{ user: PublicUserDTO }>("/api/auth/me");
        return data.user;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) return <SplashScreen />;
  if (!me) return <AuthView />;
  return <ChatApp me={me} />;
}
