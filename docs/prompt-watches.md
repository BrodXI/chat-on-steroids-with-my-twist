# Completion-triggered prompts

The CoS Core `prompt_watch` tool lets a verified ChatGPT conversation schedule its own next message. A plan records steps; a watch records **when to resume**. All messages use the same durable browser outbox and Send authorization as Scheduled Messages. The watch never inserts text into ChatGPT directly.

## Watch types

- **`github_run`**: provide a GitHub Actions run URL (`https://github.com/owner/repo/actions/runs/12345`). CoS checks its status silently through the locally installed and authenticated GitHub CLI. Once GitHub reports `completed`, CoS queues one prompt containing the conclusion. `pollMinutes` defaults to one minute. Polling does *not* prompt ChatGPT. The URL must be an exact HTTPS run URL with no query string or credentials.
- **`exec_process`**: provide a running CoS `exec_command` `session_id`. Only its proven owning conversation can register the watch. CoS listens for that process generation's exit event, then queues a prompt with the exit code. No repeated model calls or terminal output consumption occurs. If CoS restarts and the process can no longer be verified, it reports an **unverified** exit rather than claiming success.
- **`signal`**: a local integration registers a named task and later signals its completion through the existing authenticated loopback API. The completion signal can only use `success`, `failure`, `cancelled`, or `unknown`. It cannot supply arbitrary new instructions: CoS sends only the prompt saved by the verified ChatGPT chat when the watch was created.
- **`interval`**: optional recurring messages every 1 to 1440 minutes. Use only if the user actually wants repeated prompts. A completion watch is preferable for long-running builds and CI.

Use `action=list` to inspect the current chat's watches and `action=cancel` with the exact returned watch ID to stop future checks. Cancelling a watch does not recall a prompt already in the authorized message queue.

## Local completion callback

In **Settings → Local control API**, enable **Local control API** and **Allow actions**. Both are disabled by default. This API binds only to `127.0.0.1`, rejects requests with an `Origin` header, and requires the per-launch private Bearer token from CoS's `control-api/token` file. Never copy that token into a ChatGPT message, remote CI log, or repository secret.

After ChatGPT registers a `signal` watcher, a trusted *local* integration can send:

```http
POST /v1/watches/<watch-uuid>/complete
Authorization: Bearer <local-control-api-token>
Content-Type: application/json

{"sessionId":"<verified-CoS-session-id>","result":"success"}
```

The `control-api/endpoint.json` file identifies the current loopback port. The token changes on every CoS launch. A 202 response records a new completion signal, while a 200 response reports an already-recorded signal; both are idempotent. CoS's local monitor queues the follow-up into the original chat, subject to normal user draft, browser availability and Send checks.

The local API does **not** accept public GitHub webhooks and should not be exposed to the Internet. For hosted CI, use the `github_run` status watcher or a trusted local bridge that can authenticate to the local API.

## Guarantees and limitations

- CoS must be running to observe a completion immediately; saved watches resume when it restarts. A scheduled browser message still requires an available ChatGPT browser/extension and obeys normal delivery safety fences.
- Each occurrence has a stable outbox ID. A crash between checking and queueing reuses that identity. An ambiguous Send is never blindly retried.
- Job status is not proof a build artifact is correct. The prompted model should inspect logs, tests, build outputs and artifacts before claiming success.
- A generic external job requires a completion signal, status endpoint, process handle or provider adapter. CoS cannot infer arbitrary task completion without one.
