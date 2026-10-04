---
name: Workspace dependency installs
description: Package installation behavior in this pnpm monorepo.
---

Install new dependencies against the owning workspace package, not the workspace root. The Replit package installation helper attempted a root-level `pnpm add`, which pnpm rejected because the project is a workspace; a package-filtered install succeeded.

**Why:** Each package should declare its own runtime dependencies, and pnpm intentionally blocks accidental dependency additions at the workspace root.

**How to apply:** Create or inspect the target package first, then run `pnpm --filter @workspace/<package> add <dependency>`.