# MQ Studio Architecture

## Process model

```text
React UI (system WebView)              Agent (MCP client)
        │ Wails bindings                        │ JSON-RPC over stdin/stdout
internal/bridge                        internal/agent/mcpserver
        │                                       │
        ├──► internal/agent/assistant ──► internal/agent/toolset
        │    a model the window calls           │ the tools, any transport
        │                                       │
        └────────────► internal/service ◄───────┘
                              │             domain logic
                       internal/driver      one package per broker family
                              │
            broker admin APIs / local encrypted settings
```

Two adapters over one set of services. Neither is allowed to hold logic of its
own: the bridge reshapes for the renderer, the MCP server reshapes for a caller
that has no screen, and both delegate straight into `internal/service`. The
window's assistant is the MCP server's tools run for a model the window calls
itself, with the person on screen asked where the MCP server asks its client.

The window is a single process. The UI runs in the platform WebView (WKWebView
on macOS, WebView2 on Windows, WebKitGTK on Linux) and reaches Go through
generated bindings, so there is no local HTTP server, no auth token and no
child process to supervise.

The MCP server is the same binary started as `mq-studio mcp`, by the agent
client rather than by the window. It speaks over stdin and stdout, so it adds
no listening socket and no token either; what it is, to the window, is another
process reading the same files.

## The bridge layer

`internal/bridge` exposes one Wails service per domain. Its methods delegate
straight to `internal/service`, and it is the only place that reshapes data on
the way out:

- Stored AccessKey / SecretKey values never leave the Go process. The bridge
  replaces them with `accessKeyConfigured` / `secretKeyConfigured` flags.
- Connection and settings updates carry an explicit credential mode:
  `preserve`, `replace` or `clear`.
- Config file paths and plaintext exports stay in Go: `SystemService` owns the
  file dialogs, reads and writes the file, and returns only the chosen path.
- External links are checked against a host allowlist before being handed to
  the OS browser.

`wails3 generate bindings` writes the TypeScript for these services into
`frontend/bindings/`, typed directly from the Go structs. `npm run check` fails
if the committed bindings drift from the Go source.

## The MCP server

`internal/agent` is the agent-facing half, and it is two packages because they
answer different questions.

`catalog` describes the operations a connection can be asked to perform. The
capability model already says whether an endpoint can do a thing, which is all
the UI needs to gate a control; a caller composing the call itself also needs
to know what the operation takes, how much it can destroy, and which
family-specific keys travel inside the attribute map. The catalogue adds those
three columns and nothing else - request and result shapes stay named by type
in `internal/model` rather than restated, and each operation's capability is
the pairing `internal/service` already resolves before it calls in.

`toolset` turns that into tools: what each one is called and described as,
the schema it takes and answers in, the capability check before it reaches a
driver, and the words its answers and its questions to a person are given in.
It holds no transport. A tool is a typed handler behind a type-erased entry,
so a caller can check a model's raw arguments against the input schema and
run it (`Tool.Call`), and the schemas are inferred the way the MCP SDK infers
them, so a tool reads the same whichever transport offers it. How a transport
resolves a connection is its own choice: the MCP server dials what its process
has not opened, and without that the tools use only what is already open,
which is what a caller inside the window needs.

`mcpserver` offers those tools over MCP. How far it goes is decided when it is
started - `--allow read`, `mutate` or `destructive`, defaulting to read, and
higher on named connections with `--allow <name>=<tier>` - and anything above
the widest ceiling is left out of the tool list entirely rather than refused
when called. A tool above one connection's own ceiling is refused on it before
anything is dialled, by a check wrapped around the handler at registration that
reads the connection from the input the handler itself receives and holds off
the per-call refresh until the handler returns, so the check and the dial see
one profile. A name is resolved once, at startup, and its grant lapses if that
connection is later pointed at another broker or given other credentials
(`connection.Repointed`). Emptying and deleting are put to a person through the
client first - an MCP input request, elicitation on older clients - and the
answer is matched to its call by a one-time token the server holds; a client
that cannot ask is refused both. The protocol's own hints are derived from the
catalogue's blast radius, so a tool cannot be annotated read-only while the
catalogue calls it destructive.

Three rules follow from this process not owning the stored files. It assembles
its services through `app.NewReadOnly`, which neither samples on a timer nor
dials the default profile, because both of those write; and it dials through
`connection.Service.OpenReadOnly`, which resolves a profile exactly as Connect
does and records nothing. The profile store is rewritten whole under an
in-process lock, so a second writer would lose the window's edits rather than
merge with them. And it reads both files again before every tool call, through
`app.Services.RefreshReadOnly`: a connection saved in the window while an agent
is working is usable by the next call, and a client whose profile or global
credentials changed is redialled rather than kept.

The one file it does write is the audit log (`internal/agent/audit`). Every
call to a tool that writes is appended to `agent-audit.jsonl` in the data
directory - a start before the write is made, which is refused if the start
cannot be recorded, and an outcome after it. The window's assistant appends to
the same file, and nothing ever rewrites it whole, so there is nothing to race:
each record is a single append of one line, synced before the write it
announces.

`docs/AGENT_PLAN.md` carries the scope and the decisions behind it.

The window has an assistant of its own, which runs the same tools in its own
process (`docs/AGENT_IN_APP_PLAN.md`). What it runs on is set up in
Settings and kept in `agent.json`: the model services, each key encrypted with
the same `secret.key` as the connection secrets and bound to the service it
belongs to, and how writes are treated. It is not in `settings.json`, which the
renderer reads redacted, the export writes in plain text and the MCP process
re-reads before every call; only the window reads it, the bridge sends a key in
and never back out, and an export can never be written over it.
`internal/agent/provider` reaches the services: the Messages API through the
official SDK, and the OpenAI-compatible protocol over plain HTTP. Neither takes
anything from the environment - no key, base URL or header that another tool
exported - so a call carries only what was configured in the window.

`internal/agent/assistant` runs the conversations, one run at a time in the
whole window. A conversation is a list of items - what the person said, the
model's text and thinking, each tool call and what came of it - and every
change to one reaches the renderer as a numbered `agent:event`, so a renderer
that missed one asks for a snapshot instead of guessing. Reads run at once. A
write waits for the person to approve it, once or for the conversation, and a
destruction is confirmed every time with the MCP server's question; both are
recorded in the MCP server's audit log, with how they were let through. The
tools reach only the connections the window has open: a dial from there would
record no status and queue behind the person's own connects. The renderer draws
the conversation in a dock beside the page (`frontend/src/design/agent`),
folding the events into its copy with a reducer that a snapshot can always
replace, and nothing is sent to a model service the person has not agreed to.
Conversations are kept in `agent/sessions`, one file each and an index, all
encrypted with `secret.key`, for as many days as the person chose. A
conversation keeps the model service's own history, so one taken up again
after a restart carries on exactly where it stopped.

## Frontend seams

The UI never calls a binding directly. Two modules sit in between:

- `frontend/src/api/*.ts` wraps each bound service and is the only place that
  knows the binding shapes.
- `frontend/src/api/models.ts` re-exports the generated domain types under the
  vocabulary the pages use, including friendlier names for the generated enums.

Window chrome (minimise, maximise, close, drag regions) is driven by the Wails
window runtime from the frontend; only the native background colour, which has
to stay in step with the light/dark theme, goes through a Go service.

## macOS title bar

The renderer paints the title bar itself, so the native traffic lights have to
line up with it. Wails exposes no equivalent of Electron's
`trafficLightPosition`, so `internal/macwindow` moves the standard window
buttons through a small Objective-C shim. AppKit rebuilds the themed frame on
resize and when leaving fullscreen, which resets the buttons, so the shim keeps
a positioner attached to the window and re-applies the offset on those
notifications. It leaves the buttons alone while the window is fullscreen,
where AppKit owns them.

The geometry lives in two places that must agree: `titleBarHeight` and
`trafficLightLeft` in `main.go`, and the `.tb2` / `.tb2--mac` rules in
`frontend/src/design/tokens.css`, which keep the title bar clear of the
buttons instead of drawing stand-ins for them.

## Repository layout

```text
main.go                  Wails application entrypoint
internal/
  bridge/                Wails services exposed to the frontend
  app/                   Service wiring
  service/               Domain services, one package per domain
  driver/                The broker seam: ports, capabilities, conformance
    rocketmq/            RocketMQ driver
    rabbitmq/            RabbitMQ driver
    kafka/               Kafka driver
    pulsar/              Pulsar driver
    redisstream/         Redis Stream driver
    mqtt/                MQTT driver, with emqx/ for the vendor management API
    nats/                NATS driver, JetStream and the $SYS account
    activemq/            ActiveMQ driver: Classic and Artemis over Jolokia
    nsq/                 NSQ driver: nsqd and nsqlookupd over HTTP
    sqs/                 Amazon SQS driver: the AWS API, with no address to dial
    googlepubsub/        Google Pub/Sub driver: topics and subscriptions, no address
    azureservicebus/     Azure Service Bus driver: AMQP for messages, Atom for topology
    kinesis/             Amazon Kinesis driver: streams and shards, with no address to dial
    ibmmq/               IBM MQ driver: the mqweb server's two REST interfaces, no wire client
    solace/              Solace driver: SEMP v2, and REST messaging on its own port
  model/                 Domain models and the capability vocabulary
  crypto/                Local encryption helpers
  storage/               On-disk layout and atomic writes
  update/                In-app updater: check, download, verify, install
  macwindow/             Native macOS chrome Wails does not expose (cgo)
  tray/                  System tray
frontend/
  bindings/              Generated TypeScript bindings (committed)
  src/api/               Binding wrappers, domain types, platform access
  src/components/        shadcn/ui primitives and the app composites over them
  src/design/            The shell, the page registry, and every board
  src/hooks/             React hooks / providers
  src/mq/                Per-family attribute readers, navigation, capabilities
  src/lib/               Pure helpers: formatting, alert rules, storage
  src/i18n/              Locale bundles, zh and en
  src/styles/            Global CSS and early theme bootstrap
build/                   Wails build assets and per-platform Taskfiles
scripts/                 Version check, e2e seeds, packaging asset generators
tests/
  e2e/rocketmq/          RocketMQ e2e environment
  e2e/rocketmq-acl/      RocketMQ with ACL on, for the access-control tests
  e2e/rabbitmq/          RabbitMQ with the optional plugins on
  e2e/rabbitmq-plain/    RabbitMQ with none of them, for the degraded paths
  e2e/kafka/             Three-broker KRaft cluster
  e2e/kafka-secure/      Kafka with SASL and an authorizer
  e2e/pulsar/            Pulsar standalone with the admin API
  e2e/redis/             Redis standalone with ACL users
  e2e/redis-cluster/     Redis in cluster mode, for the multi-master paths
  e2e/mqtt/              Mosquitto: a $SYS tree and no management API
  e2e/mqtt-emqx/         EMQX: a management API and no readable $SYS
  e2e/nats/              Three-server NATS cluster with JetStream and $SYS
  e2e/nats-plain/        NATS with neither, for the degraded paths
  e2e/activemq/          ActiveMQ Artemis with its console and AMQP acceptor
  e2e/activemq-classic/  ActiveMQ Classic, the family's other product
  e2e/nsq/               Two nsqd and two nsqlookupd, with a consumer attached
  e2e/sqs/               LocalStack running sqs, reached through the endpoint override
  e2e/google-pubsub/     Google's own Pub/Sub emulator, reached through the host option
  e2e/azure-servicebus/  Microsoft's Service Bus emulator, and the SQL Server it needs
  e2e/kinesis/           LocalStack running kinesis, on a port of its own beside sqs
  e2e/ibmmq/             IBM's own developer queue manager, and the mqweb server beside it
  e2e/solace/            Solace PubSub+ Standard, the vendor's own free edition
  throughput-load/       Load generator for the throughput charts (own module)
```

## Build

`Taskfile.yml` drives everything through the `wails3` CLI: `wails3 task dev` for
hot reload, `wails3 task build` for a binary, `wails3 task package` for a
distributable. The app version lives in `package.json` and is injected into the
binary with `-ldflags "-X main.version=..."`.

Bumping it means editing `package.json`, both lockfiles, `frontend/package.json`
and `info.version` in `build/config.yml`, then running
`wails3 task common:update:build-assets` to regenerate the committed platform
manifests. Those manifests are what the packaged artifacts declare to the OS, so
`npm run check:version` verifies them too and names any that are stale.

The app id is `com.mqstudio.app` and the user data directory is `mq-studio`.
Both were renamed along with the app, and nothing carries pre-rename data
across: an install that predates the rename keeps its own directory untouched
and MQ Studio starts empty. Copying those files over by hand does not help
either, because `crypto.hkdfInfoPrefix` feeds key derivation and was renamed
too, so the stored `ENC:` values no longer decrypt.

`.github/workflows/ci.yml` runs the same gate on pushes and pull requests, but
splits it across jobs that run at the same time: the frontend build and tests
need neither Go nor Docker, the static checks are the only thing that needs the
GTK headers, and the live suites are sharded one job per broker family, each
starting only its own compose stacks.

That last split is not free. `MQ_STUDIO_E2E_FAMILIES` tells `internal/e2e`
which families a shard is responsible for, and the ones it does not name skip -
so a test can now go unrun without anything turning red, which is how issue #48
went unnoticed. Two things stop that. `TestEveryFamilyHasACIShard` pins
`e2e.AllFamilies` against the workflow's shard matrix, and the `coverage` job
runs `scripts/ci-coverage.mjs` over every shard's `go test -json` output to
assert that each test passed in at least one of them. A skip only counts as
deliberate if it did not come from the gate, which is what `e2e.SkipMarker`
distinguishes. `package` waits on that job, so an artifact is never produced
from a run that tested less than it should have.

`release.yml` packages a tag. Its runner matrix follows what each platform needs
to compile: macOS builds both slices from one SDK and joins them with `lipo`,
Windows cross-compiles both architectures from one runner because it does not
need cgo, and Linux does, so each architecture gets a runner of its own.
