# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x (latest) | Yes |
| < 0.1 | No |

Only the latest minor version receives security patches. Upgrade to the latest version before reporting.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability, email: **oss@mail.igorjs.io**

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Impact assessment (what can an attacker do?)
- Suggested fix (if you have one)

### What to expect

- **Acknowledgement** within 48 hours
- **Assessment** within 7 days (severity, affected scope, fix plan)
- **Fix and disclosure** within 30 days for critical issues, 90 days for others

If the report is accepted, you will be credited in the release notes (unless you prefer anonymity).

If the report is declined (not a vulnerability, or out of scope), you will receive an explanation and may open a public issue.

### Scope

The following are in scope:
- SQL injection via query builder or raw SQL composition
- Connection string or credential exposure
- Migration runner executing unintended schema changes
- Denial of service via crafted query input

The following are out of scope:
- Vulnerabilities in database drivers (peer dependencies)
- Issues requiring physical access to the machine
- Social engineering attacks
- Issues in test files or development tooling

## Security Design Principles

- **Zero own dependencies** minimises supply chain risk
- **All errors are values** (Result/Option) prevents unhandled exceptions
- **Parameterised queries** by default: values are never interpolated into SQL strings
- **Immutable query AST** prevents accidental mutation of shared query objects
- **No eval, no dynamic require** in production code
