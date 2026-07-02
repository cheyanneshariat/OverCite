import fs from "node:fs/promises";

const README_PATH = new URL("../README.md", import.meta.url);
const MARKETPLACE_EXTENSION = "CheyanneShariat.overcite-vscode";
const MARKETPLACE_QUERY_URL =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1";

async function fetchMarketplaceInstallCount() {
  const response = await fetch(MARKETPLACE_QUERY_URL, {
    method: "POST",
    headers: {
      accept: "application/json;api-version=7.2-preview.1",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      filters: [
        {
          criteria: [
            {
              filterType: 7,
              value: MARKETPLACE_EXTENSION
            }
          ]
        }
      ],
      flags: 914
    })
  });

  if (!response.ok) {
    throw new Error(`VS Marketplace request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const extension = data.results?.[0]?.extensions?.[0];
  const installCount = extension?.statistics?.find(
    (statistic) => statistic.statisticName === "install"
  )?.value;

  if (!Number.isFinite(installCount)) {
    throw new Error(`Could not find install count for ${MARKETPLACE_EXTENSION}`);
  }

  return Math.trunc(installCount);
}

async function updateReadmeInstallCount(installCount) {
  const readme = await fs.readFile(README_PATH, "utf8");
  const badgePattern =
    /(https:\/\/img\.shields\.io\/badge\/VS%20Code%20installs-)(\d+)(-007ACC\?style=for-the-badge)/;

  if (!badgePattern.test(readme)) {
    throw new Error("Could not find the VS Code installs badge in README.md");
  }

  const nextReadme = readme.replace(badgePattern, `$1${installCount}$3`);
  if (nextReadme === readme) {
    console.log(`README already shows VS Code installs: ${installCount}`);
    return false;
  }

  await fs.writeFile(README_PATH, nextReadme);
  console.log(`Updated README VS Code installs to ${installCount}`);
  return true;
}

const installCount = await fetchMarketplaceInstallCount();
await updateReadmeInstallCount(installCount);
