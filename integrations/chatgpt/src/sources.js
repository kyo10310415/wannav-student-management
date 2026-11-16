const sourceNames = ["central", "extension", "ep", "sales", "payment"];
export function sourceConfiguration(env) {
  return Object.fromEntries(
    sourceNames.map((name) => {
      const prefix = name.toUpperCase(),
        raw = env[prefix + "_URL"],
        token = env[prefix + "_TOKEN"];
      if (!raw || !token || token.length < 32)
        throw new Error(
          prefix + "_URL and a dedicated 32+ character token are required",
        );
      const url = new URL(raw);
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !(
          url.protocol === "https:" ||
          (env.NODE_ENV === "test" && url.protocol === "http:")
        )
      )
        throw new Error(prefix + "_URL must be an HTTPS origin");
      return [name, { url: url.origin, token }];
    }),
  );
}
export class Sources {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }
  async request(source, path, params) {
    const config = this.config[source];
    if (!config) throw new Error("Unknown source");
    const url = new URL("/integrations/chatgpt/v1/" + path, config.url);
    if (params) url.searchParams.set("request", JSON.stringify(params));
    let res;
    try {
      res = await this.fetch(url, {
        headers: {
          Authorization: "Bearer " + config.token,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new Error(source + ": source connection failed");
    }
    if (!res.ok)
      throw new Error(
        source + ": source unavailable (HTTP " + res.status + ")",
      );
    const reader = res.body.getReader();
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4 * 1024 * 1024)
          throw new Error("Source response exceeds 4MiB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error(source + ": invalid response");
    }
  }
  async catalog() {
    const settled = await Promise.allSettled(
      Object.keys(this.config).map(async (source) => ({
        source,
        ...(await this.request(source, "catalog")),
      })),
    );
    const datasets = {},
      unavailable = [];
    settled.forEach((result, i) => {
      const source = Object.keys(this.config)[i];
      if (result.status === "rejected") {
        unavailable.push(source);
        return;
      }
      if (result.value.version !== 1 || !result.value.datasets) {
        unavailable.push(source);
        return;
      }
      for (const [id, d] of Object.entries(result.value.datasets))
        datasets[source + "." + id] = { ...d, source, dataset: id };
    });
    return { datasets, unavailable };
  }
  async query(dataset, params) {
    const dot = dataset.indexOf("."),
      source = dataset.slice(0, dot),
      name = dataset.slice(dot + 1);
    const result = await this.request(source, "query", {
      dataset: name,
      ...params,
    });
    if (
      result.version !== 1 ||
      result.dataset !== name ||
      !Array.isArray(result.rows) ||
      typeof result.truncated !== "boolean"
    )
      throw new Error(source + ": invalid dataset response");
    return result;
  }
}
