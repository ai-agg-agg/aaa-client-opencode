import { Hook } from '@oclif/core'
import { registry } from 'aaa'
import { OpenCodeClient } from '../opencode'

const hook: Hook<'init'> = async function () {
  registry.registerClient(new OpenCodeClient())
}

export default hook
