### **The Definitive 2025 TypeScript Tech Stack**

The philosophy remains: **Everything is a file.** The state of your project is declarative, version-controlled, and instantly reproducible. Following Matt Pocock's type-safe patterns: **Make impossible states impossible.**

| Category | The Latest & Greatest Tooling |
| :--- | :--- |
| **1. Runtime & Package Manager** | **`Bun`**: The all-in-one JavaScript runtime. Replaces Node.js, npm/yarn/pnpm. Lightning-fast startup, built-in TypeScript, testing, and bundling. Native SQLite, WebSockets, and .env support. |
| **2. Type System** | **TypeScript 5.5+**: With `strict: true`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. Use type predicates, branded types, and const assertions everywhere. |
| **3. Web/API Framework** | **Hono**: Ultra-fast, type-safe, edge-first framework. Works everywhere (Bun, Node, Cloudflare Workers). Built-in RPC mode for end-to-end type safety. |
| **4. Data Validation & Contracts** | **Zod**: Schema-first validation with TypeScript inference. Use `z.infer<>` for automatic type generation. Integrates perfectly with Hono for request/response validation. |
| **5. Data Layer** | **PostgreSQL** • **Drizzle ORM** (fully type-safe, SQL-like) • **Drizzle Kit** (for migrations). Alternative: **Kysely** for query builder purists. |
| **6. Cache / Queue** | **Valkey**: Open-source Redis successor. Use with **BullMQ** for type-safe job queues with Zod schemas for job payloads. |
| **7. Code Quality** | **Biome**: Single tool for linting, formatting, and import sorting. Faster than ESLint + Prettier combined. Zero config, sensible defaults. |
| **8. Testing Suite** | **Bun Test**: Built into Bun, Jest-compatible but 10x faster. **Vitest** as alternative for complex scenarios. **fast-check** for property-based testing. |
| **9. Observability** | **OpenTelemetry SDK**: With Hono middleware for automatic tracing. Export to **Jaeger** or **Tempo** for distributed tracing. |
| **10. Deployment** | **Docker**: Multi-stage builds with `bun install --frozen-lockfile`. Deploy to **Fly.io**, **Railway**, or **Cloudflare Workers** (Hono's native environment). |
| **11. Monorepo Tools** | **Turborepo**: For build orchestration. **Changesets** for versioning. Keep it simple - Bun workspaces handle most needs. |

---

### **Type-Safe Patterns (The Matt Pocock Way)**

```typescript
// 1. Branded Types for Domain Modeling
type UserId = string & { __brand: "UserId" }
type Email = string & { __brand: "Email" }

const createUserId = (id: string): UserId => {
  if (!id.match(/^user_[a-z0-9]{8}$/)) {
    throw new Error("Invalid user ID format")
  }
  return id as UserId
}

// 2. Const Assertions for Literals
const ROLES = ["admin", "user", "guest"] as const
type Role = typeof ROLES[number] // "admin" | "user" | "guest"

// 3. Type Predicates for Narrowing
const isError = <T>(result: T | Error): result is Error => {
  return result instanceof Error
}

// 4. Result Types (No Exceptions)
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E }

// 5. Exhaustive Switch with Never
type Action = 
  | { type: "INCREMENT"; by: number }
  | { type: "DECREMENT"; by: number }
  | { type: "RESET" }

const reducer = (action: Action): number => {
  switch (action.type) {
    case "INCREMENT": return action.by
    case "DECREMENT": return -action.by
    case "RESET": return 0
    default: {
      const _exhaustive: never = action
      throw new Error(`Unhandled action: ${JSON.stringify(action)}`)
    }
  }
}
```

---

### **Project Configuration (`bun.toml` + `biome.json`)**

**bun.toml:**
```toml
# Bun configuration
[install]
# Always use exact versions
exact = true
# Deterministic installs
frozenLockfile = true

[test]
# Test configuration
root = "./src"
coverage = true
coverageThreshold = 0.8

[run]
# Auto-install when running scripts
autoInstall = true
```

**biome.json:**
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.3/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noImplicitAnyLet": "error",
        "useAwait": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useConst": "error",
        "useTemplate": "error",
        "useNodejsImportProtocol": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error",
        "useExhaustiveDependencies": "error"
      },
      "complexity": {
        "noBannedTypes": "error",
        "noStaticOnlyClass": "error",
        "noThisInStatic": "error"
      },
      "performance": {
        "noAccumulatingSpread": "error",
        "noDelete": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "formatWithErrors": false,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "jsxQuoteStyle": "double",
      "semicolons": "asNeeded",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "files": {
    "ignore": ["node_modules", "dist", ".turbo", "coverage"]
  }
}
```

**tsconfig.json:**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    // Type Safety: Matt Pocock's Strict Config
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    
    // Module Resolution
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    
    // Emit Configuration
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    
    // Path Aliases
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/test/*": ["./test/*"]
    },
    
    // Type Roots
    "types": ["bun-types"],
    
    // JSX (if needed)
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### **Skeleton Commands (The Developer Workflow)**

This is the complete lifecycle, from project creation to daily work.

*   **Initialize a New Project:**
    `bun init` (creates package.json, tsconfig.json, and basic structure)
*   **Install Dependencies:**
    *   Add a production dependency: `bun add hono zod drizzle-orm`
    *   Add a development dependency: `bun add -d @types/bun vitest`
    *   Remove a dependency: `bun remove package-name`
*   **Install All Dependencies from Lockfile:**
    `bun install --frozen-lockfile`
*   **Update Dependencies:**
    `bun update` (updates all to latest within semver range)
*   **Run Scripts:** (Defined in package.json)
    *   Start dev server: `bun run dev`
    *   Run tests: `bun test`
    *   Type check: `bun run typecheck`
    *   Lint and format: `bun run check`
*   **Direct Execution:** (No build step needed)
    `bun run src/index.ts`
*   **Bundle for Production:**
    `bun build src/index.ts --outdir=dist --minify`

---

### **Package.json Scripts**

```json
{
  "name": "orgmem-ts",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "test:coverage": "bun test --coverage",
    "typecheck": "tsc",
    "lint": "biome check --write .",
    "format": "biome format --write .",
    "check": "biome check . && tsc",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun run src/db/migrate.ts",
    "db:studio": "drizzle-kit studio",
    "build": "bun build src/index.ts --outdir=dist --minify --sourcemap",
    "clean": "rm -rf dist coverage .turbo"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "zod": "^3.23.0",
    "drizzle-orm": "^0.32.0",
    "postgres": "^3.4.0",
    "@hono/zod-validator": "^0.2.0",
    "@hono/zod-openapi": "^0.14.0",
    "bullmq": "^5.0.0",
    "@opentelemetry/sdk-node": "^0.49.0",
    "@opentelemetry/auto-instrumentations-node": "^0.44.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@biomejs/biome": "^1.9.3",
    "drizzle-kit": "^0.23.0",
    "fast-check": "^3.19.0",
    "vitest": "^2.0.0"
  }
}
```

---

### **Test Execution Pattern (Critical for Executors)**

The correct way to run tests with Bun:

*   **Run all tests:**
    `bun test`
*   **Run tests in specific directory:**
    `bun test src/features/`
*   **Run a specific test file:**
    `bun test src/features/auth/auth.test.ts`
*   **Run tests matching a pattern:**
    `bun test --test-name-pattern "should validate email"`
*   **Run with watch mode:**
    `bun test --watch`
*   **Run with coverage:**
    `bun test --coverage`
*   **Run with bail on first failure:**
    `bun test --bail`

**Test File Pattern:**
```typescript
import { describe, expect, test, beforeEach, mock } from "bun:test"
import { z } from "zod"

// Type-safe test factories
const createUser = (overrides?: Partial<User>): User => ({
  id: "user_12345678" as UserId,
  email: "test@example.com" as Email,
  role: "user" as const,
  ...overrides,
})

describe("User Service", () => {
  beforeEach(() => {
    // Reset mocks
  })

  test("should validate user creation", () => {
    const UserSchema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(["admin", "user", "guest"]),
    })

    const result = UserSchema.safeParse({
      email: "test@example.com",
      password: "securepassword",
      role: "user",
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe("test@example.com")
    }
  })

  test("property: all valid emails should pass validation", () => {
    // Property-based testing with fast-check
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const result = EmailSchema.safeParse(email)
        return result.success === true
      })
    )
  })
})
```

**IMPORTANT**: Do NOT use:
- ❌ `jest tests/` (wrong test runner)
- ❌ `npm test` (wrong package manager)
- ❌ `node test.js` (wrong runtime)

**Always use**: `bun test <file_path>` or just `bun test`

---

### **Type-Safe API with Hono + Zod**

```typescript
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"

// Define schemas with inference
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user", "guest"]).default("user"),
})

const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.string().datetime(),
})

// Infer types from schemas
type CreateUserInput = z.infer<typeof CreateUserSchema>
type UserResponse = z.infer<typeof UserResponseSchema>

// Create type-safe API
const app = new Hono()

app.post(
  "/users",
  zValidator("json", CreateUserSchema),
  async (c) => {
    const data = c.req.valid("json") // Type: CreateUserInput
    
    // Business logic here
    const user: UserResponse = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
    }
    
    return c.json(user, 201) // Type-checked response
  }
)

// Export type-safe client
export type AppType = typeof app
```

---

### **Database Layer with Drizzle**

```typescript
import { drizzle } from "drizzle-orm/postgres-js"
import { pgTable, text, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core"
import postgres from "postgres"

// Define enums
export const roleEnum = pgEnum("role", ["admin", "user", "guest"])

// Define schema (source of truth for types)
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// Infer types from schema
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// Create connection
const sql = postgres(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema: { users } })

// Type-safe queries
export const userRepository = {
  findById: async (id: string): Promise<User | undefined> => {
    const result = await db.select().from(users).where(eq(users.id, id))
    return result[0]
  },
  
  create: async (data: NewUser): Promise<User> => {
    const result = await db.insert(users).values(data).returning()
    return result[0]
  },
  
  findByEmail: async (email: string): Promise<User | undefined> => {
    const result = await db.select().from(users).where(eq(users.email, email))
    return result[0]
  },
}
```

---

### **Deployment with Docker**

**Dockerfile:**
```dockerfile
# Bun official image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Build application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run typecheck
RUN bun test
RUN bun build src/index.ts --outdir=dist --minify

# Production image
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 bunjs

# Copy built application
COPY --from=builder --chown=bunjs:nodejs /app/dist ./dist
COPY --from=deps --chown=bunjs:nodejs /app/node_modules ./node_modules

USER bunjs
EXPOSE 3000
ENV NODE_ENV=production

CMD ["bun", "run", "dist/index.js"]
```

---

### **CI/CD with GitHub Actions**

**.github/workflows/ci.yml:**
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install --frozen-lockfile
      
      - name: Type check
        run: bun run typecheck
      
      - name: Lint and format check
        run: bun run check
      
      - name: Run tests
        run: bun test --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info

  build:
    needs: quality
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Build Docker image
        run: docker build -t app:latest .
      
      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker tag app:latest ${{ secrets.DOCKER_USERNAME }}/app:latest
          docker push ${{ secrets.DOCKER_USERNAME }}/app:latest
```

---

### **Minimal SLOs & Policies**

- **SLI latency**: p95 `< 100ms` on `/api/*` (Bun is fast!)
- **Availability**: `99.9%`
- **Error budget policy**: Freeze feature deploys if budget < 25% until recovered
- **Type coverage**: Minimum 95% type coverage (measured by `tsc --noEmit`)
- **Test coverage**: Minimum 80% line coverage

---

### **Fit with 6E → CLARITY**

- **Edges**: API contracts defined with Zod schemas, validated at runtime
- **Constraints**: MUST/MUST-NOT encoded in types and Biome rules
- **Boundaries**: Module boundaries enforced through barrel exports
- **Assumptions**: Documented with type assertions and runtime checks
- **Dependencies**: Explicit in package.json with exact versions
- **Exceptions**: Handled with Result types, no throw in business logic
- **Traceability**: OpenTelemetry traces + type-safe logging with structured data
