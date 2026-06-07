import React from "react";
import { createRoot } from "react-dom/client";
import ElecLab from "./ElecLab.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ElecLab />
  </React.StrictMode>
);
