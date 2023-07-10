import type { GossipHelia, ComponentProtocol } from '@/interface.js'
import type { Replica } from '@/replica/index.js'
import type { Blocks } from '@/blocks/index.js'
import { HLDB_PREFIX } from '@/utils/constants.js'
import type { Playable } from '@/utils/playable.js'
import type { Datastore } from 'interface-datastore'
import type { Blockstore } from 'interface-blockstore'
import type { Ed25519PeerId } from '@libp2p/interface-peer-id'

export interface Config {
  ipfs: GossipHelia
  replica: Replica
  blocks: Blocks
  datastore: Datastore
  blockstore: Blockstore
  provider?: Ed25519PeerId
}

export interface Replicator extends Playable {}

export interface ReplicatorModule<T extends Replicator = Replicator, P extends string = string> extends ComponentProtocol<P> {
  create: (config: Config) => T
}

export const prefix = `${HLDB_PREFIX}replicator/` as const
