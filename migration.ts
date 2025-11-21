import type { PhoenixSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';

const CURRENT_VERSION = 1;
const VERSION_KEY = 'phoenixStorageVersion';

interface MigrationContext {
  settings: Partial<PhoenixSettings>;
  version: number;
}

type Migration = (ctx: MigrationContext) => MigrationContext;

// Add migrations here as the schema evolves
const migrations: Record<number, Migration> = {
  // Version 0 -> 1: Initial schema, no changes needed
  1: (ctx) => ctx,
};

export async function migrateStorage(): Promise<void> {
  const result = await chrome.storage.local.get([VERSION_KEY, 'phoenixSettings']);
  const currentVersion = (result[VERSION_KEY] as number) || 0;

  if (currentVersion >= CURRENT_VERSION) {
    return; // Already up to date
  }

  let context: MigrationContext = {
    settings: result.phoenixSettings || {},
    version: currentVersion,
  };

  // Run migrations sequentially
  for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
    const migration = migrations[v];
    if (migration) {
      console.info(`[ANS] Running migration to version ${v}`);
      context = migration(context);
      context.version = v;
    }
  }

  // Merge with defaults to ensure all fields exist
  const migratedSettings: PhoenixSettings = {
    ...DEFAULT_SETTINGS,
    ...context.settings,
  };

  // Save migrated data
  await chrome.storage.local.set({
    [VERSION_KEY]: CURRENT_VERSION,
    phoenixSettings: migratedSettings,
  });

  console.info(`[ANS] Storage migrated to version ${CURRENT_VERSION}`);
}

export function getStorageVersion(): number {
  return CURRENT_VERSION;
}
