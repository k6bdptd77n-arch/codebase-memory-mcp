"use strict";
// electron-builder afterSign hook. Notarization needs a paid Apple Developer ID and
// app-specific credentials this project does not ship with — so this SKIPS silently
// (a valid, expected state for an unsigned/ad-hoc build) unless the four env vars below
// are all present, and only then attempts the real notarize call.
module.exports = async function notarize(context) {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (context.electronPlatformName !== "darwin") return;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("notarize: no Apple credentials in env — skipping (ad-hoc build).");
    return;
  }
  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch {
    console.log("notarize: credentials present but @electron/notarize isn't installed — " +
      "run `npm install --save-dev @electron/notarize` to enable it. Skipping.");
    return;
  }
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  await notarize({
    appBundleId: "dev.mindforge.control",
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
