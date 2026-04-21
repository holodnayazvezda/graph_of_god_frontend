import { GraphOfGodApp } from "./app/controller.js";

window.addEventListener("DOMContentLoaded", () => {
  const app = new GraphOfGodApp(document);
  app.boot();
});
