declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ANTHROPIC_API_KEY?: string;
  }
}

// Vite asset imports, e.g. the PDF.js worker.
declare module "*?url" {
  const url: string;
  export default url;
}
