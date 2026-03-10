import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app/App.tsx";
import "./styles/index.css";

try {
  console.log("[Creez] main.tsx app mount start");
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("root element #root not found");
  }
  createRoot(rootEl).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
  console.log("[Creez] main.tsx app mount done");
} catch (err) {
  const message = err instanceof Error ? err.message + "\n" + (err.stack || "") : String(err);
  console.error("[Creez] main.tsx mount error:", message);
  if (typeof window !== "undefined") {
    (window as unknown as { __creezRenderError?: string }).__creezRenderError = message;
  }
  throw err;
}
