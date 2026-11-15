import { options } from "preact";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// React is aliased to Preact. Run effects right after each commit, as React
// does, instead of waiting for the next animation frame.
const effects: (() => void)[] = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => effects.shift()?.();
options.requestAnimationFrame = (callback) => {
  effects.push(callback);
  channel.port2.postMessage(null);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
