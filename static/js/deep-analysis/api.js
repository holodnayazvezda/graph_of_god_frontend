export class DeepFriendAnalysisApiClient {
  async createJob(profile, depth) {
    return this.#request("/api/deep-friend-analysis/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, depth }),
    });
  }

  async getJob(statusUrl) {
    return this.#request(statusUrl, { method: "GET" });
  }

  async #request(path, options) {
    const response = await fetch(path, options);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || "Ошибка frontend API.");
    }

    return payload;
  }
}
