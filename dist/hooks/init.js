import { registry } from '@ai-agg-agg/aaa-sdk';
import { OpenCodeClient } from '../opencode';
const hook = async function () {
    registry.registerClient(new OpenCodeClient());
};
export default hook;
