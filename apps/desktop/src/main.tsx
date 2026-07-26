import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./dev-reload-hook";
import { RendererErrorBoundary } from "./renderer-error-boundary";
import { installRendererDiagnostics } from "./renderer-diagnostics";
import "./styles.css";
import { applyAppearancePreferences, readAppearancePreferences } from "./appearance-preferences";

installRendererDiagnostics();
applyAppearancePreferences(readAppearancePreferences());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>,
);
