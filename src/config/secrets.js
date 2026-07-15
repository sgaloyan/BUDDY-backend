import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let client;
function getClient() {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

// Resolve a single value. Values shaped like
//   sm://projects/PROJECT/secrets/NAME[/versions/VERSION]
// are fetched from Google Secret Manager; anything else is returned unchanged.
// This lets local dev pass plain strings while production injects sm:// references.
export async function resolveSecret(value) {
  if (typeof value !== 'string' || !value.startsWith('sm://')) return value;

  const name = value.slice('sm://'.length);
  const resource = name.includes('/versions/') ? name : `${name}/versions/latest`;
  const [version] = await getClient().accessSecretVersion({ name: resource });
  return version.payload.data.toString('utf8');
}

// Resolve Secret-Manager-backed values for the given keys, returning a shallow-merged copy.
export async function resolveSecrets(source, keys) {
  const resolved = { ...source };
  await Promise.all(
    keys.map(async (key) => {
      if (source[key] != null) resolved[key] = await resolveSecret(source[key]);
    }),
  );
  return resolved;
}
