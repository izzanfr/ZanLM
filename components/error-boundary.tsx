"use client";
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; onError: () => void };
type State = { failed: boolean };

/** Renders nothing after a child throws and lets the parent choose a fallback. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
