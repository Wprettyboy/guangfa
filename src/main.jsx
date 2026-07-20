import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ApiAuthGate from "./components/ApiAuthGate.jsx";
import "./styles/index.css";

createRoot(document.getElementById("root")).render(
  <ApiAuthGate>
    {({ hasCredential, principal, resetCredential }) => (
      <App
        principal={principal}
        onResetApiCredential={hasCredential ? resetCredential : null}
      />
    )}
  </ApiAuthGate>,
);
