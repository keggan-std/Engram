import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
        testTimeout: 10000,
        // P3: Suppress INFO migration spam that pollutes test output.
        // Migrations run 15 steps per beforeEach — only show warnings+.
        env: {
            ENGRAM_LOG_LEVEL: "warn",
        },
        coverage: {
            // Run with: npm run test:coverage
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            exclude: ["src/index.ts", "src/scripts/**", "src/modes/**"],
            // P4: Enforce minimum coverage on the repository layer.
            thresholds: {
                "src/repositories/**": {
                    statements: 75,
                    branches: 65,
                    functions: 75,
                    lines: 75,
                },
            },
        },
    },
});
