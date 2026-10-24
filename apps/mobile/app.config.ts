import { existsSync } from "node:fs";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json plus what depends on the build machine: the Firebase file for
 * Android push is added only when it exists (CI writes it from a secret).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServices = "./google-services.json";
  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(existsSync(googleServices) ? { googleServicesFile: googleServices } : {}),
    },
  };
};
