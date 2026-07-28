#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createVectorMcpServer } from "./server.js";

async function main(): Promise<void> {
  const { server } = await createVectorMcpServer();
  const transport = new StdioServerTransport();

  const close = async (): Promise<void> => {
    try {
      await server.close();
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        error: "VECTOR_MCP_CLOSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      })}\n`);
    }
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(143));
  });

  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    error: "VECTOR_MCP_START_FAILED",
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
});
