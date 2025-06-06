import { createRoot } from "react-dom/client";
import "./index.css";

// Simple test component first
function TestApp() {
  return (
    <div style={{ padding: "20px", fontFamily: "Inter, sans-serif" }}>
      <h1>RFP Tracker Test</h1>
      <p>React is working!</p>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

try {
  const root = createRoot(rootElement);
  root.render(<TestApp />);
  console.log("Test app mounted successfully");
  
  // Load full app after test
  setTimeout(async () => {
    try {
      const { default: App } = await import("./App");
      root.render(<App />);
      console.log("Full RFP Tracker app loaded");
    } catch (error) {
      console.error("Failed to load full app:", error);
    }
  }, 1000);
} catch (error) {
  console.error("Failed to mount test app:", error);
}
