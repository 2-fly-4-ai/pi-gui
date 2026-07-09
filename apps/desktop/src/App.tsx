import { AppReady } from "./features/app-shell/app-ready";
import { useDesktopAppState } from "./state/desktop-state-store";

export default function App() {
  const [snapshot, setSnapshot, selectedTranscript] = useDesktopAppState();
  const api = window.piApp;

  if (!api || !snapshot) {
    return (
      <div className="shell shell--loading">
        <main className="loading-card">
          <div className="loading-card__eyebrow">pi-gui</div>
          <h1>Loading sessions</h1>
          <p>The desktop shell is restoring folder and thread state from the main process.</p>
        </main>
      </div>
    );
  }

  return (
    <AppReady
      api={api}
      selectedTranscript={selectedTranscript}
      setSnapshot={setSnapshot}
      snapshot={snapshot}
    />
  );
}
