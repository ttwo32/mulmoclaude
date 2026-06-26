import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import { resolve as resolvePath } from "path";
import { log } from "./logger/index.js";
import { env } from "./env.js";
import { SUBPROCESS_PROBE_TIMEOUT_MS } from "../utils/time.js";
import { claudeConfigDir, claudeConfigJson } from "../utils/claudeConfigPath.js";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = "mulmoclaude-sandbox";
const DOCKERFILE = "Dockerfile.sandbox";
const LABEL_KEY = "mulmoclaude.dockerfile.sha256";

let _dockerEnabled: boolean | null = null;

function assertClaudeFiles(): void {
  const claudeDir = claudeConfigDir();
  const claudeJson = claudeConfigJson();
  const overrideHint = "Set CLAUDE_CONFIG_DIR / CLAUDE_CONFIG_JSON to point at your install if it lives elsewhere.";

  try {
    if (!statSync(claudeDir).isDirectory()) {
      log.error("sandbox", `${claudeDir} exists but is not a directory. ${overrideHint}`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeDir} not found. Run 'claude' once to initialize. ${overrideHint}`);
    process.exit(1);
  }

  try {
    if (!statSync(claudeJson).isFile()) {
      log.error("sandbox", `${claudeJson} exists but is not a file. ${overrideHint}`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeJson} not found. Run 'claude' once to initialize. ${overrideHint}`);
    process.exit(1);
  }
}

/** Pure daemon-liveness probe: `docker ps -q` succeeds only when the
 *  client is installed AND the daemon is reachable. No config or
 *  caching concerns — the optional-deps registry owns the PATH check
 *  and caching; this is just the liveness half. */
export async function isDockerLive(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["ps", "-q"], {
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  if (env.disableSandbox) return false;
  if (_dockerEnabled !== null) return _dockerEnabled;
  assertClaudeFiles();
  _dockerEnabled = await isDockerLive();
  return _dockerEnabled;
}

function getDockerfileSha256(): string {
  const content = readFileSync(resolvePath(process.cwd(), DOCKERFILE));
  return createHash("sha256").update(content).digest("hex");
}

async function buildImage(sha: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["build", "-t", IMAGE_NAME, "--label", `${LABEL_KEY}=${sha}`, "-f", DOCKERFILE, "--load", "."], {
      cwd: process.cwd(),
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker build exited with code ${code}`));
    });
  });
}

export async function ensureSandboxImage(): Promise<void> {
  const expectedSha = getDockerfileSha256();

  let needsBuild = false;
  try {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", IMAGE_NAME, "--format", `{{index .Config.Labels "${LABEL_KEY}"}}`]);
    if (stdout.trim() !== expectedSha) {
      log.info("sandbox", "Dockerfile.sandbox changed, rebuilding sandbox image...");
      needsBuild = true;
    }
  } catch {
    log.info("sandbox", "Building sandbox image (first time only, may take a minute)...");
    needsBuild = true;
  }

  if (needsBuild) {
    await buildImage(expectedSha);
    log.info("sandbox", "Sandbox image built.");
  }
}
