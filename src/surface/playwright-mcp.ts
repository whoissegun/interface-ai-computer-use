import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SurfaceArguments, SurfaceClient, SurfaceTool, SurfaceToolResult } from "./types.js";

const require = createRequire(import.meta.url);

export type PlaywrightMcpOptions = {
  outputDirectory: string;
  targetOrigin: string;
  headless: boolean;
  saveSession?: boolean;
  clientName?: string;
  onStderr?: (text: string) => void;
};

export class PlaywrightMcpClient implements SurfaceClient {
  private readonly client: Client;
  private transport: StdioClientTransport | undefined;

  constructor(private readonly options: PlaywrightMcpOptions) {
    this.client = new Client({
      name: options.clientName ?? "computer-use-harness",
      version: "0.1.0"
    });
  }

  async connect(): Promise<void> {
    const packageJson = require.resolve("@playwright/mcp/package.json");
    const cliPath = join(dirname(packageJson), "cli.js");
    const args = [
      cliPath,
      "--isolated",
      "--browser",
      "chrome",
      "--codegen",
      "none",
      "--image-responses",
      "allow",
      "--output-dir",
      this.options.outputDirectory,
      "--allowed-origins",
      this.options.targetOrigin,
      "--viewport-size",
      "1440x1000",
      "--timeout-action",
      "10000",
      "--timeout-navigation",
      "60000"
    ];
    if (this.options.saveSession !== false) args.push("--save-session");
    if (this.options.headless) args.push("--headless");

    this.transport = new StdioClientTransport({
      command: process.execPath,
      args,
      cwd: process.cwd(),
      stderr: "pipe",
      maxBufferSize: 25 * 1024 * 1024
    });
    this.transport.stderr?.on("data", (chunk: Buffer | string) => {
      this.options.onStderr?.(chunk.toString());
    });
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<SurfaceTool[]> {
    const tools: SurfaceTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : undefined);
      tools.push(
        ...page.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema as SurfaceArguments
        }))
      );
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: SurfaceArguments): Promise<SurfaceToolResult> {
    return (await this.client.callTool({ name, arguments: args })) as SurfaceToolResult;
  }

  async close(): Promise<void> {
    await this.client.close();
    this.transport = undefined;
  }
}
