export class SocialGraphApiClient {
  async createJob(profiles) {
    return this.#request("/api/social-graphs/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profiles }),
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
