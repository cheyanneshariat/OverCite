#!/usr/bin/env node
import fs from "node:fs/promises";

import { applyTexstudioRequest, resolveTexstudioRequest } from "./adapter.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args.command ?? "resolve";

try {
  if (command !== "resolve" && command !== "apply") {
    throw new Error(`Unknown command "${command}". Expected "resolve" or "apply".`);
  }
  const request = await readRequest(args);
  if (args.mode) {
    request.searchMode = args.mode;
  }
  if (args["select-index"] !== undefined) {
    request.selectedIndex = Number(args["select-index"]);
  }
  if (args["write-active-file"]) {
    request.writeActiveFile = true;
  }
  if (args["no-write-bib"]) {
    request.writeBibFile = false;
  }

  const response = command === "apply"
    ? await applyTexstudioRequest(request)
    : await resolveTexstudioRequest(request);
  await writeResponse(args, response);
  if (!args.response) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  }
} catch (error) {
  const response = {
    status: "error",
    message: error instanceof Error ? error.message : String(error)
  };
  await writeResponse(args, response).catch(() => {});
  process.stderr.write(`${response.message}\n`);
  process.exitCode = 1;
}

function parseArgs(rawArgs) {
  const parsed = {};
  const positional = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  parsed.command = positional[0] ?? parsed.command;
  return parsed;
}

async function readRequest(args) {
  if (args.request) {
    return JSON.parse(await fs.readFile(args.request, "utf8"));
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    throw new Error("No request JSON was provided.");
  }
  return JSON.parse(text);
}

async function writeResponse(args, response) {
  if (args.response) {
    await fs.writeFile(args.response, `${JSON.stringify(response, null, 2)}\n`, "utf8");
  }
}
