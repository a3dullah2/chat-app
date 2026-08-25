"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Lock, Mail, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api, ApiClientError } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PublicUserDTO } from "@/types";

const loginSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const signupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(50, "Name is too long"),
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Za-z]/, "At least one letter")
    .regex(/[0-9]/, "At least one number"),
});

type LoginValues = z.infer<typeof loginSchema>;
type SignupValues = z.infer<typeof signupSchema>;

export function AuthView() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const queryClient = useQueryClient();

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSuccess = (user: PublicUserDTO) => {
    queryClient.setQueryData(["me"], user);
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const onLogin = loginForm.handleSubmit(async (values) => {
    try {
      const data = await api<{ user: PublicUserDTO }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onSuccess(data.user);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.";
      loginForm.setError("root", { message });
    }
  });

  const onSignup = signupForm.handleSubmit(async (values) => {
    try {
      const data = await api<{ user: PublicUserDTO }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onSuccess(data.user);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.";
      signupForm.setError("root", { message });
    }
  });

  const rootError = mode === "login" ? loginForm.formState.errors.root?.message : signupForm.formState.errors.root?.message;
  const isSubmitting = mode === "login" ? loginForm.formState.isSubmitting : signupForm.formState.isSubmitting;

  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-14 w-14 rounded-full bg-primary flex items-center justify-center">
            <MessageCircle className="h-7 w-7 text-primary-foreground" aria-hidden />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {mode === "login" ? "Welcome back." : "Create your account."}
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            {mode === "login"
              ? "Sign in to continue to your conversations."
              : "A few details and you're ready to chat."}
          </p>
        </div>

        {/* Mode switch — two M3 pill buttons */}
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => setMode("login")}
            className={cn(
              "rounded-full h-11 px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              mode === "login"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:opacity-90",
            )}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            onClick={() => setMode("signup")}
            className={cn(
              "rounded-full h-11 px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              mode === "signup"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:opacity-90",
            )}
          >
            Sign up
          </button>
        </div>

        <div className="rounded-[28px] bg-card p-6 md:p-8 shadow-sm">
          {rootError && (
            <p role="alert" className="mb-4 rounded-[12px] bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {rootError}
            </p>
          )}

          {mode === "login" ? (
            <form onSubmit={onLogin} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    aria-invalid={!!loginForm.formState.errors.email}
                    {...loginForm.register("email")}
                  />
                </div>
                {loginForm.formState.errors.email && (
                  <p role="alert" className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your password"
                    className="pl-9"
                    aria-invalid={!!loginForm.formState.errors.password}
                    {...loginForm.register("password")}
                  />
                </div>
                {loginForm.formState.errors.password && (
                  <p role="alert" className="text-xs text-destructive">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Log in
              </Button>
            </form>
          ) : (
            <form onSubmit={onSignup} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="signup-name">Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="signup-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    className="pl-9"
                    aria-invalid={!!signupForm.formState.errors.name}
                    {...signupForm.register("name")}
                  />
                </div>
                {signupForm.formState.errors.name && (
                  <p role="alert" className="text-xs text-destructive">{signupForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    aria-invalid={!!signupForm.formState.errors.email}
                    {...signupForm.register("email")}
                  />
                </div>
                {signupForm.formState.errors.email && (
                  <p role="alert" className="text-xs text-destructive">{signupForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="8+ chars, one letter, one number"
                    className="pl-9"
                    aria-invalid={!!signupForm.formState.errors.password}
                    {...signupForm.register("password")}
                  />
                </div>
                {signupForm.formState.errors.password && (
                  <p role="alert" className="text-xs text-destructive">{signupForm.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Create account
              </Button>
            </form>
          )}
        </div>

        <div className="rounded-[16px] bg-secondary text-secondary-foreground p-4 text-sm">
          <p className="font-medium mb-1">Demo account</p>
          <p className="text-muted-foreground">
            Email <span className="font-mono text-foreground">demo@chatapp.com</span> · Password{" "}
            <span className="font-mono text-foreground">password123</span>
          </p>
          <button
            type="button"
            className="mt-2 text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring rounded"
            onClick={() => {
              loginForm.setValue("email", "demo@chatapp.com");
              loginForm.setValue("password", "password123");
              setMode("login");
            }}
          >
            Fill demo credentials
          </button>
        </div>
      </div>
    </div>
  );
}
