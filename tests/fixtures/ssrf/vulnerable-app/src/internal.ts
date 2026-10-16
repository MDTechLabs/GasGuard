import https from "https";

export async function fetchMetadata() {
  const metadataEndpoint = "http://169.254.169.254/latest/meta-data/";
  const agent = new https.Agent({
    rejectUnauthorized: false,
  });
  return fetch(metadataEndpoint, { agent } as any);
}
