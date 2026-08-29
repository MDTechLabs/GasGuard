import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth";

@Controller()
export class AppController {
  /**
   * Root endpoint - API info
   * Public endpoint for API discovery
   */
  @Public()
  @Get()
  getRoot(): { name: string; version: string; health: string } {
    return {
      name: "GasGuard API",
      version: "0.1.0",
      health: "/health",
    };
  }

  /**
   * Health check endpoint
   * Returns a simple status to verify the API is running
   * Public endpoint for monitoring and load balancers
   */
  @Public()
  @Get("health")
  getHealth(): { status: string } {
    return { status: "ok" };
  }
}
