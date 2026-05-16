# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub's [private vulnerability reporting](https://github.com/bkudria/craboodle/security/advisories/new).

Do **not** open a public issue for security reports. We will acknowledge receipt within 7 days and aim to respond with a fix or mitigation timeline within 30 days.

## Supported versions

Craboodle is pre-1.0 and under active development. Only the latest published version on npm receives security fixes.

## Privacy & data flow

Craboodle is an eval pipeline orchestrator. It does not call any LLM API directly; it shells out to [scuttlerun](https://github.com/bkudria/scuttlerun) (which calls Anthropic) and [pincenez](https://github.com/bkudria/pincenez) (which calls Anthropic) as subprocesses. Be aware of what is sent off your machine when running an eval pipeline:

- **Sent to Anthropic (via scuttlerun and pincenez)**: the contents of your scenario YAML files (prompts and synthetic-user oracle context) and the contents of any checks YAML files used for grading. See those projects' SECURITY.md for full data-flow details.
- **Not sent anywhere else**: craboodle has no telemetry, no analytics, and no remote logging. Results stream to stdout only.
- **Stored locally**: scenario transcripts and grading results land in the working directory under the configured output path. craboodle never writes outside that directory.
- **Credentials**: `ANTHROPIC_API_KEY` is read from your environment by scuttlerun and pincenez. Craboodle never reads or logs it.

If your scenarios or checks files contain sensitive data, treat each `craboodle run` invocation as transmitting that data to Anthropic. Review [Anthropic's data usage policies](https://www.anthropic.com/legal) before running pipelines on sensitive content.
