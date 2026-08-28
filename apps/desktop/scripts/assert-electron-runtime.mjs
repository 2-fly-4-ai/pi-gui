import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const minimumNodeVersion = "22.19.0";
const requiredElectronVersion = "43.2.0";
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const electronPackage = JSON.parse(
  readFileSync(require.resolve("electron/package.json"), "utf8"),
);
const runtime = JSON.parse(
  execFileSync(
    electronPath,
    [
      "-p",
      "JSON.stringify({electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome})",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  ).trim(),
);

if (electronPackage.version !== requiredElectronVersion || runtime.electron !== requiredElectronVersion) {
  throw new Error(
    `Electron version mismatch: package ${electronPackage.version}, runtime ${runtime.electron}, expected ${requiredElectronVersion}.`,
  );
}

if (compareVersions(runtime.node, minimumNodeVersion) < 0) {
  throw new Error(
    `Electron ${runtime.electron} embeds Node ${runtime.node}; Pi 0.82.1 requires Node ${minimumNodeVersion} or newer.`,
  );
}

console.log(
  `Verified Electron ${runtime.electron} embeds Node ${runtime.node} (Chromium ${runtime.chrome}).`,
);

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
