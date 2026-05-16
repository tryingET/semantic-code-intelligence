# GitHub Branch Protection Setup

This document provides the recommended branch protection rules and GitHub settings for the Ontology-LSP project.

## Branch Protection Rules

### Main Branch (main)

Navigate to: **Settings** → **Branches** → **Add rule**

**Branch name pattern:** `main`

#### Protection Settings

✅ **Require a pull request before merging**
- Require approvals: `1`
- ✅ Dismiss stale PR approvals when new commits are pushed
- ✅ Require review from code owners (if CODEOWNERS file exists)
- ✅ Restrict pushes that create files matching patterns (if needed)

✅ **Require status checks to pass before merging**
- ✅ Require branches to be up to date before merging
- Required status checks:
  - `Code Quality & Testing / quality`
  - `Build Production Artifacts / build`
  - `Test Unified Server Architecture / test-server`
  - `Test VS Code Extension / test-extension`
  - `Security Audit / security-audit` (from security.yml)
  - `CodeQL Security Analysis / codeql` (from security.yml)

✅ **Require conversation resolution before merging**

✅ **Require signed commits** (recommended for security)

✅ **Require linear history** (optional - keeps git history clean)

✅ **Include administrators** (applies rules to admins too)

### Development Branch (unified-core-architecture)

**Branch name pattern:** `unified-core-architecture`

#### Protection Settings

✅ **Require a pull request before merging**
- Require approvals: `1`
- ✅ Dismiss stale PR approvals when new commits are pushed

✅ **Require status checks to pass before merging**
- ✅ Require branches to be up to date before merging
- Required status checks:
  - `Test Unified Server Architecture / test-server`
  - `Test VS Code Extension / test-extension`
  - `Advanced Integration Tests / advanced-tests` (allowed to fail)

✅ **Include administrators**

## Repository Settings

### General Settings

Navigate to: **Settings** → **General**

#### Features
- ✅ Wikis (for documentation)
- ✅ Issues (for bug tracking and feature requests)
- ✅ Sponsorships (if applicable)
- ✅ Preserve this repository (for important projects)
- ✅ Projects (for project management)

#### Pull Requests
- ✅ Allow merge commits
- ✅ Allow squash merging
- ✅ Allow rebase merging
- ✅ Always suggest updating pull request branches
- ✅ Allow auto-merge
- ✅ Automatically delete head branches

### Security Settings

Navigate to: **Settings** → **Code security and analysis**

#### Security Features
- ✅ Dependency graph
- ✅ Dependabot alerts
- ✅ Dependabot security updates
- ✅ Dependabot version updates (create `.github/dependabot.yml`)
- ✅ Code scanning (CodeQL)
- ✅ Secret scanning
- ✅ Secret scanning push protection

### Actions Settings

Navigate to: **Settings** → **Actions** → **General**

#### Actions Permissions
- ✅ Allow enterprise, and select non-enterprise, actions and reusable workflows
  - ✅ Allow actions created by GitHub
  - ✅ Allow actions by Marketplace verified creators
  - ✅ Allow specified actions and reusable workflows:
    - `oven-sh/setup-bun@*`
    - `actions/setup-node@*`
    - `docker/build-push-action@*`
    - `codecov/codecov-action@*`

#### Workflow Permissions
- ✅ Read and write permissions
- ✅ Allow GitHub Actions to create and approve pull requests

### Secrets and Variables

Navigate to: **Settings** → **Secrets and variables** → **Actions**

#### Repository Secrets (Required)
- `CODECOV_TOKEN` - For code coverage reports
- `GITHUB_TOKEN` - Automatically provided by GitHub
- `DOCKER_REGISTRY_TOKEN` - For Docker image publishing (if using external registry)

#### Repository Secrets (Optional - for advanced deployment)
- `SLACK_WEBHOOK_URL` - For deployment notifications
- `KUBECONFIG_STAGING` - Base64 encoded kubeconfig for staging deployment
- `KUBECONFIG_PRODUCTION` - Base64 encoded kubeconfig for production deployment
- `VSCODE_MARKETPLACE_TOKEN` - For VS Code extension publishing
- `OVSX_TOKEN` - For Open VSX extension publishing

#### Repository Variables
- `BUN_VERSION` = `1.2.20`
- `NODE_VERSION` = `20`
- `DOCKER_REGISTRY` = `ghcr.io`

## Environments

Navigate to: **Settings** → **Environments**

### Staging Environment
- **Name:** `staging`
- **Protection rules:**
  - Required reviewers: 1 reviewer from team
  - Wait timer: 0 minutes
  - Required branches: `main`, `unified-core-architecture`

### Production Environment
- **Name:** `production`
- **Protection rules:**
  - Required reviewers: 2 reviewers from core team
  - Wait timer: 5 minutes (cooling-off period)
  - Required branches: `main` only
- **Environment secrets:**
  - Production-specific database URLs, API keys, etc.

## Code Owners (Optional)

Create `.github/CODEOWNERS` file:

```
# Global owners
* @your-username @core-team-member

# Core architecture
/src/core/ @core-architect @lead-developer
/src/adapters/ @protocol-expert
/tests/ @qa-lead

# Infrastructure
/.github/ @devops-lead
/k8s/ @devops-lead
/Dockerfile @devops-lead

# VS Code extension
/vscode-client/ @extension-expert

# Documentation
*.md @docs-maintainer
```

## Issue Templates

Create issue templates in `.github/ISSUE_TEMPLATE/`:
- Bug report template
- Feature request template
- Documentation improvement template
- Performance issue template

## Pull Request Template

Create `.github/pull_request_template.md` with checklist:
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Performance impact assessed
- [ ] Breaking changes documented

## Status Badge Configuration

Add these badges to your README.md:

```markdown
[![CI](https://github.com/your-username/ontology-lsp/workflows/CI/badge.svg)](https://github.com/your-username/ontology-lsp/actions/workflows/ci.yml)
[![CD](https://github.com/your-username/ontology-lsp/workflows/CD/badge.svg)](https://github.com/your-username/ontology-lsp/actions/workflows/cd.yml)
[![Security](https://github.com/your-username/ontology-lsp/workflows/Security%20&%20Dependencies/badge.svg)](https://github.com/your-username/ontology-lsp/actions/workflows/security.yml)
[![codecov](https://codecov.io/gh/your-username/ontology-lsp/branch/main/graph/badge.svg)](https://codecov.io/gh/your-username/ontology-lsp)
[![Docker](https://img.shields.io/docker/v/your-username/ontology-lsp?label=docker&logo=docker)](https://ghcr.io/your-username/ontology-lsp)
```

## Applying These Settings

1. **Repository Admin Required:** You need admin access to configure branch protection rules
2. **Team Setup:** Create GitHub teams for different review groups (core, qa, devops, etc.)
3. **Secrets Configuration:** Add required secrets through the GitHub web interface
4. **Environment Setup:** Configure staging/production environments if using deployment workflows
5. **Testing:** Create a test PR to verify all rules work correctly

## Notes

- Some advanced features require GitHub Pro/Team/Enterprise
- Adjust required status checks based on your workflow names
- Consider using GitHub Apps for enhanced security (instead of personal access tokens)
- Regular review and updates of branch protection rules as the project evolves