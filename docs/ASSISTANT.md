# The assistant

[简体中文](ASSISTANT.zh-CN.md)

Press <kbd>⌘J</kbd> (<kbd>Ctrl+J</kbd> on Windows and Linux) and an assistant opens beside the
page you are on. Ask it why a group is behind, where the dead letters came from, or whether the
cluster is healthy: it reads the broker through the same tools the [MCP server](MCP.md) offers,
answers from what it found, and changes nothing until you approve it. It runs on a model service
you choose - a hosted one, or one on this machine.

## Set it up

Settings → Assistant → **Add a model service**:

| Kind | What it reaches |
| --- | --- |
| Anthropic | The Messages API, through its official SDK. Needs an API key. |
| OpenAI-compatible | Anything speaking chat completions: OpenAI, DeepSeek, Qwen (compatible mode), Kimi, Zhipu, SiliconFlow, OpenRouter - and Ollama or LM Studio on this machine, which need no key. |

Fill in the base URL where it is not the service's own, then pick the model from **Fetch list** or
type its id. **Test** sends one small request that carries a tool, so a model that cannot call
tools is caught here rather than in your first question. Under **Advanced** are a proxy for this
service alone (otherwise `HTTPS_PROXY` applies) and, for Anthropic, letting a declined request be
answered by another model - turn it off when the base URL is a gateway that does not pass it on.

The key is encrypted on this machine with the key the connection secrets use. The page only ever
shows whether one is set, an export never carries it, and nothing is read from environment
variables: a call carries only what you configured here.

## Before anything is sent

The first time you use a model service, the dock says what will go to it - your questions, the
context of the page you are on, and the cluster data the tools read, message bodies included as
far as Settings allows - and where. Nothing is sent until you agree, once per service.

## Ask

- **Open it** from the title bar, with <kbd>⌘J</kbd>, or from the command palette: type the
  question after <kbd>⌘K</kbd> and choose **Ask the assistant**.
- **It knows where you are.** The connection, the page, the namespace and whatever the page's
  detail panel has open go with the next message, shown as chips above the input. Remove any you
  would rather leave out.
- **Reads run at once.** They fold into one line, *Called 3 tools*, that opens to each call's
  arguments and answer.
- **It uses the connections open in the window.** It never connects on its own; when a tool says a
  connection is not open, connect it in the window.
- **Stop** ends a run. A run that failed, was stopped, or reached the 25-tool limit can be retried
  or carried on from its last line.

## Writes wait for you

- **Creating, publishing, resending and moving a read position** stop on a card that names the
  connection, the arguments and what the connection says the change leaves behind. Approve it
  once, or for the rest of the conversation. A no is final: the model is told so.
- **Emptying and deleting** are confirmed every time, with the question the MCP server asks - the
  destination, its connection, how many messages it holds - and cannot be approved in advance.
- **Read only** (Settings → Assistant) offers the model no write at all.
- **Every write is recorded** in `agent-audit.jsonl`, the same log the MCP server writes, with how
  it was let through: once, for the conversation, or confirmed.

Tool results are treated as data from the broker. Whatever a message body says, it is never an
instruction, and every write still waits for you.

## Conversations

The clock in the dock's header opens your conversations, by the day each last changed: search
them, take one up again, rename it, export it as Markdown, or delete it. A conversation carries on
with the model service and model it began on.

They are kept encrypted on this machine, for 30 days by default. Settings → Assistant offers 7 or
90 days, or keeping none - which deletes the ones kept so far - and **Clear conversations**.

## What leaves the machine

Only what a conversation needs: your messages, their context, and what the tools read. Each tool
result is cut at 32 KB, and message bodies at the size Settings allows (none, 2, 8 or 32 KB). With
a model on this machine, such as Ollama or LM Studio, nothing leaves it at all.

## When it fails

A failed run says why, in the words the settings test uses:

| Reason | What to check |
| --- | --- |
| The key was refused | The key, and that it belongs to this base URL |
| No such model | The model id, or that the base URL is the service itself |
| The request was refused | That the model calls tools; through a gateway, turn off the fallback under Advanced |
| Rate limited, or the service failed | Wait and retry - requests are retried twice before this |
| Could not reach the service | The address, and the proxy |

How it is built, and why, is in [AGENT_IN_APP_PLAN.md](AGENT_IN_APP_PLAN.md) (in Chinese) and
[ARCHITECTURE.md](ARCHITECTURE.md).
