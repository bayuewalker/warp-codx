```markdown
# warp-codx Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `warp-codx` TypeScript codebase. It covers file organization, code style, commit practices, and testing patterns to help contributors write consistent, maintainable code.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myComponent.ts`, `userService.ts`

### Imports
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { helperFunction } from './utils';
    ```

### Exports
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // utils.ts
    export function helperFunction() { ... }
    ```

### Commit Messages
- Follow **Conventional Commits** with the `feat` prefix for new features.
  - Example:
    ```
    feat: add user authentication middleware
    ```
- Average commit message length: ~63 characters.

## Workflows

### Feature Development
**Trigger:** When adding a new feature or module  
**Command:** `/feature-development`

1. Create a new file using camelCase naming.
2. Write your TypeScript code, using relative imports and named exports.
3. Add or update corresponding test files matching `*.test.*` pattern.
4. Commit your changes using a conventional commit message with the `feat` prefix.
5. Open a pull request for review.

### Testing
**Trigger:** When validating code changes  
**Command:** `/run-tests`

1. Identify or create test files with the `*.test.*` naming pattern.
2. Run the test suite using the project's test runner (framework unknown; check project scripts).
3. Ensure all tests pass before merging or deploying changes.

## Testing Patterns

- Test files are named using the `*.test.*` pattern, e.g., `userService.test.ts`.
- The specific testing framework is unknown; refer to project documentation or scripts for details.
- Place tests alongside the code they cover or in a dedicated test directory as per project structure.

## Commands
| Command               | Purpose                                 |
|-----------------------|-----------------------------------------|
| /feature-development  | Start a new feature using conventions   |
| /run-tests            | Run the test suite                      |
```