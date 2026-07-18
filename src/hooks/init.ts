import { Hook } from '@oclif/core'
import { registry } from '@ai-agg-agg/aaa-sdk'
import { OpenCodeClient } from '../opencode'

const hook: Hook<'init'> = async function () {
  registry.registerClient(new OpenCodeClient())
}

export default hook
