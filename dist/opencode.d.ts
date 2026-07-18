import type { Client, Plugin } from '@ai-agg-agg/aaa-sdk';
export declare class OpenCodeClient implements Client {
    readonly name = "opencode";
    private opencodeConfig;
    private omoConfig;
    private pluginCache;
    constructor();
    private loadPlugins;
    discoverSources(): Promise<string[]>;
    private stripJsonc;
    private readConfig;
    private discoverAll;
    private discoverOpenCodePlugins;
    private resolveAgents;
    private extractOMOAgents;
    discoverPlugins(): Promise<Plugin[]>;
    getCurrentModels(): Promise<Record<string, string>>;
    private findAgent;
    applyAgentModel(agentName: string, modelKey: string, apiBase: string): Promise<void>;
    applyPluginModelField(pluginName: string, fieldKey: string, modelKey: string, apiBase: string): Promise<void>;
}
