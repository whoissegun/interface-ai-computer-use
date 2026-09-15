export type SurfaceArguments = Record<string, unknown>;

export type SurfaceTool = {
  name: string;
  description?: string;
  inputSchema: SurfaceArguments;
};

export type SurfaceToolResult = SurfaceArguments & {
  content?: unknown[];
  isError?: boolean;
};

export interface SurfaceClient {
  connect(): Promise<void>;
  listTools(): Promise<SurfaceTool[]>;
  callTool(name: string, args: SurfaceArguments): Promise<SurfaceToolResult>;
  close(): Promise<void>;
}
