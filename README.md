# @ai-agg-agg/client-opencode

[OpenCode](https://opencode.ai) client plugin for [`aaa`](https://github.com/ai-agg-agg/aaa).

Registers an `opencode` client with `aaa`'s plugin registry via an oclif `init` hook —
no core changes required. Manages agent-model configuration for OpenCode and
OMO (`oh-my-openagent`) config files.

## Install

```sh
aaa plugins:install @ai-agg-agg/client-opencode
```

or, from source:

```sh
bun add @ai-agg-agg/client-opencode
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OPENCODE_CONFIG` | `~/.config/opencode/opencode.json` | OpenCode main config |
| `OMO_CONFIG` | `~/.config/opencode/oh-my-openagent.json` | OMO agent definitions |

## What it provides

Implements the `Client` contract from `aaa`:

- `discoverSources()` — locates `opencode.json`, any plugin-referenced config files
  (`plugins[].config`), and `oh-my-openagent.json` if present
- `discoverPlugins()` — parses OpenCode's `plugins` array plus built-in agents
  (`build`, `plan`, `oracle`, `quick`) and OMO agent arrays, resolving each agent's
  current model
- `getCurrentModels()` — flat map of `plugin:agent` → model
- `applyAgentModel(agentName, modelKey, apiBase)` — rewrites an agent's `model` and
  `provider` in its config file (backs up to `<file>.bak` first), inferring the
  provider name (`polza`/`routerai`) from `apiBase`
- `applyPluginModelField(pluginName, fieldKey, modelKey, apiBase)` — sets a plugin-specific
  model field (e.g. `opencode-mem`'s `opencodeModel`/`memoryModel`)

See `aaa`'s [`Client` contract](https://github.com/ai-agg-agg/aaa/blob/main/src/clients/contract.ts)
for the full interface.

## Development

```sh
bun install
bun run build   # tsc → dist/
```

## License

MIT
