# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security issues seriously. Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately by emailing:

**security@longcelot.com** (or open a [GitHub Security Advisory](https://github.com/vannseavlong/longcelot-sheet-staging/security/advisories/new))

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations (optional)

### What to expect

- Acknowledgement within **48 hours**
- A status update within **7 days**
- A fix (or documented mitigation) within **30 days** for confirmed issues

We will credit you in the CHANGELOG unless you prefer to remain anonymous.

## Scope

This package uses Google OAuth2 tokens and interacts with Google Sheets. Please report issues related to:

- OAuth token handling or storage
- Permission bypass in `SheetAdapter`
- Data injection via schema or CRUD operations
- Credential exposure in logs or error messages

## Out of Scope

- Vulnerabilities in Google's own APIs
- Issues in your own application code that uses this package
- Social engineering attacks
