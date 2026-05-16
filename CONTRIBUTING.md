# Contributing to Ontology LSP

Thank you for your interest in contributing to Ontology LSP! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Release Process](#release-process)

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive criticism
- Accept feedback gracefully
- Prioritize the project's best interests

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/yourusername/ontology-lsp.git
   cd ontology-lsp
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/originalowner/ontology-lsp.git
   ```

## Development Setup

### Prerequisites

- Bun v1.2.20 or higher
- VS Code (for extension development)
- Git

### Installation

1. Install dependencies:
   ```bash
   bun install
   ```

2. Build the project:
   ```bash
   just build
   ```

3. Run tests:
   ```bash
   just test
   ```

4. Start the development server:
   ```bash
   just dev
   ```

### VS Code Extension Development

1. Navigate to the extension directory:
   ```bash
   cd vscode-client
   bun install
   ```

2. Open VS Code in the extension directory:
   ```bash
   code .
   ```

3. Press F5 to launch a new VS Code window with the extension loaded

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates.

When creating a bug report, include:
- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- System information (OS, Bun version, VS Code version)
- Relevant logs or error messages

### Suggesting Enhancements

Enhancement suggestions are welcome! Please provide:
- A clear, descriptive title
- Detailed description of the proposed feature
- Use cases and benefits
- Possible implementation approach (if applicable)

### Code Contributions

1. **Find an Issue**: Look for issues labeled `good first issue` or `help wanted`
2. **Discuss**: Comment on the issue to discuss your approach
3. **Branch**: Create a feature branch from `develop`
4. **Implement**: Write your code following our coding standards
5. **Test**: Add tests for your changes
6. **Document**: Update documentation as needed
7. **Commit**: Use conventional commit messages
8. **Push**: Push your changes to your fork
9. **PR**: Open a pull request to the `develop` branch

## Pull Request Process

1. **Update your fork**:
   ```bash
   git fetch upstream
   git checkout develop
   git merge upstream/develop
   ```

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** and commit them:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

4. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Open a Pull Request** on GitHub

### PR Requirements

- All tests must pass
- Code must be linted (`bun run lint`)
- Documentation must be updated
- Commit messages follow conventional commits
- PR description clearly explains the changes

## Coding Standards

### TypeScript Style Guide

- Use TypeScript for all new code
- Enable strict mode
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer `const` over `let`
- Use async/await over promises
- Handle errors appropriately

### File Organization

```
src/
├── layers/          # Processing layers
├── ontology/        # Core ontology engine
├── patterns/        # Pattern learning
├── propagation/     # Knowledge propagation
├── types/           # TypeScript types
├── utils/           # Utility functions
├── api/             # HTTP API server
└── cli/             # CLI tool
```

### Commit Messages

Follow the Conventional Commits specification:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `test:` Test additions or fixes
- `chore:` Build process or auxiliary tool changes

Examples:
```
feat: add support for Go language parsing
fix: resolve memory leak in pattern learner
docs: update API documentation
```

## Testing Guidelines

### Unit Tests

- Write tests for all new functions
- Aim for >80% code coverage
- Use descriptive test names
- Test edge cases and error conditions

### Integration Tests

- Test layer interactions
- Test LSP protocol compliance
- Test VS Code extension functionality

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/ontology/ontology-engine.test.ts

# Run with coverage
bun test --coverage
```

## Documentation

### Code Documentation

- Add JSDoc comments for all public APIs
- Include parameter descriptions and return types
- Add usage examples for complex functions

### README Updates

Update the README when:
- Adding new features
- Changing installation steps
- Modifying configuration options
- Adding new commands

### API Documentation

Document all HTTP API endpoints with:
- Endpoint URL and method
- Request parameters/body
- Response format
- Example requests and responses

## Release Process

### Version Numbering

We use Semantic Versioning (MAJOR.MINOR.PATCH):
- MAJOR: Breaking changes
- MINOR: New features (backwards compatible)
- PATCH: Bug fixes

### Release Steps

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create a git tag:
   ```bash
   git tag -a v1.0.1 -m "Release version 1.0.1"
   ```
4. Push tag to trigger release workflow:
   ```bash
   git push upstream v1.0.1
   ```

## Questions?

If you have questions, please:
1. Check the [documentation](./docs/)
2. Search [existing issues](https://github.com/originalowner/ontology-lsp/issues)
3. Ask in [discussions](https://github.com/originalowner/ontology-lsp/discussions)
4. Open a new issue if needed

Thank you for contributing to Ontology LSP! 🎉