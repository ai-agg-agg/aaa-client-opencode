const HOME = Bun.env.HOME ?? '~';
const DEFAULT_AGENTS = [
    { name: 'build', model: 'default-frontier-model', plugin: '', configFile: '' },
    { name: 'plan', model: 'default-frontier-model', plugin: '', configFile: '' },
    { name: 'oracle', model: 'default-frontier-model', plugin: '', configFile: '' },
    { name: 'quick', model: 'default-small-model', plugin: '', configFile: '' },
];
const KNOWN_PLUGIN_FIELDS = {
    'opencode-mem': [
        { key: 'opencodeModel', description: 'Model for auto-capture via opencode provider' },
        { key: 'memoryModel', description: 'Fallback model for memory operations' },
    ],
};
export class OpenCodeClient {
    name = 'opencode';
    opencodeConfig;
    omoConfig;
    pluginCache = null;
    constructor() {
        this.opencodeConfig = process.env.OPENCODE_CONFIG ?? `${HOME}/.config/opencode/opencode.json`;
        this.omoConfig = process.env.OMO_CONFIG ?? `${HOME}/.config/opencode/oh-my-openagent.json`;
    }
    async loadPlugins() {
        if (this.pluginCache)
            return this.pluginCache;
        this.pluginCache = await this.discoverAll();
        return this.pluginCache;
    }
    async discoverSources() {
        const sources = [];
        const ocFile = Bun.file(this.opencodeConfig);
        if (await ocFile.exists()) {
            sources.push(this.opencodeConfig);
            try {
                const data = JSON.parse(await ocFile.text());
                const pluginRefs = (data.plugins ?? []);
                for (const p of pluginRefs) {
                    if (p.config) {
                        const cfg = p.config.replace(/^~\//, `${HOME}/`);
                        if (await Bun.file(cfg).exists()) {
                            sources.push(cfg);
                        }
                    }
                }
            }
            catch { /* ignore parse errors */ }
        }
        const omoFile = Bun.file(this.omoConfig);
        if (await omoFile.exists() && !sources.includes(this.omoConfig)) {
            sources.push(this.omoConfig);
        }
        return sources;
    }
    stripJsonc(text) {
        return text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    }
    async readConfig(file) {
        const raw = await Bun.file(file).text();
        const clean = file.endsWith('.jsonc') ? this.stripJsonc(raw) : raw;
        return JSON.parse(clean);
    }
    async discoverAll() {
        const result = [];
        const sources = await this.discoverSources();
        for (const configFile of sources) {
            try {
                const data = await this.readConfig(configFile);
                let label = configFile.split('/').pop()?.replace('.json', '') ?? 'unknown';
                if (label === 'opencode')
                    label = 'opencode';
                if (label === 'oh-my-openagent')
                    label = 'OMO';
                if (configFile.includes('opencode.json')) {
                    await this.discoverOpenCodePlugins(result, data, configFile);
                }
                else if (Array.isArray(data)) {
                    result.push({
                        name: label,
                        description: 'OMO agent definitions',
                        configFile,
                        clientName: 'OMO',
                        agents: this.extractOMOAgents(data, configFile),
                        modelFields: [],
                    });
                }
                else {
                    const agents = data.agents;
                    result.push({
                        name: label,
                        description: label === 'OMO' ? 'OMO agent definitions' : 'Agent config',
                        configFile,
                        clientName: label,
                        agents: agents
                            ? Object.entries(agents).map(([name, v]) => ({
                                name,
                                model: String(v.model ?? v.provider?.model ?? 'unknown'),
                                plugin: label,
                                configFile,
                            }))
                            : [],
                        modelFields: [],
                    });
                }
            }
            catch { /* skip unparseable */ }
        }
        return result;
    }
    async discoverOpenCodePlugins(result, data, configFile) {
        const pluginRefs = (data.plugins ?? []);
        const agents = data.agents;
        const baseAgents = this.resolveAgents(agents ? Object.entries(agents) : [], '', configFile, DEFAULT_AGENTS);
        result.push({
            name: '',
            description: 'Built-in agents',
            configFile,
            clientName: 'opencode',
            agents: baseAgents,
            modelFields: [],
        });
        for (const ref of pluginRefs) {
            const pkgName = ref.name ?? 'unknown';
            const cfgPath = ref.config
                ? ref.config.replace(/^~\//, `${HOME}/`)
                : configFile;
            let pluginAgents = [];
            if (cfgPath !== configFile && (cfgPath.endsWith('.json') || cfgPath.endsWith('.jsonc'))) {
                try {
                    const cfgData = await this.readConfig(cfgPath);
                    const cfgAgents = cfgData.agents;
                    if (cfgAgents) {
                        pluginAgents = Object.entries(cfgAgents).map(([an, v]) => ({
                            name: an,
                            model: String(v.model ?? v.provider?.model ?? 'unknown'),
                            plugin: pkgName,
                            configFile: cfgPath,
                        }));
                    }
                }
                catch { /* can't read plugin config */ }
            }
            result.push({
                name: pkgName,
                description: ref.description ?? `Plugin in opencode config`,
                configFile: cfgPath,
                clientName: 'opencode',
                agents: pluginAgents,
                modelFields: KNOWN_PLUGIN_FIELDS[pkgName] ?? [],
            });
        }
    }
    resolveAgents(entries, plugin, configFile, defaults) {
        if (entries.length === 0) {
            return defaults.map(d => ({ ...d, configFile }));
        }
        return entries.map(([name, v]) => ({
            name,
            model: String(v.model ?? v.provider?.model ?? 'unknown'),
            plugin,
            configFile,
        }));
    }
    extractOMOAgents(data, configFile) {
        return data.map(item => ({
            name: String(item.name ?? item.id ?? 'unknown'),
            model: String(item.model ?? item.provider?.model ?? 'unknown'),
            plugin: 'OMO',
            configFile,
        }));
    }
    async discoverPlugins() {
        return this.loadPlugins();
    }
    async getCurrentModels() {
        const plugins = await this.loadPlugins();
        const map = {};
        for (const p of plugins) {
            for (const a of p.agents) {
                const key = p.name ? `${p.name}:${a.name}` : a.name;
                map[key] = a.model;
            }
        }
        return map;
    }
    findAgent(agentName) {
        for (const p of this.pluginCache ?? []) {
            const a = p.agents.find(ag => ag.name === agentName);
            if (a)
                return { plugin: p, agent: a };
        }
        return null;
    }
    async applyAgentModel(agentName, modelKey, apiBase) {
        await this.loadPlugins();
        const found = this.findAgent(agentName);
        if (!found)
            throw new Error(`agent '${agentName}' not found`);
        const { agent: agentInfo } = found;
        const configFile = agentInfo.configFile;
        const expectedProvider = apiBase.includes('polza') ? 'polza'
            : apiBase.includes('routerai') ? 'routerai'
                : 'polza';
        await Bun.$ `cp ${configFile} ${configFile}.bak`.quiet();
        const data = await this.readConfig(configFile);
        if (agentInfo.plugin === 'OMO') {
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item.name === agentName || item.id === agentName) {
                        item.model = modelKey;
                        const prov = (item.provider ?? {});
                        prov.name = expectedProvider;
                        prov.api_base = apiBase;
                        if (!item.provider)
                            item.provider = prov;
                    }
                }
            }
            else {
                const agents = (data.agents ?? {});
                const agentCfg = (agents[agentName] ?? {});
                agentCfg.model = modelKey;
                agentCfg.provider = { name: expectedProvider, api_base: apiBase };
                agents[agentName] = agentCfg;
                data.agents = agents;
            }
        }
        else {
            const agents = (data.agents ?? {});
            const agentCfg = (agents[agentName] ?? {});
            agentCfg.model = modelKey;
            agentCfg.provider = expectedProvider;
            agents[agentName] = agentCfg;
            data.agents = agents;
            const providers = (data.providers ?? {});
            providers[expectedProvider] = {
                name: expectedProvider,
                api_base: apiBase,
                api_key_env: expectedProvider === 'polza' ? 'POLZA_API_KEY' : 'ROUTERAI_API_KEY',
            };
            data.providers = providers;
        }
        await Bun.write(configFile, JSON.stringify(data, null, 2));
        this.pluginCache = null;
    }
    async applyPluginModelField(pluginName, fieldKey, modelKey, apiBase) {
        await this.loadPlugins();
        const foundPlugin = this.pluginCache?.find(p => p.name === pluginName);
        if (!foundPlugin)
            throw new Error(`plugin '${pluginName}' not found`);
        const configFile = foundPlugin.configFile;
        const expectedProvider = apiBase.includes('polza') ? 'polza'
            : apiBase.includes('routerai') ? 'routerai'
                : 'polza';
        await Bun.$ `cp ${configFile} ${configFile}.bak`.quiet();
        const data = await this.readConfig(configFile);
        data[fieldKey] = modelKey;
        if (!data.opencodeProvider) {
            data.opencodeProvider = expectedProvider;
        }
        await Bun.write(configFile, JSON.stringify(data, null, 2));
        this.pluginCache = null;
    }
}
