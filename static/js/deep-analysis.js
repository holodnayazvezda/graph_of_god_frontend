import { DeepFriendAnalysisApp } from "./deep-analysis/controller.js";

window.addEventListener("DOMContentLoaded", () => {
  const app = new DeepFriendAnalysisApp(document);
  app.boot();
});
