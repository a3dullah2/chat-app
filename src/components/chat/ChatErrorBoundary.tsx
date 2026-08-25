"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Error boundary around the chat pane (spec §11 states). */
export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error("[ChatErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-medium text-foreground">Something went wrong</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The chat pane hit an unexpected error. Your messages are safe — try reloading the pane.
            </p>
          </div>
          <Button variant="outline" onClick={() => this.setState({ hasError: false })}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reload pane
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
