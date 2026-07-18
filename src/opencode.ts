import type { Client, Agent, Plugin, PluginModelField } from '@ai-agg-agg/aaa-sdk'

const HOME = Bun.env.HOME ?? '~'

const DEFAULT_AGENTS: Agent[] = [
  { name: 'build', model: 'default-frontier-model', plugin: '', configFile: '' },
  { name: 'plan', model: 'default-frontier-model', plugin: '', configFile: '' },
  { name: 'oracle', model: 'default-frontier-model', plugin: '', configFile: '' },
  { name: 'quick', model: 'default-small-model', plugin: '', configFile: '' },
]

const KNOWN_PLUGIN_FIELDS: Record<string, PluginModelField[]> = {
  'opencode-mem': [
    { key: 'opencodeModel', description: 'Model for auto-capture via opencode provider' },
    { key: 'memoryModel', description: 'Fallback model for memory operations' },
  ],
}

export class OpenCodeClient implements Client {
  readonly name = 'opencode'

  private opencodeConfig: string
  private omoConfig: string
  private pluginCache: Plugin[] | null = null

  constructor() {
    this.opencodeConfig = process.env.OPENCODE_CONFIG ?? `${HOME}/.config/opencode/opencode.json`
    this.omoConfig = process.env.OMO_CONFIG ?? `${HOME}/.config/opencode/oh-my-openagent.json`
  }

  private async loadPlugins(): Promise<Plugin[]> {
    if (this.pluginCache) return this.pluginCache
    this.pluginCache = await this.discoverAll()
    return this.pluginCache
  }

  async discoverSources(): Promise<string[]> {
    const sources: string[] = []

    const ocFile = Bun.file(this.opencodeConfig)
    if (await ocFile.exists()) {
      sources.push(this.opencodeConfig)

      try {
        const data = JSON.parse(await ocFile.text()) as Record<string, unknown>
        const pluginRefs = (data.plugins ?? []) as Array<{ config?: string }>
        for (const p of pluginRefs) {
          if (p.config) {
            const cfg = p.config.replace(/^~\//, `${HOME}/`)
            if (await Bun.file(cfg).exists()) {
              sources.push(cfg)
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    const omoFile = Bun.file(this.omoConfig)
    if (await omoFile.exists() && !sources.includes(this.omoConfig)) {
      sources.push(this.omoConfig)
    }

    return sources
  }

  private stripJsonc(text: string): string {
    return text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  }

  private async readConfig(file: string): Promise<Record<string, unknown>> {
    const raw = await Bun.file(file).text()
    const clean = file.endsWith('.jsonc') ? this.stripJsonc(raw) : raw
    return JSON.parse(clean) as Record<string, unknown>
  }

  private async discoverAll(): Promise<Plugin[]> {
    const result: Plugin[] = []
    const sources = await this.discoverSources()

    for (const configFile of sources) {
      try {
        const data = await this.readConfig(configFile)

        let label = configFile.split('/').pop()?.replace('.json', '') ?? 'unknown'
        if (label === 'opencode') label = 'opencode'
        if (label === 'oh-my-openagent') label = 'OMO'

        if (configFile.includes('opencode.json')) {
          await this.discoverOpenCodePlugins(result, data, configFile)
        } else if (Array.isArray(data)) {
          result.push({
            name: label,
            description: 'OMO agent definitions',
            configFile,
            clientName: 'OMO',
            agents: this.extractOMOAgents(data as Array<Record<string, unknown>>, configFile),
            modelFields: [],
          })
        } else {
          const agents = data.agents as Record<string, Record<string, unknown>> | undefined
          result.push({
            name: label,
            description: label === 'OMO' ? 'OMO agent definitions' : 'Agent config',
            configFile,
            clientName: label,
            agents: agents
              ? Object.entries(agents).map(([name, v]) => ({
                  name,
                    model: String(v.model ?? (v.provider as Record<string, unknown>)?.model ?? 'unknown'),
                  plugin: label,
                  configFile,
                }))
              : [],
            modelFields: [],
          })
        }
      } catch { /* skip unparseable */ }
    }

    return result
  }

  private async discoverOpenCodePlugins(
    result: Plugin[],
    data: Record<string, unknown>,
    configFile: string,
  ): Promise<void> {
    const pluginRefs = (data.plugins ?? []) as Array<{ name?: string; description?: string; config?: string }>

    const agents = data.agents as Record<string, Record<string, unknown>> | undefined
    const baseAgents = this.resolveAgents(
      agents ? Object.entries(agents) : [],
      '',
      configFile,
      DEFAULT_AGENTS,
    )

    result.push({
      name: '',
      description: 'Built-in agents',
      configFile,
      clientName: 'opencode',
      agents: baseAgents,
      modelFields: [],
    })

    for (const ref of pluginRefs) {
      const pkgName = ref.name ?? 'unknown'
      const cfgPath = ref.config
        ? ref.config.replace(/^~\//, `${HOME}/`)
        : configFile

      let pluginAgents: Agent[] = []
      if (cfgPath !== configFile && (cfgPath.endsWith('.json') || cfgPath.endsWith('.jsonc'))) {
        try {
          const cfgData = await this.readConfig(cfgPath)
          const cfgAgents = cfgData.agents as Record<string, Record<string, unknown>> | undefined
          if (cfgAgents) {
            pluginAgents = Object.entries(cfgAgents).map(([an, v]) => ({
              name: an,
              model: String(v.model ?? (v.provider as Record<string, unknown>)?.model ?? 'unknown'),
              plugin: pkgName,
              configFile: cfgPath,
            }))
          }
        } catch { /* can't read plugin config */ }
      }

      result.push({
        name: pkgName,
        description: ref.description ?? `Plugin in opencode config`,
        configFile: cfgPath,
        clientName: 'opencode',
        agents: pluginAgents,
        modelFields: KNOWN_PLUGIN_FIELDS[pkgName] ?? [],
      })
    }
  }

  private resolveAgents(
    entries: Array<[string, Record<string, unknown>]>,
    plugin: string,
    configFile: string,
    defaults: Agent[],
  ): Agent[] {
    if (entries.length === 0) {
      return defaults.map(d => ({ ...d, configFile }))
    }
    return entries.map(([name, v]) => ({
      name,
      model: String(v.model ?? (v.provider as Record<string, unknown>)?.model ?? 'unknown'),
      plugin,
      configFile,
    }))
  }

  private extractOMOAgents(data: Array<Record<string, unknown>>, configFile: string): Agent[] {
    return data.map(item => ({
      name: String(item.name ?? item.id ?? 'unknown'),
      model: String(item.model ?? (item.provider as Record<string, unknown>)?.model ?? 'unknown'),
      plugin: 'OMO',
      configFile,
    }))
  }

  async discoverPlugins(): Promise<Plugin[]> {
    return this.loadPlugins()
  }

  async getCurrentModels(): Promise<Record<string, string>> {
    const plugins = await this.loadPlugins()
    const map: Record<string, string> = {}
    for (const p of plugins) {
      for (const a of p.agents) {
        const key = p.name ? `${p.name}:${a.name}` : a.name
        map[key] = a.model
      }
    }
    return map
  }

  private findAgent(agentName: string): { plugin: Plugin; agent: Agent } | null {
    for (const p of this.pluginCache ?? []) {
      const a = p.agents.find(ag => ag.name === agentName)
      if (a) return { plugin: p, agent: a }
    }
    return null
  }

  async applyAgentModel(agentName: string, modelKey: string, apiBase: string): Promise<void> {
    await this.loadPlugins()
    const found = this.findAgent(agentName)
    if (!found) throw new Error(`agent '${agentName}' not found`)

    const { agent: agentInfo } = found
    const configFile = agentInfo.configFile

    const expectedProvider = apiBase.includes('polza') ? 'polza'
      : apiBase.includes('routerai') ? 'routerai'
      : 'polza'

    await Bun.$`cp ${configFile} ${configFile}.bak`.quiet()

    const data = await this.readConfig(configFile)

    if (agentInfo.plugin === 'OMO') {
      if (Array.isArray(data)) {
        for (const item of data as Array<Record<string, unknown>>) {
          if (item.name === agentName || item.id === agentName) {
            item.model = modelKey
            const prov = (item.provider ?? {}) as Record<string, unknown>
            prov.name = expectedProvider
            prov.api_base = apiBase
            if (!item.provider) item.provider = prov
          }
        }
      } else {
        const agents = (data.agents ?? {}) as Record<string, Record<string, unknown>>
        const agentCfg = (agents[agentName] ?? {}) as Record<string, unknown>
        agentCfg.model = modelKey
        agentCfg.provider = { name: expectedProvider, api_base: apiBase }
        agents[agentName] = agentCfg
        data.agents = agents
      }
    } else {
      const agents = (data.agents ?? {}) as Record<string, Record<string, unknown>>
      const agentCfg = (agents[agentName] ?? {}) as Record<string, unknown>
      agentCfg.model = modelKey
      agentCfg.provider = expectedProvider
      agents[agentName] = agentCfg
      data.agents = agents

      const providers = (data.providers ?? {}) as Record<string, Record<string, unknown>>
      providers[expectedProvider] = {
        name: expectedProvider,
        api_base: apiBase,
        api_key_env: expectedProvider === 'polza' ? 'POLZA_API_KEY' : 'ROUTERAI_API_KEY',
      }
      data.providers = providers
    }

    await Bun.write(configFile, JSON.stringify(data, null, 2))
    this.pluginCache = null
  }

  async applyPluginModelField(
    pluginName: string,
    fieldKey: string,
    modelKey: string,
    apiBase: string,
  ): Promise<void> {
    await this.loadPlugins()
    const foundPlugin = this.pluginCache?.find(p => p.name === pluginName)
    if (!foundPlugin) throw new Error(`plugin '${pluginName}' not found`)

    const configFile = foundPlugin.configFile

    const expectedProvider = apiBase.includes('polza') ? 'polza'
      : apiBase.includes('routerai') ? 'routerai'
      : 'polza'

    await Bun.$`cp ${configFile} ${configFile}.bak`.quiet()

    const data = await this.readConfig(configFile) as Record<string, unknown>
    data[fieldKey] = modelKey

    if (!data.opencodeProvider) {
      data.opencodeProvider = expectedProvider
    }

    await Bun.write(configFile, JSON.stringify(data, null, 2))
    this.pluginCache = null
  }
}
