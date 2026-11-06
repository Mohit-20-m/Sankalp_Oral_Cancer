import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
/* Fonts — bundled locally so the app works offline. To change fonts, swap these
   imports and update `fontFamily` in tailwind.config.ts. */
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/inter";
import "@fontsource/noto-sans-kannada/400.css";
import "@fontsource/noto-sans-kannada/600.css";
import "@fontsource/noto-sans-kannada/700.css";
import "./styles/index.css";
import { applyBrandingToDocument } from "./config/theme";
import { soundManager } from "./utils/soundManager";
import App from "./App";

applyBrandingToDocument();
soundManager.init();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
