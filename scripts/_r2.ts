/// <reference types="node" />

// Unified R2 client used by seed and prune scripts. Local mode talks to
// Miniflare's R2 binding via `getPlatformProxy`; remote mode talks to the
// real R2 bucket via the S3-compatible API. Callers don't care which.

export type R2Client = {
  list: () => Promise<string[]>;
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  delete: (keys: string[]) => Promise<number>;
  dispose: () => Promise<void>;
};

export async function openR2(): Promise<R2Client> {
  return process.env.DB_REMOTE === "1" ? remoteR2() : localR2();
}

async function localR2(): Promise<R2Client> {
  // `getPlatformProxy` spins up Miniflare and exposes the same bindings the
  // running Worker sees. Stop `pnpm dev` before invoking this - both
  // processes hold a lock on `.wrangler/state` and will fight over it.
  const { getPlatformProxy } = await import("wrangler");
  const { env, dispose } = await getPlatformProxy<{ BUCKET: R2Bucket }>();
  const bucket = env.BUCKET;
  return {
    list: async () => {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ cursor, limit: 1000 });
        for (const o of page.objects) keys.push(o.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
    put: async (key, body, contentType) => {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    delete: async (keys) => {
      let n = 0;
      for (const k of keys) {
        try {
          await bucket.delete(k);
          n++;
        } catch {
          console.error(`  failed: ${k}`);
        }
      }
      return n;
    },
    dispose,
  };
}

async function remoteR2(): Promise<R2Client> {
  const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectsCommand } =
    await import("@aws-sdk/client-s3");
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  // NOTE: default mirrors wrangler.jsonc#r2_buckets[0].bucket_name. Keep in
  // sync if the bucket is ever renamed; nothing checks this at build time.
  const bucketName = process.env.R2_BUCKET ?? "flea-market";
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    list: async () => {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({ Bucket: bucketName, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
        token = res.NextContinuationToken;
      } while (token);
      return keys;
    },
    put: async (key, body, contentType) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    delete: async (keys) => {
      let n = 0;
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        const res = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: { Objects: chunk.map((Key) => ({ Key })) },
          }),
        );
        for (const e of res.Errors ?? []) console.error(`  failed: ${e.Key} (${e.Code})`);
        n += res.Deleted?.length ?? 0;
      }
      return n;
    },
    dispose: async () => {
      s3.destroy();
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing ${name} in .dev.vars.prod. Create an R2 API token at https://dash.cloudflare.com -> R2 -> Manage API tokens (Object Read & Write).`,
    );
    process.exit(1);
  }
  return v;
}
