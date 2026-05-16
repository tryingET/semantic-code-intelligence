# Pull Request

## Description

<!-- Brief description of the changes in this PR -->

## Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 Documentation update
- [ ] 🔧 Maintenance/refactoring
- [ ] ⚡ Performance improvement
- [ ] 🧪 Test improvements
- [ ] 🏗️ Build/CI changes

## Related Issues

<!-- Link to related issues using "Fixes #123" or "Closes #123" -->
- Fixes #
- Related to #

## Changes Made

<!-- Detailed list of changes made -->
- 
- 
- 

## Testing

### Test Coverage
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated  
- [ ] Performance tests added/updated
- [ ] All existing tests still pass
- [ ] Test coverage maintained or improved

### Manual Testing
- [ ] Tested locally with development setup
- [ ] Tested with production build
- [ ] Tested VS Code extension functionality (if applicable)
- [ ] Tested all protocol adapters (LSP, MCP, HTTP) (if applicable)

### Test Commands Run
```bash
# List the test commands you ran
bun test
bun test tests/unified-core.test.ts
just build-prod
# etc.
```

## Performance Impact

- [ ] No performance impact
- [ ] Performance improved
- [ ] Performance impact assessed and acceptable
- [ ] Performance benchmarks updated

### Performance Notes
<!-- If there's performance impact, explain here -->

## Documentation

- [ ] Code is self-documenting with clear naming
- [ ] Comments added for complex logic
- [ ] README.md updated (if needed)
- [ ] API documentation updated (if applicable)
- [ ] Architecture docs updated (if needed)

## Breaking Changes

<!-- If this is a breaking change, describe the impact and migration path -->
- [ ] No breaking changes
- [ ] Breaking changes documented below

### Migration Guide
<!-- If breaking changes exist, provide migration instructions -->

## Checklist

### Code Quality
- [ ] Code follows project coding standards
- [ ] Biome linting passes (`bun run lint`)
- [ ] TypeScript compilation passes (`bun run build:tsc`)
- [ ] No console.log statements left in code
- [ ] Error handling implemented appropriately

### Architecture
- [ ] Changes align with unified core architecture
- [ ] Protocol adapters remain thin (if modified)
- [ ] Learning system integration considered (if applicable)
- [ ] Follows established patterns and conventions

### Security
- [ ] No hardcoded secrets or credentials
- [ ] Input validation implemented where needed
- [ ] Security implications considered
- [ ] Dependencies vetted for vulnerabilities

### Deployment
- [ ] Changes are backward compatible
- [ ] Database migrations included (if needed)
- [ ] Environment variables documented (if added)
- [ ] Docker build still works
- [ ] Kubernetes manifests updated (if needed)

## Screenshots/Videos

<!-- If the PR includes UI changes or new functionality, add screenshots or videos -->

## Additional Notes

<!-- Any additional information that reviewers should know -->

## Reviewer Focus Areas

<!-- Highlight specific areas where you'd like focused review -->
- 
- 
- 

---

### For Reviewers

**Review Checklist:**
- [ ] Code quality and architecture alignment
- [ ] Test coverage and correctness
- [ ] Performance implications
- [ ] Security considerations
- [ ] Documentation completeness
- [ ] Breaking change impact

**Testing Instructions:**
1. Pull the branch: `git checkout [branch-name]`
2. Install dependencies: `bun install`
3. Run tests: `bun test`
4. Test specific functionality: [add specific steps]

<!-- 
Template Usage Notes:
- Delete sections that aren't applicable
- Be specific in descriptions
- Reference issues and related PRs
- Include test evidence
- Consider the reviewer's perspective
-->