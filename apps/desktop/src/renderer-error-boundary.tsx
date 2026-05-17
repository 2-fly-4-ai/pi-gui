import React from "react";
import { reportRendererDiagnostic, serializeErrorLike } from "./renderer-diagnostics";

interface RendererErrorBoundaryState {
  readonly errorMessage: string | null;
}

export class RendererErrorBoundary extends React.Component<React.PropsWithChildren, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): RendererErrorBoundaryState {
    const serialized = serializeErrorLike(error);
    return { errorMessage: serialized.message ?? "Unknown renderer error" };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    reportRendererDiagnostic({
      kind: "react-error-boundary",
      ...serializeErrorLike(error),
      componentStack: errorInfo.componentStack ?? "",
    });
  }

  render(): React.ReactNode {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <main style={fallbackStyle}>
        <section style={cardStyle}>
          <p style={eyebrowStyle}>Renderer error captured</p>
          <h1 style={titleStyle}>Pi hit a UI error.</h1>
          <p style={bodyStyle}>Diagnostics were saved to the desktop log. Restart or reload the app to recover.</p>
          <pre style={errorStyle}>{this.state.errorMessage}</pre>
        </section>
      </main>
    );
  }
}

const fallbackStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#f3f4f8",
  color: "#12141a",
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  width: "min(620px, 100%)",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: 24,
  background: "#fff",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.16)",
  padding: 32,
};

const eyebrowStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#7c3aed",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 28,
};

const bodyStyle: React.CSSProperties = {
  margin: "0 0 18px",
  color: "#526070",
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  padding: 16,
  borderRadius: 14,
  background: "#f6f7fb",
  color: "#3b4250",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
